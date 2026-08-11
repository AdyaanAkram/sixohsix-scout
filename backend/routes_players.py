import csv
import io
from datetime import date, datetime

from fastapi import (APIRouter, Depends, File, HTTPException, Query, Response,
                     UploadFile)
from pydantic import BaseModel

from auth import (ADMIN_ROLES, COACH_ROLES, REVIEW_ROLES, STAFF_ROLES,
                  get_current_user, require_roles)
from db import clean, db, log_audit, new_id, now_iso
from positions import (AGE_BANDS, POSITION_TAXONOMY, age_band_for_age,
                       normalize_age_band)
from routes_development import _note_visible_to_role, _validate_date
from routes_metrics import shape_metric
from scoring import aggregate_player_scores, canonical_metric_key

router = APIRouter()

POSITIONS = list(POSITION_TAXONOMY)


def format_permanent_id(athlete_id: str | None) -> str:
    """Permanent 60'6\" ID: 606-{first 8 chars of UUID}."""
    return f"606-{str(athlete_id or '')[:8].upper()}"


def compute_age(dob_str):
    if not dob_str:
        return None
    try:
        dob = datetime.strptime(dob_str[:10], "%Y-%m-%d").date()
        today = date.today()
        return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
    except Exception:
        return None


def compute_age_group(dob_str):
    """Derive a canonical band from a birth date. Never returns "Professional" —
    that band is only ever set explicitly by an admin."""
    return age_band_for_age(compute_age(dob_str))


def validate_age_band(age_group: str | None) -> str | None:
    """Accept a canonical band (case-insensitive) or a legacy label that maps onto
    one. Anything else is a 422 rather than a silently stored junk band."""
    if age_group in (None, ""):
        return None
    band = normalize_age_band(age_group)
    if band is None:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown age band: {age_group}. Allowed: {', '.join(AGE_BANDS)}")
    return band


def resolve_age_group(age_group: str | None, dob_str: str | None) -> str | None:
    """An explicit band wins over the birth date — an admin must be able to place a
    reclassified or Professional athlete in a band the DOB would not produce."""
    return validate_age_band(age_group) or compute_age_group(dob_str)


class AthleteBody(BaseModel):
    first_name: str
    last_name: str
    preferred_name: str | None = None
    date_of_birth: str | None = None
    age_group: str | None = None  # explicit band; falls back to the DOB-derived band
    graduation_year: int | None = None
    primary_position: str | None = None
    secondary_positions: list[str] = []
    bats: str | None = None
    throws: str | None = None
    height: str | None = None
    weight: str | None = None
    jersey_number: str | None = None
    current_team: str | None = None
    school: str | None = None
    city: str | None = None
    state: str | None = None
    country: str | None = "USA"
    guardian_name: str | None = None
    guardian_email: str | None = None
    guardian_phone: str | None = None
    emergency_contact: str | None = None
    email: str | None = None  # athlete's own email (distinct from guardian)
    status: str = "active"
    photo_url: str | None = None


def athlete_doc(body: AthleteBody, org_id: str, user_id: str):
    doc = body.model_dump()
    doc.update({
        "id": new_id(),
        "organization_id": org_id,
        # TODO: later union organization_id with shared_with_organizations for read access
        # (travel + HS dual membership / PBG evaluating on behalf of a league). Unused until then.
        "shared_with_organizations": [],
        "bio": None,
        "user_id": None,
        "guardian_user_id": None,
        "profile_completed_at": None,
        "self_service_enabled": False,
        "age": compute_age(body.date_of_birth),
        "age_group": resolve_age_group(body.age_group, body.date_of_birth),
        "created_by": user_id,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    })
    return doc


# Parent / medical / emergency / financial fields stripped for evaluator role
EVALUATOR_PRIVATE_FIELDS = [
    "guardian_name", "guardian_email", "guardian_phone", "emergency_contact",
    "guardian_user_id", "parent_name", "parent_email", "parent_phone",
    "medical_notes", "medical_conditions", "allergies", "medications",
    "injury_history", "physician_name", "physician_phone",
    "insurance_info", "insurance_provider", "insurance_policy", "insurance_group",
    "financial_notes", "payment_status", "tuition", "fees_owed", "scholarship",
    "ssn", "tax_id",
]


def restrict_guardian(doc, role):
    """Evaluators must not see parent/medical/emergency/financial fields."""
    if role == "evaluator":
        for f in EVALUATOR_PRIVATE_FIELDS:
            doc.pop(f, None)
    return doc


@router.get("/athletes")
async def list_athletes(
    search: str | None = None,
    age_group: str | None = None,
    position: str | None = None,
    status: str | None = None,
    team: str | None = None,
    graduation_year: int | None = None,
    limit: int = 200,
    user=Depends(require_roles(*STAFF_ROLES)),
):
    q = {"organization_id": user["organization_id"]}
    if status:
        q["status"] = status
    if graduation_year is not None:
        q["graduation_year"] = graduation_year
    if age_group:
        # Match the raw label too so athletes still carrying a legacy band or a
        # single-year label are not hidden by a canonical-band filter.
        band = normalize_age_band(age_group)
        q["age_group"] = {"$in": list({age_group, band} - {None})}
    if position:
        q["$or"] = [{"primary_position": position}, {"secondary_positions": position}]
    if team:
        q["current_team"] = team
    if search:
        q["$and"] = [{"$or": [
            {"first_name": {"$regex": search, "$options": "i"}},
            {"last_name": {"$regex": search, "$options": "i"}},
            {"preferred_name": {"$regex": search, "$options": "i"}},
            {"id": search},
        ]}]
    athletes = await db.athletes.find(q, {"_id": 0}).sort([("last_name", 1), ("first_name", 1)]).to_list(min(limit, 500))
    return [restrict_guardian(a, user["role"]) for a in athletes]


async def _grad_year_counts(org_id: str) -> list[dict]:
    """Distinct graduation years with athlete counts for one org, ascending.

    Athletes without a graduation_year are excluded, never bucketed into an
    invented year. Shared with the org summary report.
    """
    rows = await db.athletes.aggregate([
        {"$match": {"organization_id": org_id, "graduation_year": {"$ne": None}}},
        {"$group": {"_id": "$graduation_year", "count": {"$sum": 1}}},
    ]).to_list(200)
    out = []
    for r in rows:
        try:
            out.append({"year": int(r["_id"]), "count": r["count"]})
        except (TypeError, ValueError):
            continue  # junk value in a legacy row — skip, don't fabricate a year
    out.sort(key=lambda x: x["year"])
    return out


# NOTE: registered before /athletes/{athlete_id} so the literal path matches first.
@router.get("/athletes/grad-years")
async def grad_years(user=Depends(require_roles(*STAFF_ROLES))):
    """[{year, count}] for the caller's org — powers the "Class of ____" chips."""
    return await _grad_year_counts(user["organization_id"])


@router.post("/athletes")
async def create_athlete(body: AthleteBody, user=Depends(require_roles(*ADMIN_ROLES))):
    doc = athlete_doc(body, user["organization_id"], user["id"])
    await db.athletes.insert_one(doc)
    await log_audit(user["organization_id"], user, "athlete_created", "athlete", doc["id"], {"name": f"{body.first_name} {body.last_name}"})
    return clean(doc)


@router.get("/athletes/{athlete_id}")
async def get_athlete(athlete_id: str, user=Depends(require_roles(*STAFF_ROLES))):
    a = await db.athletes.find_one({"id": athlete_id, "organization_id": user["organization_id"]}, {"_id": 0})
    if not a:
        raise HTTPException(status_code=404, detail="Player not found.")
    return restrict_guardian(a, user["role"])


@router.patch("/athletes/{athlete_id}")
async def update_athlete(athlete_id: str, body: AthleteBody, user=Depends(require_roles(*ADMIN_ROLES))):
    a = await db.athletes.find_one({"id": athlete_id, "organization_id": user["organization_id"]})
    if not a:
        raise HTTPException(status_code=404, detail="Player not found.")
    updates = body.model_dump()
    updates["age"] = compute_age(body.date_of_birth)
    updates["age_group"] = resolve_age_group(body.age_group, body.date_of_birth)
    updates["updated_at"] = now_iso()

    # Spec §6: never erase prior physicals/team. Snapshot the OLD value of any
    # tracked field to an append-only log before overwriting, so a player's
    # season-to-season history survives an in-place edit.
    tracked = ("height", "weight", "current_team", "age_group", "primary_position")
    snapshots = [
        {"field": f, "from": a.get(f), "to": updates.get(f), "at": updates["updated_at"],
         "by": user["id"], "by_name": user.get("full_name")}
        for f in tracked
        if updates.get(f) not in (None, "") and updates.get(f) != a.get(f) and a.get(f) not in (None, "")
    ]
    # Spec §6: park prior height/weight/team on the current season snapshot before
    # they are overwritten, so a season's physicals are never silently lost.
    await _preserve_physicals_to_season(a, updates, user)
    set_ops = {"$set": updates}
    if snapshots:
        set_ops["$push"] = {"physical_history": {"$each": snapshots}}
    await db.athletes.update_one({"id": athlete_id}, set_ops)
    audit_meta = {"age_group": updates["age_group"]} if updates["age_group"] != a.get("age_group") else None
    if snapshots:
        audit_meta = {**(audit_meta or {}), "changed": [s["field"] for s in snapshots]}
    await log_audit(user["organization_id"], user, "athlete_updated", "athlete", athlete_id, audit_meta)
    return {**a, **updates, "_id": None} and clean({**a, **updates})


@router.post("/athletes/{athlete_id}/archive")
async def archive_athlete(athlete_id: str, user=Depends(require_roles(*ADMIN_ROLES))):
    res = await db.athletes.update_one(
        {"id": athlete_id, "organization_id": user["organization_id"]},
        {"$set": {"status": "archived", "updated_at": now_iso()}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Player not found.")
    await log_audit(user["organization_id"], user, "athlete_archived", "athlete", athlete_id)
    return {"message": "Player archived."}


@router.post("/athletes/{athlete_id}/restore")
async def restore_athlete(athlete_id: str, user=Depends(require_roles(*ADMIN_ROLES))):
    res = await db.athletes.update_one(
        {"id": athlete_id, "organization_id": user["organization_id"]},
        {"$set": {"status": "active", "updated_at": now_iso()}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Player not found.")
    await log_audit(user["organization_id"], user, "athlete_restored", "athlete", athlete_id)
    return {"message": "Player restored."}


class MergeBody(BaseModel):
    keep_id: str
    merge_id: str


@router.post("/athletes/merge")
async def merge_athletes(body: MergeBody, user=Depends(require_roles(*ADMIN_ROLES))):
    keep = await db.athletes.find_one({"id": body.keep_id, "organization_id": user["organization_id"]})
    merge = await db.athletes.find_one({"id": body.merge_id, "organization_id": user["organization_id"]})
    if not keep or not merge:
        raise HTTPException(status_code=404, detail="One or both players were not found.")
    # move all related records to keep_id
    for coll in [db.evaluations, db.athlete_notes, db.athlete_goals, db.athlete_media, db.event_athletes]:
        await coll.update_many({"athlete_id": body.merge_id}, {"$set": {"athlete_id": body.keep_id}})
    # fill blank fields on keep from merge
    fills = {k: v for k, v in merge.items() if k not in ("_id", "id") and v and not keep.get(k)}
    if fills:
        fills["updated_at"] = now_iso()
        await db.athletes.update_one({"id": body.keep_id}, {"$set": fills})
    await db.athletes.update_one({"id": body.merge_id}, {"$set": {"status": "merged", "merged_into": body.keep_id, "updated_at": now_iso()}})
    await log_audit(user["organization_id"], user, "athletes_merged", "athlete", body.keep_id, {"merged_from": body.merge_id})
    return {"message": "Players merged. All history moved to the kept record."}


# ---------------- Player summary (profile overview) ----------------

@router.get("/athletes/{athlete_id}/summary")
async def athlete_summary(athlete_id: str, season_id: str | None = None,
                          user=Depends(require_roles(*STAFF_ROLES))):
    a = await db.athletes.find_one({"id": athlete_id, "organization_id": user["organization_id"]}, {"_id": 0})
    if not a:
        raise HTTPException(status_code=404, detail="Player not found.")
    evals = await db.evaluations.find({
        "athlete_id": athlete_id, "organization_id": user["organization_id"],
        "status": {"$in": ["submitted", "approved"]},
    }, {"_id": 0}).sort("submitted_at", 1).to_list(500)

    # Optional season scope (spec §6): keep only evaluations whose EVENT DATE
    # falls in the requested season. The submit path is never touched — grouping
    # is derived here at read time.
    if season_id:
        seasons = await _athlete_seasons(athlete_id, user["organization_id"])
        season = next((s for s in seasons if s["id"] == season_id), None)
        if not season:
            raise HTTPException(status_code=404, detail="Season not found.")
        event_ids = sorted({e.get("event_id") for e in evals if e.get("event_id")})
        ev_dates = {}
        if event_ids:
            rows = await db.events.find(
                {"id": {"$in": event_ids}, "organization_id": user["organization_id"]},
                {"_id": 0, "id": 1, "date": 1}).to_list(500)
            ev_dates = {r["id"]: r.get("date") for r in rows}
        evals = [
            ev for ev in evals
            if (season_for_date(seasons, ev_dates.get(ev.get("event_id"))) or {}).get("id") == season_id
        ]

    # group evaluations by event to compute per-event overall
    by_event = {}
    for ev in evals:
        by_event.setdefault(ev["event_id"], []).append(ev)
    event_scores = []
    # Per-metric longitudinal series (trainer growth view)
    metric_series = {}  # metric_key -> [{event_date, event_name, raw, unit, name}]
    for event_id, evs in by_event.items():
        agg = aggregate_player_scores(evs)
        event = await db.events.find_one({"id": event_id}, {"_id": 0, "name": 1, "date": 1})
        event_name = event.get("name") if event else "Event"
        event_date = event.get("date") if event else None
        event_scores.append({
            "event_id": event_id,
            "event_name": event_name,
            "event_date": event_date,
            "overall_score": agg["overall_score"],
            "category_scores": agg["category_scores"],
        })
        for ev in evs:
            template = await db.evaluation_templates.find_one({"id": ev.get("template_id")}, {"_id": 0, "metrics": 1})
            metrics_by_id = {m["id"]: m for m in (template or {}).get("metrics", [])}
            # compute_evaluation_scores stores per-metric results under "metric_results";
            # reading "metrics" here left every normalized point null on the growth chart.
            computed = (ev.get("computed") or {}).get("metric_results") or {}
            scores = ev.get("scores") or {}
            for mid, entry in scores.items():
                if not isinstance(entry, dict) or entry.get("not_observed"):
                    continue
                raw = entry.get("value")
                if raw is None or raw == "":
                    continue
                meta = metrics_by_id.get(mid) or {}
                mtype = meta.get("metric_type") or ""
                # Prefer measurable / rating metrics for growth tracking
                if mtype in ("comment", "observation", "yes_no", "multiple_choice"):
                    continue
                key = meta.get("key") or mid
                name = meta.get("name") or key
                unit = meta.get("unit") or ""
                # For dual-attempt measurements, use best attempt
                a2 = entry.get("attempt_2")
                best = raw
                if isinstance(raw, (int, float)) and isinstance(a2, (int, float)):
                    best = max(raw, a2) if meta.get("higher_is_better", True) else min(raw, a2)
                metric_series.setdefault(key, {"name": name, "unit": unit, "metric_type": mtype, "higher_is_better": meta.get("higher_is_better", True), "points": []})
                metric_series[key]["points"].append({
                    "event_id": event_id,
                    "event_name": event_name,
                    "event_date": event_date,
                    "raw": best,
                    "normalized": (computed.get(mid) or {}).get("normalized"),
                })
    event_scores.sort(key=lambda x: x.get("event_date") or "")

    metric_history = []
    for key, series in metric_series.items():
        pts = sorted(series["points"], key=lambda p: p.get("event_date") or "")
        if not pts:
            continue
        first, last = pts[0], pts[-1]
        change = None
        try:
            if isinstance(first["raw"], (int, float)) and isinstance(last["raw"], (int, float)) and len(pts) > 1:
                change = round(last["raw"] - first["raw"], 2)
        except Exception:
            change = None
        improved = None
        if change is not None:
            improved = change > 0 if series["higher_is_better"] else change < 0
            if change == 0:
                improved = False
        metric_history.append({
            "key": key,
            "name": series["name"],
            "unit": series["unit"],
            "metric_type": series["metric_type"],
            "higher_is_better": series["higher_is_better"],
            "latest": last["raw"],
            "previous": pts[-2]["raw"] if len(pts) > 1 else None,
            "first": first["raw"],
            "change": change,
            "improved": improved,
            "points": pts,
        })
    # Sort: measurable first, then by absolute change desc
    metric_history.sort(key=lambda m: (0 if m["metric_type"] in ("velocity", "time", "numeric") else 1, -(abs(m["change"]) if m["change"] is not None else -1)))

    # Progress needs >=2 checkpoints. Grouping by event alone hides development
    # when all evaluations share one event (a single camp), while the dashboard's
    # insights group by day — so the two surfaces disagreed. Fall back to
    # day-grouped checkpoints (submitted_at date) when events give <2 points.
    if len(event_scores) < 2:
        by_day = {}
        for ev in evals:
            day = (ev.get("submitted_at") or ev.get("created_at") or "")[:10]
            if day:
                by_day.setdefault(day, []).append(ev)
        if len(by_day) >= 2:
            day_scores = []
            for day, evs in sorted(by_day.items()):
                agg = aggregate_player_scores(evs)
                if agg["overall_score"] is not None:
                    day_scores.append({
                        "event_id": None,
                        "event_name": day,
                        "event_date": day,
                        "overall_score": agg["overall_score"],
                    })
            if len(day_scores) >= 2:
                event_scores = day_scores

    latest = event_scores[-1] if event_scores else None
    previous = event_scores[-2] if len(event_scores) > 1 else None
    goals = await db.athlete_goals.find({"athlete_id": athlete_id, "status": {"$nin": ["Archived"]}}, {"_id": 0}).sort("created_at", -1).to_list(20)
    latest_scout = await db.athlete_notes.find_one(
        {"athlete_id": athlete_id, "organization_id": user["organization_id"],
         "note_type": {"$in": ["scout_assessment", "scout"]}},
        {"_id": 0}, sort=[("created_at", -1)])
    # Same visibility rules as GET /athletes/{id}/notes, otherwise a scout or
    # confidential note reaches evaluators here even though /notes hides it.
    if latest_scout and not _note_visible_to_role(latest_scout, user["role"]):
        latest_scout = None

    # aggregate skill summary across all evals (latest event weighted most: use all)
    agg_all = aggregate_player_scores(evals)

    return {
        "athlete": restrict_guardian(a, user["role"]),
        "permanent_id": format_permanent_id(a.get("id")),
        "latest_overall": latest["overall_score"] if latest else None,
        "previous_overall": previous["overall_score"] if previous else None,
        "score_change": round(latest["overall_score"] - previous["overall_score"], 2) if latest and previous and latest["overall_score"] is not None and previous["overall_score"] is not None else None,
        "evaluation_count": len(evals),
        "last_evaluation_date": evals[-1].get("submitted_at") if evals else None,
        "event_scores": event_scores,
        "category_scores": agg_all["category_scores"],
        "metric_history": metric_history,
        "goals": goals,
        "latest_scout_assessment": latest_scout,
        "position_projection": (latest_scout or {}).get("position_recommendation") or a.get("position_projection"),
        "verified_metric_count": await db.verified_metrics.count_documents(
            {"athlete_id": athlete_id, "organization_id": user["organization_id"]}
        ),
    }


# ---------------- Player comparison (spec §18) ----------------

class CompareBody(BaseModel):
    athlete_ids: list[str]


# A handful of verified measurements that read well side-by-side; the frontend
# grouped bars key off these. Any player missing one renders "—", never a guess.
COMPARE_KEY_METRICS = ["exit_velocity", "throwing_velocity", "sixty_yard_dash"]


async def _compare_player(a: dict, role: str, org_id: str) -> dict:
    """Assemble everything spec §18 needs for one athlete. All reads are already
    scoped to org_id by the caller; this stays consistent with the shape and
    scoring that /athletes/{id}/summary produces (no reimplemented scoring)."""
    aid = a["id"]
    evals = await db.evaluations.find({
        "athlete_id": aid, "organization_id": org_id,
        "status": {"$in": ["submitted", "approved"]},
    }, {"_id": 0}).sort("submitted_at", 1).to_list(500)

    # Overall score over time: one point per event (same per-event aggregation
    # the summary endpoint uses) — a short progress series, not a full history.
    by_event: dict = {}
    for ev in evals:
        by_event.setdefault(ev.get("event_id"), []).append(ev)
    progress_series = []
    for event_id, evs in by_event.items():
        agg = aggregate_player_scores(evs)
        event = await db.events.find_one({"id": event_id}, {"_id": 0, "name": 1, "date": 1})
        progress_series.append({
            "event_id": event_id,
            "event_name": event.get("name") if event else "Event",
            "event_date": event.get("date") if event else None,
            "overall_score": agg["overall_score"],
        })
    progress_series.sort(key=lambda x: x.get("event_date") or "")

    agg_all = aggregate_player_scores(evals)

    # Latest verified measurement per canonical metric key. Canonicalising first
    # collapses legacy spellings (exit_velo → exit_velocity) so one metric never
    # shows twice; shape_metric attaches the trust source the badge reads.
    metric_rows = await db.verified_metrics.find(
        {"athlete_id": aid, "organization_id": org_id}, {"_id": 0}
    ).to_list(500)
    metric_rows.sort(
        key=lambda m: (m.get("measured_at") or m.get("created_at") or "", m.get("created_at") or ""),
        reverse=True)
    latest_by_key: dict = {}
    for m in metric_rows:
        ck = canonical_metric_key(m.get("metric_key"))
        if ck and ck not in latest_by_key:
            latest_by_key[ck] = m
    measurements = [shape_metric(m) for m in latest_by_key.values()]

    # A simple count only — never enumerate unapproved youth media here.
    video_count = await db.athlete_media.count_documents(
        {"athlete_id": aid, "organization_id": org_id, "file_type": "video"})

    return {
        "athlete": restrict_guardian(a, role),
        "permanent_id": format_permanent_id(aid),
        "overall_score": agg_all["overall_score"],
        "category_scores": agg_all["category_scores"],
        "measurements": measurements,
        "progress_series": progress_series,
        "evaluation_count": len(evals),
        "last_evaluation_date": evals[-1].get("submitted_at") if evals else None,
        "video_count": video_count,
    }


@router.post("/athletes/compare")
async def compare_athletes(body: CompareBody,
                           user=Depends(require_roles(*REVIEW_ROLES, "coach"))):
    """Side-by-side comparison for authorized coaches / scouts (spec §18).
    Evaluators are intentionally excluded — this is not gated to STAFF_ROLES."""
    ids = [i for i in dict.fromkeys(body.athlete_ids) if i]  # de-dupe, keep order
    if len(ids) > 4:
        raise HTTPException(status_code=400, detail="Compare up to four players.")
    org_id = user["organization_id"]
    # Skip any id outside the caller's org rather than 404-ing the whole request —
    # a missing org filter here would be a cross-tenant leak of minors' data.
    players = []
    for aid in ids:
        a = await db.athletes.find_one({"id": aid, "organization_id": org_id}, {"_id": 0})
        if not a:
            continue
        players.append(await _compare_player(a, user["role"], org_id))
    return {"players": players}


@router.get("/athletes/{athlete_id}/timeline")
async def athlete_timeline(athlete_id: str, user=Depends(require_roles(*STAFF_ROLES))):
    a = await db.athletes.find_one({"id": athlete_id, "organization_id": user["organization_id"]}, {"_id": 0, "id": 1})
    if not a:
        raise HTTPException(status_code=404, detail="Player not found.")
    items = []
    evals = await db.evaluations.find({"athlete_id": athlete_id, "status": {"$in": ["submitted", "approved"]}}, {"_id": 0}).to_list(500)
    for ev in evals:
        event = await db.events.find_one({"id": ev["event_id"]}, {"_id": 0, "name": 1})
        station = await db.stations.find_one({"id": ev["station_id"]}, {"_id": 0, "name": 1})
        items.append({
            "type": "evaluation", "date": ev.get("submitted_at") or ev.get("updated_at"),
            "title": f"{station.get('name') if station else 'Station'} evaluation — {event.get('name') if event else 'Event'}",
            "detail": f"Overall {ev.get('computed', {}).get('overall_score', '—')}" if ev.get("computed") else "",
            "status": ev.get("status"), "ref_id": ev["id"],
        })
    notes = await db.athlete_notes.find({"athlete_id": athlete_id}, {"_id": 0}).to_list(500)
    from routes_development import _note_visible_to_role
    for n in notes:
        if not _note_visible_to_role(n, user["role"]):
            continue
        ntype = n.get("note_type") or ""
        is_scout = ntype in ("scout_assessment", "scout")
        items.append({
            "type": "scout_note" if is_scout else "note",
            "date": n.get("assessment_date") or n.get("created_at"),
            "title": "Head Scout Assessment" if is_scout else (n.get("assessment_type") or ntype.replace("_", " ").title() or "Note"),
            "detail": (n.get("strengths") or n.get("summary") or "")[:160],
            "author": n.get("author_name"), "ref_id": n["id"],
        })
    goals = await db.athlete_goals.find({"athlete_id": athlete_id}, {"_id": 0}).to_list(200)
    for g in goals:
        items.append({
            "type": "goal", "date": g.get("created_at"),
            "title": f"Goal: {g.get('title')}",
            "detail": f"{g.get('status')} — {g.get('progress', 0)}%", "ref_id": g["id"],
        })
    media = await db.athlete_media.find({"athlete_id": athlete_id}, {"_id": 0}).to_list(200)
    for m in media:
        items.append({
            "type": "media", "date": m.get("created_at"),
            "title": f"{m.get('file_type', 'media').title()} added",
            "detail": m.get("description", ""), "ref_id": m["id"],
        })
    seasons = await db.athlete_seasons.find(
        {"athlete_id": athlete_id, "organization_id": user["organization_id"]}, {"_id": 0}
    ).to_list(100)
    for s in seasons:
        items.append({
            "type": "season",
            "date": f"{s.get('year', '')}-01-01",
            "title": f"{s.get('year')} Season — {s.get('team') or 'Team'}",
            "detail": " · ".join(
                x for x in [s.get("organization_name"), s.get("age_group"),
                            f"{s.get('height') or '—'}/{s.get('weight') or '—'}"] if x
            ),
            "ref_id": s.get("id"),
        })
    items.sort(key=lambda x: x.get("date") or "", reverse=True)
    return items


# ---------------- Athlete seasons (stacked under permanent ID) ----------------

class SeasonBody(BaseModel):
    year: int
    team: str | None = None
    organization_name: str | None = None
    age_group: str | None = None
    height: str | None = None
    weight: str | None = None
    start_date: str | None = None  # YYYY-MM-DD; defaults to Jan 1 of `year`
    end_date: str | None = None    # YYYY-MM-DD; defaults to Dec 31 of `year`


class SeasonPatch(BaseModel):
    year: int | None = None
    team: str | None = None
    organization_name: str | None = None
    age_group: str | None = None
    height: str | None = None
    weight: str | None = None
    start_date: str | None = None
    end_date: str | None = None


def season_date_range(season: dict) -> tuple[str | None, str | None]:
    """Return (start, end) as YYYY-MM-DD for a season. An explicit start_date /
    end_date wins; otherwise a default range is derived from `year`
    (Jan 1–Dec 31). A season with neither dates nor a year yields (None, None)."""
    year = season.get("year")
    start = season.get("start_date")
    end = season.get("end_date")
    if not start and year is not None:
        start = f"{int(year):04d}-01-01"
    if not end and year is not None:
        end = f"{int(year):04d}-12-31"
    return start, end


def season_for_date(seasons: list[dict], date_str: str | None) -> dict | None:
    """The season whose date range contains `date_str` (YYYY-MM-DD). Falls back
    to a season whose `year` matches the date's year. None if nothing matches —
    never fabricate a season."""
    if not date_str:
        return None
    d = str(date_str)[:10]
    for s in seasons:
        start, end = season_date_range(s)
        if start and end and start <= d <= end:
            return s
    yr = d[:4]
    for s in seasons:
        if str(s.get("year")) == yr:
            return s
    return None


def resolve_record_season_id(record: dict, seasons: list[dict],
                             date_fields: tuple[str, ...] = ("measured_at", "created_at")) -> str | None:
    """Season id a record belongs to: an explicit stored season_id wins, else
    derive from the first present date field via season_for_date. None if
    undeterminable (never guessed)."""
    if record.get("season_id"):
        return record["season_id"]
    for f in date_fields:
        if record.get(f):
            s = season_for_date(seasons, record[f])
            if s:
                return s["id"]
    return None


async def _athlete_seasons(athlete_id: str, org_id: str) -> list[dict]:
    return await db.athlete_seasons.find(
        {"athlete_id": athlete_id, "organization_id": org_id}, {"_id": 0}
    ).sort("year", -1).to_list(200)


async def _preserve_physicals_to_season(athlete: dict, updates: dict, user: dict):
    """Spec §6 "never erase": before the athlete doc's height/weight/current_team
    are overwritten, park the PRIOR values on the athlete's CURRENT-season
    snapshot so the physicals that were true that season survive an in-place
    edit. Idempotent + additive — fills only season fields currently absent, and
    creates the current season only if none exists."""
    field_map = {"height": "height", "weight": "weight", "current_team": "team"}
    prior = {}
    for a_field, s_field in field_map.items():
        old = athlete.get(a_field)
        new = updates.get(a_field)
        if old not in (None, "") and new != old:
            prior[s_field] = old
    if not prior:
        return
    org = athlete["organization_id"]
    seasons = await _athlete_seasons(athlete["id"], org)
    current = season_for_date(seasons, date.today().isoformat())
    if current:
        fill = {k: v for k, v in prior.items() if not current.get(k)}
        if fill:
            fill["updated_at"] = now_iso()
            await db.athlete_seasons.update_one(
                {"id": current["id"], "organization_id": org}, {"$set": fill})
    else:
        doc = {
            "id": new_id(), "athlete_id": athlete["id"], "organization_id": org,
            "year": date.today().year,
            "team": prior.get("team"),
            "organization_name": None,
            "age_group": athlete.get("age_group"),
            "height": prior.get("height"),
            "weight": prior.get("weight"),
            "start_date": None, "end_date": None,
            "auto_created": True,
            "created_by": user["id"], "created_at": now_iso(), "updated_at": now_iso(),
        }
        await db.athlete_seasons.insert_one(doc)


async def _get_org_athlete(athlete_id: str, org_id: str):
    a = await db.athletes.find_one({"id": athlete_id, "organization_id": org_id}, {"_id": 0})
    if not a:
        raise HTTPException(status_code=404, detail="Player not found.")
    return a


@router.get("/athletes/{athlete_id}/seasons")
async def list_seasons(athlete_id: str, user=Depends(require_roles(*STAFF_ROLES))):
    await _get_org_athlete(athlete_id, user["organization_id"])
    return await db.athlete_seasons.find(
        {"athlete_id": athlete_id, "organization_id": user["organization_id"]}, {"_id": 0}
    ).sort("year", -1).to_list(100)


@router.post("/athletes/{athlete_id}/seasons")
async def create_season(athlete_id: str, body: SeasonBody, user=Depends(require_roles(*COACH_ROLES))):
    await _get_org_athlete(athlete_id, user["organization_id"])
    doc = {
        "id": new_id(),
        "athlete_id": athlete_id,
        "organization_id": user["organization_id"],
        "year": body.year,
        "team": body.team,
        "organization_name": body.organization_name,
        "age_group": validate_age_band(body.age_group),
        "height": body.height,
        "weight": body.weight,
        "start_date": _validate_date(body.start_date, "start_date"),
        "end_date": _validate_date(body.end_date, "end_date"),
        "created_by": user["id"],
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.athlete_seasons.insert_one(doc)
    await log_audit(user["organization_id"], user, "season_created", "athlete_season", doc["id"],
                    {"athlete_id": athlete_id, "year": body.year})
    return clean(doc)


@router.patch("/athletes/{athlete_id}/seasons/{season_id}")
async def patch_season(athlete_id: str, season_id: str, body: SeasonPatch,
                       user=Depends(require_roles(*COACH_ROLES))):
    await _get_org_athlete(athlete_id, user["organization_id"])
    existing = await db.athlete_seasons.find_one({
        "id": season_id, "athlete_id": athlete_id, "organization_id": user["organization_id"],
    })
    if not existing:
        raise HTTPException(status_code=404, detail="Season not found.")
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None or k in body.model_fields_set}
    # Allow clearing optional string fields when explicitly set to null via model
    raw = body.model_dump(exclude_unset=True)
    if "age_group" in raw:
        raw["age_group"] = validate_age_band(raw["age_group"])
    if "start_date" in raw:
        raw["start_date"] = _validate_date(raw["start_date"], "start_date")
    if "end_date" in raw:
        raw["end_date"] = _validate_date(raw["end_date"], "end_date")
    updates = {**raw, "updated_at": now_iso()}
    await db.athlete_seasons.update_one(
        {"id": season_id, "organization_id": user["organization_id"]}, {"$set": updates})
    await log_audit(user["organization_id"], user, "season_updated", "athlete_season", season_id,
                    {"athlete_id": athlete_id})
    doc = await db.athlete_seasons.find_one({"id": season_id}, {"_id": 0})
    return clean(doc)


# ---------------- Season-scoped records (spec §6 grouping) ----------------

async def _evaluations_with_dates(athlete_id: str, org_id: str) -> list[dict]:
    """Submitted/approved evaluations for an athlete, each annotated with its
    event's date/name. The event date is the season anchor — evaluations are
    NEVER written with a season_id (append-only submit path stays untouched);
    season membership is derived here at read time."""
    evals = await db.evaluations.find({
        "athlete_id": athlete_id, "organization_id": org_id,
        "status": {"$in": ["submitted", "approved"]},
    }, {"_id": 0}).sort("submitted_at", 1).to_list(500)
    # Resolve event dates once (org-scoped) rather than per-evaluation.
    event_ids = sorted({e.get("event_id") for e in evals if e.get("event_id")})
    events = {}
    if event_ids:
        rows = await db.events.find(
            {"id": {"$in": event_ids}, "organization_id": org_id},
            {"_id": 0, "id": 1, "name": 1, "date": 1}).to_list(500)
        events = {e["id"]: e for e in rows}
    for ev in evals:
        e = events.get(ev.get("event_id")) or {}
        ev["event_name"] = e.get("name")
        ev["event_date"] = e.get("date")
    return evals


def _shape_season_evaluation(ev: dict) -> dict:
    computed = ev.get("computed") or {}
    return {
        "id": ev.get("id"),
        "event_id": ev.get("event_id"),
        "event_name": ev.get("event_name"),
        "event_date": ev.get("event_date"),
        "station_id": ev.get("station_id"),
        "status": ev.get("status"),
        "overall_score": computed.get("overall_score"),
        "submitted_at": ev.get("submitted_at"),
    }


@router.get("/athletes/{athlete_id}/seasons/{season_id}/records")
async def season_records(athlete_id: str, season_id: str,
                         user=Depends(require_roles(*STAFF_ROLES))):
    """Read-only: every record that falls under one season for one athlete.
    Evaluations are grouped by their EVENT DATE (the submit path is never
    written to); metrics/media/goals match a stored season_id or, absent one,
    are derived from their own date. Empty lists when a season has nothing —
    never fabricated."""
    org = user["organization_id"]
    await _get_org_athlete(athlete_id, org)
    seasons = await _athlete_seasons(athlete_id, org)
    season = next((s for s in seasons if s["id"] == season_id), None)
    if not season:
        raise HTTPException(status_code=404, detail="Season not found.")
    start, end = season_date_range(season)

    def _in_range(date_str):
        if not (start and end and date_str):
            return False
        return start <= str(date_str)[:10] <= end

    # Evaluations: derive by event date (this season wins iff the date maps here).
    evals = await _evaluations_with_dates(athlete_id, org)
    season_evals = [
        _shape_season_evaluation(ev) for ev in evals
        if (season_for_date(seasons, ev.get("event_date")) or {}).get("id") == season_id
    ]

    metric_rows = await db.verified_metrics.find(
        {"athlete_id": athlete_id, "organization_id": org}, {"_id": 0}).to_list(1000)
    season_metrics = [
        shape_metric(m) for m in metric_rows
        if resolve_record_season_id(m, seasons, ("measured_at", "created_at")) == season_id
    ]

    media_rows = await db.athlete_media.find(
        {"athlete_id": athlete_id, "organization_id": org}, {"_id": 0}).to_list(500)
    season_media = [
        m for m in media_rows
        if resolve_record_season_id(m, seasons, ("capture_date", "created_at")) == season_id
    ]

    goal_rows = await db.athlete_goals.find(
        {"athlete_id": athlete_id, "organization_id": org}, {"_id": 0}).to_list(300)
    season_goals = [
        g for g in goal_rows
        if resolve_record_season_id(g, seasons, ("start_date", "created_at")) == season_id
    ]

    return {
        "athlete_id": athlete_id,
        "season": clean(season),
        "date_range": {"start": start, "end": end},
        "evaluations": season_evals,
        "metrics": season_metrics,
        "media": season_media,
        "goals": season_goals,
        "counts": {
            "evaluations": len(season_evals),
            "metrics": len(season_metrics),
            "media": len(season_media),
            "goals": len(season_goals),
        },
    }


# ---------------- Career overview (cross-season aggregation, spec §6) ----------------

@router.get("/athletes/{athlete_id}/career")
async def athlete_career(athlete_id: str, user=Depends(require_roles(*STAFF_ROLES))):
    """Cross-season totals for one permanent 60'6\" ID: evaluation count per
    season, best verified measurement per metric across seasons, overall-score
    trend by year, and teams played for. Reuses aggregate_player_scores — no
    reimplemented scoring. Empty/null where there are no records."""
    org = user["organization_id"]
    athlete = await _get_org_athlete(athlete_id, org)
    seasons = await _athlete_seasons(athlete_id, org)

    evals = await _evaluations_with_dates(athlete_id, org)

    # Evaluation count + score per season, and a year->overall trend.
    per_season = []
    for s in seasons:
        s_evals = [e for e in evals
                   if (season_for_date(seasons, e.get("event_date")) or {}).get("id") == s["id"]]
        agg = aggregate_player_scores(s_evals) if s_evals else {"overall_score": None, "category_scores": {}}
        per_season.append({
            "season_id": s["id"],
            "year": s.get("year"),
            "team": s.get("team"),
            "organization_name": s.get("organization_name"),
            "age_group": s.get("age_group"),
            "evaluation_count": len(s_evals),
            "overall_score": agg["overall_score"],
        })

    # Score trend by YEAR (independent of whether a season doc exists for it).
    evals_by_year: dict = {}
    for e in evals:
        d = e.get("event_date")
        if not d:
            continue
        evals_by_year.setdefault(str(d)[:4], []).append(e)
    score_trend = []
    for yr in sorted(evals_by_year):
        agg = aggregate_player_scores(evals_by_year[yr])
        score_trend.append({"year": yr, "overall_score": agg["overall_score"],
                            "evaluation_count": len(evals_by_year[yr])})

    # Best VERIFIED measurement per canonical metric across every season.
    metric_rows = await db.verified_metrics.find(
        {"athlete_id": athlete_id, "organization_id": org}, {"_id": 0}).to_list(1000)
    best_by_metric: dict = {}
    for m in metric_rows:
        shaped = shape_metric(m)
        if not shaped.get("is_verified") or shaped.get("value") is None:
            continue
        key = shaped["metric_key"]
        lower = bool(shaped.get("lower_better"))
        cur = best_by_metric.get(key)
        if cur is None:
            best_by_metric[key] = shaped
        else:
            better = shaped["value"] < cur["value"] if lower else shaped["value"] > cur["value"]
            if better:
                best_by_metric[key] = shaped
    best_measurements = [
        {
            "metric_key": k,
            "label": v.get("label"),
            "value": v.get("value"),
            "unit": v.get("unit"),
            "lower_better": v.get("lower_better"),
            "measured_at": v.get("measured_at"),
            "source": v.get("source"),
            "source_label": v.get("source_label"),
            "season_id": resolve_record_season_id(v, seasons, ("measured_at", "created_at")),
        }
        for k, v in best_by_metric.items()
    ]

    # Teams played for: seasons first (year-tagged), plus the athlete's current team.
    teams = []
    seen = set()
    for s in sorted(seasons, key=lambda x: x.get("year") or 0):
        t = s.get("team")
        if t and t not in seen:
            seen.add(t)
            teams.append({"team": t, "year": s.get("year")})
    cur_team = athlete.get("current_team")
    if cur_team and cur_team not in seen:
        teams.append({"team": cur_team, "year": None})

    return {
        "athlete_id": athlete_id,
        "permanent_id": format_permanent_id(athlete_id),
        "season_count": len(seasons),
        "total_evaluations": sum(p["evaluation_count"] for p in per_season) or len(evals),
        "seasons": per_season,
        "score_trend": score_trend,
        "best_measurements": best_measurements,
        "teams": teams,
    }


# ---------------- CSV import / export ----------------

CSV_COLUMNS = {
    # Standard / PBG columns
    "first name": "first_name", "lastname": "last_name", "last name": "last_name",
    "preferred name": "preferred_name", "nickname": "preferred_name",
    "date of birth": "date_of_birth", "dob": "date_of_birth", "birth date": "date_of_birth",
    "birthday": "date_of_birth", "birthdate": "date_of_birth",
    "graduation year": "graduation_year", "grad year": "graduation_year", "gradyear": "graduation_year",
    "class year": "graduation_year", "class of": "graduation_year",
    "primary position": "primary_position", "position": "primary_position", "pos": "primary_position",
    "secondary positions": "secondary_positions", "secondary position": "secondary_positions",
    "bats": "bats", "throws": "throws",
    "height": "height", "ht": "height", "weight": "weight", "wt": "weight",
    "team": "current_team", "current team": "current_team", "organization": "current_team",
    "club": "current_team", "travel team": "current_team",
    "school": "school", "high school": "school", "hs": "school",
    "city": "city", "state": "state", "country": "country",
    "guardian name": "guardian_name", "parent name": "guardian_name", "parent/guardian": "guardian_name",
    "parent": "guardian_name", "mother": "guardian_name", "father": "guardian_name",
    "guardian email": "guardian_email", "parent email": "guardian_email", "email": "guardian_email",
    "guardian phone": "guardian_phone", "parent phone": "guardian_phone", "phone": "guardian_phone",
    "mobile": "guardian_phone", "cell": "guardian_phone",
    "jersey number": "jersey_number", "jersey": "jersey_number", "number": "jersey_number", "#": "jersey_number",
    # GameChanger roster / export aliases (parents dump these onto the app)
    "player": "full_name", "player name": "full_name", "athlete": "full_name", "athlete name": "full_name",
    "name": "full_name", "full name": "full_name",
    "player first name": "first_name", "player last name": "last_name",
    "first": "first_name", "last": "last_name",
    "jersey #": "jersey_number", "jersey num": "jersey_number", "uniform number": "jersey_number",
    "uniform #": "jersey_number", "uniform": "jersey_number",
    "bat": "bats", "throw": "throws", "handedness": "bats",
    "team name": "current_team", "season team": "current_team",
    "age group": "age_group_hint", "agegroup": "age_group_hint", "division": "age_group_hint",
}


def _normalize_header(col: str) -> str:
    """Normalize CSV headers so GameChanger / spreadsheet variants map cleanly."""
    key = (col or "").strip().lower()
    key = key.replace("_", " ").replace("-", " ")
    # collapse whitespace
    key = " ".join(key.split())
    return key


def _split_full_name(full: str):
    parts = [p for p in (full or "").strip().split() if p]
    if not parts:
        return None, None
    if len(parts) == 1:
        return parts[0], parts[0]
    return parts[0], " ".join(parts[1:])


def parse_dob(value):
    value = (value or "").strip()
    if not value:
        return None, None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%m-%d-%Y", "%d/%m/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(value, fmt).strftime("%Y-%m-%d"), None
        except ValueError:
            continue
    return None, f"Unrecognized date format: {value}"


@router.post("/athletes/import/preview")
async def import_preview(file: UploadFile = File(...), user=Depends(require_roles(*ADMIN_ROLES))):
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Please upload a .csv file.")
    raw = await file.read()
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="CSV file is too large (max 5 MB).")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV appears to be empty.")
    mapping = {}
    unmapped = []
    for col in reader.fieldnames:
        key = _normalize_header(col)
        if key in CSV_COLUMNS:
            mapping[col] = CSV_COLUMNS[key]
        elif key in ("b/t", "bats/throws", "bat/throw"):
            mapping[col] = "bats_throws"
        else:
            unmapped.append(col)

    existing = await db.athletes.find({"organization_id": user["organization_id"], "status": {"$ne": "merged"}}, {"_id": 0, "first_name": 1, "last_name": 1, "date_of_birth": 1}).to_list(2000)
    existing_keys = {(e.get("first_name", "").lower(), e.get("last_name", "").lower(), e.get("date_of_birth")) for e in existing}

    rows = []
    for idx, row in enumerate(reader):
        if idx >= 500:
            break
        record = {}
        errors = []
        for col, field in mapping.items():
            val = (row.get(col) or "").strip()
            if field == "full_name":
                fn, ln = _split_full_name(val)
                if not record.get("first_name") and fn:
                    record["first_name"] = fn
                if not record.get("last_name") and ln:
                    record["last_name"] = ln
            elif field == "bats_throws":
                # GameChanger often exports "R/R", "L/R", "S/R"
                parts = [p.strip().upper()[:1] for p in val.replace("-", "/").split("/") if p.strip()]
                if parts:
                    record["bats"] = parts[0]
                if len(parts) > 1:
                    record["throws"] = parts[1]
            elif field == "age_group_hint":
                # Spreadsheet divisions arrive as "12U", "14U Majors", "8U-10U" — keep
                # only what maps onto a canonical band, otherwise fall back to the DOB.
                record["age_group_hint"] = normalize_age_band(val) if val else None
            elif field == "date_of_birth":
                parsed, err = parse_dob(val)
                if err:
                    errors.append(err)
                record[field] = parsed
            elif field == "graduation_year":
                if val:
                    try:
                        # accept "2028" or "Class of 2028"
                        digits = "".join(ch for ch in val if ch.isdigit())
                        record[field] = int(digits[:4]) if digits else None
                        if record[field] is None:
                            errors.append(f"Graduation year must be a number: {val}")
                    except ValueError:
                        errors.append(f"Graduation year must be a number: {val}")
                else:
                    record[field] = None
            elif field == "secondary_positions":
                record[field] = [p.strip() for p in val.replace(";", ",").split(",") if p.strip()] if val else []
            else:
                # don't overwrite a stronger explicit field with empty
                if val or field not in record:
                    record[field] = val or None
        if not record.get("first_name"):
            errors.append("First name is required")
        if not record.get("last_name"):
            errors.append("Last name is required")
        dup_key = ((record.get("first_name") or "").lower(), (record.get("last_name") or "").lower(), record.get("date_of_birth"))
        is_duplicate = dup_key in existing_keys
        rows.append({"row_number": idx + 2, "data": record, "errors": errors, "is_duplicate": is_duplicate, "valid": len(errors) == 0})

    return {
        "total_rows": len(rows),
        "valid_rows": sum(1 for r in rows if r["valid"] and not r["is_duplicate"]),
        "error_rows": sum(1 for r in rows if not r["valid"]),
        "duplicate_rows": sum(1 for r in rows if r["is_duplicate"]),
        "mapped_columns": mapping,
        "unmapped_columns": unmapped,
        "detected_format": "gamechanger" if any("game" in (c or "").lower() or c in ("Player", "Player Name", "Jersey #") for c in (reader.fieldnames or [])) or "full_name" in mapping.values() else "standard",
        "rows": rows,
    }


class ImportConfirmBody(BaseModel):
    rows: list[dict]
    include_duplicates: bool = False


@router.post("/athletes/import/confirm")
async def import_confirm(body: ImportConfirmBody, user=Depends(require_roles(*ADMIN_ROLES))):
    imported = 0
    skipped = 0
    for r in body.rows:
        data = r.get("data", {})
        if r.get("errors") or not data.get("first_name") or not data.get("last_name"):
            skipped += 1
            continue
        if r.get("is_duplicate") and not body.include_duplicates:
            skipped += 1
            continue
        doc = {
            "id": new_id(),
            "organization_id": user["organization_id"],
            "first_name": data.get("first_name"),
            "last_name": data.get("last_name"),
            "preferred_name": data.get("preferred_name"),
            "date_of_birth": data.get("date_of_birth"),
            "graduation_year": data.get("graduation_year"),
            "primary_position": data.get("primary_position"),
            "secondary_positions": data.get("secondary_positions") or [],
            "bats": data.get("bats"),
            "throws": data.get("throws"),
            "height": data.get("height"),
            "weight": data.get("weight"),
            "jersey_number": data.get("jersey_number"),
            "current_team": data.get("current_team"),
            "school": data.get("school"),
            "city": data.get("city"),
            "state": data.get("state"),
            "country": data.get("country") or "USA",
              "guardian_name": data.get("guardian_name"),
            "guardian_email": data.get("guardian_email"),
            "guardian_phone": data.get("guardian_phone"),
            "emergency_contact": None,
            "status": "active",
            "photo_url": None,
            "age": compute_age(data.get("date_of_birth")),
            "age_group": normalize_age_band(data.get("age_group_hint")) or compute_age_group(data.get("date_of_birth")),
            "created_by": user["id"],
            "created_at": now_iso(),
            "updated_at": now_iso(),
        }
        await db.athletes.insert_one(doc)
        imported += 1
    await log_audit(user["organization_id"], user, "athletes_imported", "athlete", None, {"imported": imported, "skipped": skipped})
    return {"imported": imported, "skipped": skipped, "message": f"Imported {imported} players. Skipped {skipped}."}


@router.get("/athletes-export/csv")
async def export_athletes(user=Depends(require_roles(*ADMIN_ROLES, "head_scout"))):
    athletes = await db.athletes.find({"organization_id": user["organization_id"], "status": {"$ne": "merged"}}, {"_id": 0}).to_list(2000)
    output = io.StringIO()
    fields = ["id", "first_name", "last_name", "preferred_name", "date_of_birth", "age", "age_group", "graduation_year",
              "primary_position", "secondary_positions", "bats", "throws", "height", "weight", "jersey_number",
              "current_team", "school", "city", "state", "country", "guardian_name", "guardian_email", "guardian_phone", "status"]
    writer = csv.writer(output)
    writer.writerow(fields)
    for a in athletes:
        row = []
        for f in fields:
            v = a.get(f)
            if isinstance(v, list):
                v = "; ".join(v)
            row.append(v if v is not None else "")
        writer.writerow(row)
    await log_audit(user["organization_id"], user, "athletes_exported", "athlete", None)
    return Response(content=output.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": "attachment; filename=606_players.csv"})
