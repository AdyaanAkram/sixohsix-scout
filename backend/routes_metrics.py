"""Verified objective metrics + personal-best milestones.

Metric keys are canonical (spec §4D) and legacy keys are aliased on read AND
on write, so rows written under the old namespace (exit_velo, sixty_yd, …)
still resolve, chart, and match benchmarks.

Verification sources (spec §16) are a closed, validated set with a trust
ordering. Athlete/parent submissions are UNVERIFIED and can never claim a
verified tier — enforced server-side, never trusted from the client.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import ADMIN_ROLES, COACH_ROLES, REVIEW_ROLES, STAFF_ROLES, get_current_user, require_roles
from db import clean, db, log_audit, new_id, now_iso
from notifications import notify_athlete_users
from scoring import (
    CANONICAL_METRIC_CATALOG,
    LEGACY_METRIC_CATALOG,
    canonical_metric_key,
    equivalent_metric_keys,
    find_benchmark,
    metric_meta,
    normalize_with_benchmark,
)

router = APIRouter()

# Backwards-compatible name. Now canonical (spec §4D) plus supported legacy keys.
METRIC_CATALOG = {
    **{k: {**v, "legacy": False} for k, v in CANONICAL_METRIC_CATALOG.items()},
    **{k: {**v, "legacy": True} for k, v in LEGACY_METRIC_CATALOG.items()},
}

# ---------------------------------------------------------------------------
# Verification sources (spec §16)
# ---------------------------------------------------------------------------

VERIFICATION_SOURCES = {
    "athlete_submitted": {"label": "Athlete Submitted", "trust_level": 1, "is_verified": False},
    "parent_submitted": {"label": "Parent Submitted", "trust_level": 2, "is_verified": False},
    "coach_submitted": {"label": "Coach Submitted", "trust_level": 3, "is_verified": True},
    "event_verified": {"label": "Event Verified", "trust_level": 4, "is_verified": True},
    "device_verified": {"label": "Device Verified", "trust_level": 5, "is_verified": True},
    "id_verified": {"label": "60'6\" Verified", "trust_level": 6, "is_verified": True},
}

DEFAULT_SOURCE = "coach_submitted"

# Free-text values written before the enum existed. Deliberately conservative:
# legacy text is NEVER promoted above coach_submitted.
LEGACY_SOURCE_ALIASES = {
    "seed": "coach_submitted",
    "demo": "coach_submitted",
    "coach": "coach_submitted",
    "staff": "coach_submitted",
    "scout": "coach_submitted",
    "manual": "coach_submitted",
    "athlete": "athlete_submitted",
    "self": "athlete_submitted",
    "self_reported": "athlete_submitted",
    "parent": "parent_submitted",
    "guardian": "parent_submitted",
}

# Who may WRITE which source. Athletes/parents are structurally incapable of
# claiming a verified tier; only review roles may stamp 60'6" Verified.
_UNVERIFIED = ("athlete_submitted", "parent_submitted")
_COACH_WRITABLE = _UNVERIFIED + ("coach_submitted", "event_verified", "device_verified")


def allowed_sources_for_role(role: str | None) -> tuple[str, ...]:
    if role == "athlete":
        return ("athlete_submitted",)
    if role == "parent":
        return ("parent_submitted",)
    if role in REVIEW_ROLES:
        return _COACH_WRITABLE + ("id_verified",)
    if role in COACH_ROLES:
        return _COACH_WRITABLE
    return ()


def default_source_for_role(role: str | None) -> str:
    if role == "athlete":
        return "athlete_submitted"
    if role == "parent":
        return "parent_submitted"
    return DEFAULT_SOURCE


def source_is_verified(source_key: str | None) -> bool:
    return bool(VERIFICATION_SOURCES.get(source_key or "", {}).get("is_verified"))


def resolve_source(doc: dict) -> str:
    """Canonical source for a stored row, including pre-enum free text."""
    raw = doc.get("source")
    if raw:
        key = str(raw).strip().lower().replace(" ", "_").replace("-", "_")
        if key in VERIFICATION_SOURCES:
            return key
        if key in LEGACY_SOURCE_ALIASES:
            return LEGACY_SOURCE_ALIASES[key]
    # Unrecognised/missing: every pre-enum write required a staff role and
    # stamped verified_by, so treat those as coach-submitted and nothing higher.
    return "coach_submitted" if doc.get("verified_by") else "athlete_submitted"


def _source_payload(key: str) -> dict:
    meta = VERIFICATION_SOURCES[key]
    return {
        "key": key,
        "label": meta["label"],
        "is_verified": meta["is_verified"],
        "trust_level": meta["trust_level"],
    }


# ---------------------------------------------------------------------------
# Shaping
# ---------------------------------------------------------------------------

def shape_metric(doc: dict | None) -> dict | None:
    """Normalise a stored verified_metrics row for API responses."""
    if not doc:
        return None
    stored_key = doc.get("metric_key")
    key = canonical_metric_key(stored_key)
    meta = metric_meta(stored_key) or {}
    source = resolve_source(doc)
    smeta = VERIFICATION_SOURCES[source]
    out = {k: v for k, v in doc.items() if k != "_id"}
    out.update({
        "metric_key": key,
        "metric_key_stored": stored_key,
        "label": meta.get("label") or str(key or "").replace("_", " ").title(),
        "unit": doc.get("unit") or meta.get("unit"),
        "lower_better": meta.get("lower_better"),
        "legacy_metric": bool(meta.get("legacy")),
        "source": source,
        "source_raw": doc.get("source"),
        "source_label": smeta["label"],
        "trust_level": smeta["trust_level"],
        "is_verified": smeta["is_verified"],
        "verified_by": doc.get("verified_by"),
        "verified_by_name": doc.get("verified_by_name"),
        "verified_at": doc.get("verified_at") or (doc.get("created_at") if doc.get("verified_by") else None),
        "submitted_by": doc.get("submitted_by") or doc.get("verified_by"),
        "submitted_by_name": doc.get("submitted_by_name") or doc.get("verified_by_name"),
        "measured_at": doc.get("measured_at"),
    })
    return clean(out)


def _sort_key(m: dict):
    return (m.get("measured_at") or m.get("created_at") or "", m.get("created_at") or "")


class MetricBody(BaseModel):
    athlete_id: str
    metric_key: str
    value: float
    unit: str | None = None
    measured_at: str | None = None
    source: str | None = None
    season_id: str | None = None  # optional; validated / best-effort resolved


async def resolve_season_id(athlete_id: str, org: str, requested: str | None,
                            date_str: str | None) -> str | None:
    """Season id to stamp on a child record. An explicit season_id must belong
    to the athlete+org (422 otherwise); when omitted, resolve best-effort from
    the record's date. None (stored as null) when no season matches — never
    create a season here (spec §6: additive, non-destructive)."""
    # Deferred import: routes_players imports this module, so a top-level import
    # would be circular. It is fully loaded by call time.
    from routes_players import season_for_date, _athlete_seasons
    seasons = await _athlete_seasons(athlete_id, org)
    if requested:
        if not any(s["id"] == requested for s in seasons):
            raise HTTPException(status_code=422, detail="Season not found for this athlete.")
        return requested
    matched = season_for_date(seasons, date_str)
    return matched["id"] if matched else None


# ---------------------------------------------------------------------------
# Catalog endpoints
# ---------------------------------------------------------------------------

@router.get("/metrics/catalog")
async def metric_catalog(user=Depends(get_current_user)):
    """Static metric catalog. No tenant data — any authenticated user may read
    it so athlete/parent portals can label and chart their own numbers."""
    return [
        {
            "key": k,
            "label": v["label"],
            "unit": v["unit"],
            "lower_better": v["lower_better"],
            "legacy": v["legacy"],
        }
        for k, v in METRIC_CATALOG.items()
    ]


@router.get("/metrics/sources")
async def metric_sources(user=Depends(get_current_user)):
    """Verification source catalog so the UI never hardcodes badge labels."""
    allowed = allowed_sources_for_role(user.get("role"))
    return {
        "sources": [
            {**_source_payload(k), "allowed_for_me": k in allowed}
            for k in sorted(VERIFICATION_SOURCES, key=lambda x: VERIFICATION_SOURCES[x]["trust_level"])
        ],
        "default_for_me": default_source_for_role(user.get("role")) if allowed else None,
        "verified_sources": [k for k, v in VERIFICATION_SOURCES.items() if v["is_verified"]],
        "unverified_sources": [k for k, v in VERIFICATION_SOURCES.items() if not v["is_verified"]],
    }


# ---------------------------------------------------------------------------
# Access helpers (org-scoped — minors' data across tenants)
# ---------------------------------------------------------------------------

async def _own_athlete(user):
    org = user["organization_id"]
    role = user.get("role")
    if role == "athlete":
        return await db.athletes.find_one({"user_id": user["id"], "organization_id": org}, {"_id": 0})
    if role == "parent":
        return await db.athletes.find_one({"guardian_user_id": user["id"], "organization_id": org}, {"_id": 0})
    return None


async def _athlete_for_write(user, athlete_id: str):
    """Return the athlete this user is allowed to write a metric for."""
    role = user.get("role")
    if role in ("athlete", "parent"):
        athlete = await _own_athlete(user)
        if not athlete:
            raise HTTPException(status_code=404, detail="No athlete profile linked to this account.")
        if athlete["id"] != athlete_id:
            raise HTTPException(status_code=403, detail="You can only log metrics for your own athlete profile.")
        return athlete
    if role not in COACH_ROLES:
        raise HTTPException(status_code=403, detail="You do not have permission to perform this action.")
    athlete = await db.athletes.find_one(
        {"id": athlete_id, "organization_id": user["organization_id"]}, {"_id": 0})
    if not athlete:
        raise HTTPException(status_code=404, detail="Player not found.")
    return athlete


def _resolve_write_source(user, requested: str | None) -> str:
    role = user.get("role")
    allowed = allowed_sources_for_role(role)
    if not allowed:
        raise HTTPException(status_code=403, detail="You do not have permission to perform this action.")
    if requested is None:
        return default_source_for_role(role)
    key = str(requested).strip().lower().replace(" ", "_").replace("-", "_")
    if key not in VERIFICATION_SOURCES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown source '{requested}'. Use one of: {', '.join(VERIFICATION_SOURCES)}",
        )
    if key not in allowed:
        raise HTTPException(
            status_code=403,
            detail=(f"Your role cannot record a '{VERIFICATION_SOURCES[key]['label']}' metric. "
                    f"Allowed: {', '.join(allowed)}"),
        )
    return key


# ---------------------------------------------------------------------------
# Write
# ---------------------------------------------------------------------------

@router.delete("/metrics/{metric_id}")
async def delete_metric(metric_id: str, user=Depends(require_roles(*ADMIN_ROLES))):
    """Remove a mis-entered reading (typo'd time/velocity). Admin-only, audited.
    History correction, not falsification: the audit log keeps what was removed."""
    doc = await db.verified_metrics.find_one(
        {"id": metric_id, "organization_id": user["organization_id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Metric entry not found.")
    await db.verified_metrics.delete_one({"id": metric_id, "organization_id": user["organization_id"]})
    await log_audit(user["organization_id"], user, "metric_deleted", "metric", metric_id,
                    {"athlete_id": doc.get("athlete_id"), "metric_key": doc.get("metric_key"),
                     "value": doc.get("value"), "measured_at": doc.get("measured_at")})
    return {"message": "Metric entry removed."}


@router.post("/metrics")
async def add_metric(body: MetricBody, user=Depends(get_current_user)):
    meta = metric_meta(body.metric_key)
    if not meta:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown metric_key. Use one of: {', '.join(METRIC_CATALOG)}",
        )
    metric_key = meta["key"]
    athlete = await _athlete_for_write(user, body.athlete_id)
    source = _resolve_write_source(user, body.source)
    verified = source_is_verified(source)
    org = user["organization_id"]

    # Match legacy spellings too, so PB history survives the key migration.
    prior = await db.verified_metrics.find({
        "athlete_id": athlete["id"],
        "organization_id": org,
        "metric_key": {"$in": equivalent_metric_keys(metric_key)},
    }, {"_id": 0}).to_list(500)

    lower = meta["lower_better"]
    # A personal best is only claimed against the same trust class: an
    # unverified self-report must never overwrite a verified PB (spec §16).
    baseline = [p for p in prior if source_is_verified(resolve_source(p))] if verified else prior
    prev_best = None
    is_pb = True
    if baseline:
        vals = [p["value"] for p in baseline if p.get("value") is not None]
        if vals:
            prev_best = min(vals) if lower else max(vals)
            is_pb = (body.value < prev_best) if lower else (body.value > prev_best)

    unit = body.unit or meta["unit"]
    ts = now_iso()
    measured_at = body.measured_at or ts[:10]
    season_id = await resolve_season_id(athlete["id"], org, body.season_id, measured_at)
    doc = {
        "id": new_id(),
        "organization_id": org,
        "athlete_id": athlete["id"],
        "metric_key": metric_key,
        "value": float(body.value),
        "unit": unit,
        "source": source,
        "is_verified": verified,
        "submitted_by": user["id"],
        "submitted_by_name": user.get("full_name"),
        "verified_by": user["id"] if verified else None,
        "verified_by_name": user.get("full_name") if verified else None,
        "verified_at": ts if verified else None,
        "measured_at": measured_at,
        "season_id": season_id,
        "created_at": ts,
    }
    await db.verified_metrics.insert_one(doc)
    await log_audit(org, user, "metric_verified" if verified else "metric_submitted",
                    "verified_metric", doc["id"],
                    {"athlete_id": athlete["id"], "metric_key": metric_key,
                     "value": body.value, "source": source})

    milestone = None
    # Only verified numbers earn a milestone / notification.
    if is_pb and verified:
        label = meta["label"]
        delta = round(body.value - prev_best, 2) if prev_best is not None else None
        milestone = {
            "id": new_id(),
            "organization_id": org,
            "athlete_id": athlete["id"],
            "kind": "personal_best",
            "metric_key": metric_key,
            "value": float(body.value),
            "unit": unit,
            "prev_value": prev_best,
            "delta": delta,
            "source": source,
            "label": f"New PB · {label}",
            "detail": f"{body.value} {unit}" + (f" (was {prev_best} {unit})" if prev_best is not None else ""),
            "created_at": ts,
        }
        await db.milestones.insert_one(milestone)
        await notify_athlete_users(
            athlete, "personal_best",
            f"New PB · {label}",
            f"{body.value} {unit} verified by {user.get('full_name')}. That's a new personal best!",
            {"athlete_id": athlete["id"], "milestone_id": milestone["id"], "metric_key": metric_key},
        )
    return {
        **shape_metric(doc),
        "is_personal_best": bool(is_pb and verified),
        "personal_best_scope": "verified" if verified else "unverified",
        "milestone": clean(milestone) if milestone else None,
    }


# ---------------------------------------------------------------------------
# Comparison (spec §4D)
# ---------------------------------------------------------------------------

def _shape_benchmark(b: dict | None) -> dict | None:
    if not b:
        return None
    return {
        "id": b.get("id"),
        "metric_key": canonical_metric_key(b.get("metric_key")),
        "age_group": b.get("age_group"),
        "position": b.get("position"),
        "unit": b.get("unit"),
        "higher_is_better": b.get("higher_is_better"),
        "floor_value": b.get("floor_value"),
        "elite_value": b.get("elite_value"),
    }


def _point(m: dict | None) -> dict | None:
    if not m:
        return None
    return {
        "value": m.get("value"),
        "unit": m.get("unit"),
        "measured_at": m.get("measured_at"),
        "source": m.get("source"),
        "source_label": m.get("source_label"),
        "is_verified": m.get("is_verified"),
        "trust_level": m.get("trust_level"),
        "verified_by": m.get("verified_by"),
        "verified_by_name": m.get("verified_by_name"),
        "verified_at": m.get("verified_at"),
        "metric_id": m.get("id"),
    }


async def _build_comparison(athlete: dict, org: str, include_empty: bool = False) -> dict:
    rows = await db.verified_metrics.find(
        {"athlete_id": athlete["id"], "organization_id": org}, {"_id": 0}).to_list(1000)
    benchmarks = await db.metric_benchmarks.find({"organization_id": org}, {"_id": 0}).to_list(500)

    shaped: dict[str, list[dict]] = {}
    for r in rows:
        s = shape_metric(r)
        shaped.setdefault(s["metric_key"], []).append(s)
    for v in shaped.values():
        v.sort(key=_sort_key)

    age_group = athlete.get("age_group")
    position = athlete.get("primary_position")

    if include_empty:
        keys = list(METRIC_CATALOG) + [k for k in shaped if k not in METRIC_CATALOG]
    else:
        # catalog order first, then any unrecognised legacy keys still on file
        keys = [k for k in METRIC_CATALOG if k in shaped] + [k for k in shaped if k not in METRIC_CATALOG]

    out = []
    for key in keys:
        history = shaped.get(key, [])
        if not history and not include_empty:
            continue
        meta = metric_meta(key) or {}
        lower = meta.get("lower_better")
        current = history[-1] if history else None
        previous = history[-2] if len(history) > 1 else None

        best = None
        vals = [h for h in history if h.get("value") is not None]
        if vals:
            best = min(vals, key=lambda h: h["value"]) if lower else max(vals, key=lambda h: h["value"])

        # NEVER fabricate a benchmark: null when none is defined for this org.
        pos_bench = find_benchmark([b for b in benchmarks if b.get("position")], key, age_group, position)
        age_bench = find_benchmark([b for b in benchmarks if not b.get("position")], key, age_group, None)
        chosen = find_benchmark(benchmarks, key, age_group, position)

        normalized = percentile = None
        if chosen and current and current.get("value") is not None:
            normalized, percentile = normalize_with_benchmark(chosen, current["value"])

        out.append({
            "metric_key": key,
            "label": meta.get("label") or key.replace("_", " ").title(),
            "unit": (current or {}).get("unit") or meta.get("unit"),
            "lower_better": lower,
            "legacy_metric": bool(meta.get("legacy")),
            "current": _point(current),
            "previous": _point(previous),
            "personal_best": _point(best),
            "age_group_benchmark": _shape_benchmark(age_bench),
            "position_benchmark": _shape_benchmark(pos_bench),
            "benchmark": _shape_benchmark(chosen),
            "benchmark_scope": ("position" if chosen and chosen.get("position") else "age_group") if chosen else None,
            "normalized_score": normalized,
            "percentile": percentile,
            "history": [
                {"value": h.get("value"), "measured_at": h.get("measured_at"),
                 "source": h.get("source"), "is_verified": h.get("is_verified")}
                for h in history
            ],
            "verified_count": sum(1 for h in history if h.get("is_verified")),
            "reading_count": len(history),
        })

    return {
        "athlete": {
            "id": athlete["id"],
            "name": f"{athlete.get('first_name', '')} {athlete.get('last_name', '')}".strip(),
            "age_group": age_group,
            "primary_position": position,
        },
        "metrics": out,
    }


@router.get("/metrics/athlete/{athlete_id}/comparison")
async def metric_comparison(athlete_id: str, include_empty: bool = False,
                            user=Depends(require_roles(*STAFF_ROLES))):
    org = user["organization_id"]
    athlete = await db.athletes.find_one({"id": athlete_id, "organization_id": org}, {"_id": 0})
    if not athlete:
        raise HTTPException(status_code=404, detail="Player not found.")
    return await _build_comparison(athlete, org, include_empty)


@router.get("/me/metrics/comparison")
async def my_metric_comparison(include_empty: bool = False, user=Depends(get_current_user)):
    org = user["organization_id"]
    if user.get("role") not in ("athlete", "parent"):
        raise HTTPException(status_code=403, detail="Athlete or guardian role required.")
    athlete = await _own_athlete(user)
    if not athlete:
        raise HTTPException(status_code=404, detail="No athlete profile linked to this account.")
    return await _build_comparison(athlete, org, include_empty)


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

@router.get("/metrics/athlete/{athlete_id}")
async def list_metrics(athlete_id: str, season_id: str | None = None,
                       user=Depends(require_roles(*STAFF_ROLES))):
    org = user["organization_id"]
    a = await db.athletes.find_one({"id": athlete_id, "organization_id": org}, {"_id": 0, "id": 1})
    if not a:
        raise HTTPException(status_code=404, detail="Player not found.")
    rows = await db.verified_metrics.find(
        {"athlete_id": athlete_id, "organization_id": org}, {"_id": 0}
    ).to_list(500)
    if season_id:
        # Deferred import: routes_players imports this module, so importing it at
        # top level would be circular. At call time it is fully loaded.
        from routes_players import resolve_record_season_id, _athlete_seasons
        seasons = await _athlete_seasons(athlete_id, org)
        if not any(s["id"] == season_id for s in seasons):
            raise HTTPException(status_code=422, detail="Season not found for this athlete.")
        rows = [r for r in rows
                if resolve_record_season_id(r, seasons, ("measured_at", "created_at")) == season_id]
    rows.sort(key=_sort_key, reverse=True)
    return [shape_metric(r) for r in rows]


@router.get("/milestones/athlete/{athlete_id}")
async def list_milestones(athlete_id: str, user=Depends(require_roles(*STAFF_ROLES))):
    org = user["organization_id"]
    a = await db.athletes.find_one({"id": athlete_id, "organization_id": org}, {"_id": 0, "id": 1})
    if not a:
        raise HTTPException(status_code=404, detail="Player not found.")
    rows = await db.milestones.find(
        {"athlete_id": athlete_id, "organization_id": org}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    for r in rows:
        r["metric_key"] = canonical_metric_key(r.get("metric_key"))
    return rows


@router.get("/me/metrics")
async def me_metrics(user=Depends(get_current_user)):
    org = user["organization_id"]
    if user.get("role") not in ("athlete", "parent"):
        raise HTTPException(status_code=403, detail="Athlete or guardian role required.")
    a = await _own_athlete(user)
    if not a:
        raise HTTPException(status_code=404, detail="No athlete profile linked to this account.")
    rows = await db.verified_metrics.find(
        {"athlete_id": a["id"], "organization_id": org}, {"_id": 0}
    ).to_list(500)
    rows.sort(key=_sort_key, reverse=True)
    milestones = await db.milestones.find(
        {"athlete_id": a["id"], "organization_id": org}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    for m in milestones:
        m["metric_key"] = canonical_metric_key(m.get("metric_key"))
    return {"metrics": [shape_metric(r) for r in rows], "milestones": milestones}
