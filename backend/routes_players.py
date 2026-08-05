import csv
import io
from datetime import date, datetime

from fastapi import (APIRouter, Depends, File, HTTPException, Query, Response,
                     UploadFile)
from pydantic import BaseModel

from auth import ADMIN_ROLES, COACH_ROLES, STAFF_ROLES, get_current_user, require_roles
from db import clean, db, log_audit, new_id, now_iso
from positions import POSITION_TAXONOMY
from scoring import aggregate_player_scores

router = APIRouter()

POSITIONS = list(POSITION_TAXONOMY)
AGE_GROUPS = [
    "7U", "8U", "9U", "10U", "11U", "12U", "13U", "14U", "15U", "16U", "17U", "18U",
    "7U-8U", "8U-10U", "11U-13U", "14U-18U", "College", "Pro",
]


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
    age = compute_age(dob_str)
    if age is None:
        return None
    if age <= 7:
        return "7U"
    if age >= 19:
        return "College"
    return f"{age}U"


def age_group_matches_template(athlete_age: str | None, template_age: str | None) -> bool:
    """True if template age_group applies to athlete age_group."""
    if not template_age:
        return True  # blank = all ages
    if not athlete_age:
        return False
    ta = str(template_age).strip()
    aa = str(athlete_age).strip()
    if ta == aa:
        return True
    if ta in ("College", "Pro") and aa in ("College", "Pro"):
        return ta == aa
    # Band like 9U-10U
    if "-" in ta and ta[0].isdigit():
        parts = ta.replace("U", "").split("-")
        try:
            lo, hi = int(parts[0]), int(parts[1])
            if aa.endswith("U") and aa[:-1].isdigit():
                n = int(aa[:-1])
                return lo <= n <= hi
        except Exception:
            return False
    return False


class AthleteBody(BaseModel):
    first_name: str
    last_name: str
    preferred_name: str | None = None
    date_of_birth: str | None = None
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
        "age_group": compute_age_group(body.date_of_birth),
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
    limit: int = 200,
    user=Depends(require_roles(*STAFF_ROLES)),
):
    q = {"organization_id": user["organization_id"]}
    if status:
        q["status"] = status
    if age_group:
        q["age_group"] = age_group
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
    updates["age_group"] = compute_age_group(body.date_of_birth)
    updates["updated_at"] = now_iso()
    await db.athletes.update_one({"id": athlete_id}, {"$set": updates})
    await log_audit(user["organization_id"], user, "athlete_updated", "athlete", athlete_id)
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
async def athlete_summary(athlete_id: str, user=Depends(require_roles(*STAFF_ROLES))):
    a = await db.athletes.find_one({"id": athlete_id, "organization_id": user["organization_id"]}, {"_id": 0})
    if not a:
        raise HTTPException(status_code=404, detail="Player not found.")
    evals = await db.evaluations.find({
        "athlete_id": athlete_id, "organization_id": user["organization_id"],
        "status": {"$in": ["submitted", "approved"]},
    }, {"_id": 0}).sort("submitted_at", 1).to_list(500)

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
            computed = (ev.get("computed") or {}).get("metrics") or {}
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

    latest = event_scores[-1] if event_scores else None
    previous = event_scores[-2] if len(event_scores) > 1 else None
    goals = await db.athlete_goals.find({"athlete_id": athlete_id, "status": {"$nin": ["Archived"]}}, {"_id": 0}).sort("created_at", -1).to_list(20)
    latest_scout = await db.athlete_notes.find_one(
        {"athlete_id": athlete_id, "note_type": {"$in": ["scout_assessment", "scout"]}},
        {"_id": 0}, sort=[("created_at", -1)])

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


class SeasonPatch(BaseModel):
    year: int | None = None
    team: str | None = None
    organization_name: str | None = None
    age_group: str | None = None
    height: str | None = None
    weight: str | None = None


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
        "age_group": body.age_group,
        "height": body.height,
        "weight": body.weight,
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
    updates = {**raw, "updated_at": now_iso()}
    await db.athlete_seasons.update_one(
        {"id": season_id, "organization_id": user["organization_id"]}, {"$set": updates})
    await log_audit(user["organization_id"], user, "season_updated", "athlete_season", season_id,
                    {"athlete_id": athlete_id})
    doc = await db.athlete_seasons.find_one({"id": season_id}, {"_id": 0})
    return clean(doc)


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
                record["age_group_hint"] = val or None
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
            "age_group": data.get("age_group_hint") or compute_age_group(data.get("date_of_birth")),
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
