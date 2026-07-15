import csv
import io
from datetime import date, datetime

from fastapi import (APIRouter, Depends, File, HTTPException, Query, Response,
                     UploadFile)
from pydantic import BaseModel

from auth import ADMIN_ROLES, COACH_ROLES, STAFF_ROLES, get_current_user, require_roles
from db import clean, db, log_audit, new_id, now_iso
from scoring import aggregate_player_scores

router = APIRouter()

POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "IF", "OF", "UTIL", "DH"]
AGE_GROUPS = ["8U", "9U", "10U", "11U", "12U", "13U", "14U", "15U", "16U", "17U", "18U"]


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
    bracket = min(max(age + (age % 2), 8), 18)
    return f"{bracket}U"


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
    status: str = "active"
    photo_url: str | None = None


def athlete_doc(body: AthleteBody, org_id: str, user_id: str):
    doc = body.model_dump()
    doc.update({
        "id": new_id(),
        "organization_id": org_id,
        "age": compute_age(body.date_of_birth),
        "age_group": compute_age_group(body.date_of_birth),
        "created_by": user_id,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    })
    return doc


GUARDIAN_FIELDS = ["guardian_name", "guardian_email", "guardian_phone", "emergency_contact"]


def restrict_guardian(doc, role):
    """Evaluators do not need guardian/emergency contact info (minor privacy)."""
    if role == "evaluator":
        for f in GUARDIAN_FIELDS:
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
    for event_id, evs in by_event.items():
        agg = aggregate_player_scores(evs)
        event = await db.events.find_one({"id": event_id}, {"_id": 0, "name": 1, "date": 1})
        event_scores.append({
            "event_id": event_id,
            "event_name": event.get("name") if event else "Event",
            "event_date": event.get("date") if event else None,
            "overall_score": agg["overall_score"],
            "category_scores": agg["category_scores"],
        })
    event_scores.sort(key=lambda x: x.get("event_date") or "")

    latest = event_scores[-1] if event_scores else None
    previous = event_scores[-2] if len(event_scores) > 1 else None
    goals = await db.athlete_goals.find({"athlete_id": athlete_id, "status": {"$nin": ["Archived"]}}, {"_id": 0}).sort("created_at", -1).to_list(20)
    latest_scout = await db.athlete_notes.find_one(
        {"athlete_id": athlete_id, "note_type": "scout_assessment"}, {"_id": 0}, sort=[("created_at", -1)])

    # aggregate skill summary across all evals (latest event weighted most: use all)
    agg_all = aggregate_player_scores(evals)

    return {
        "athlete": restrict_guardian(a, user["role"]),
        "latest_overall": latest["overall_score"] if latest else None,
        "previous_overall": previous["overall_score"] if previous else None,
        "score_change": round(latest["overall_score"] - previous["overall_score"], 2) if latest and previous and latest["overall_score"] is not None and previous["overall_score"] is not None else None,
        "evaluation_count": len(evals),
        "last_evaluation_date": evals[-1].get("submitted_at") if evals else None,
        "event_scores": event_scores,
        "category_scores": agg_all["category_scores"],
        "goals": goals,
        "latest_scout_assessment": latest_scout,
        "position_projection": (latest_scout or {}).get("position_recommendation") or a.get("position_projection"),
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
    for n in notes:
        items.append({
            "type": "note" if n.get("note_type") != "scout_assessment" else "scout_note",
            "date": n.get("assessment_date") or n.get("created_at"),
            "title": n.get("assessment_type", "Note") if n.get("note_type") != "scout_assessment" else "Head Scout Assessment",
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
    items.sort(key=lambda x: x.get("date") or "", reverse=True)
    return items


# ---------------- CSV import / export ----------------

CSV_COLUMNS = {
    "first name": "first_name", "last name": "last_name", "preferred name": "preferred_name",
    "date of birth": "date_of_birth", "dob": "date_of_birth", "graduation year": "graduation_year",
    "grad year": "graduation_year", "primary position": "primary_position",
    "secondary positions": "secondary_positions", "bats": "bats", "throws": "throws",
    "height": "height", "weight": "weight", "team": "current_team", "current team": "current_team",
    "school": "school", "city": "city", "state": "state", "country": "country",
    "guardian name": "guardian_name", "guardian email": "guardian_email", "guardian phone": "guardian_phone",
    "jersey number": "jersey_number", "jersey": "jersey_number",
}


def parse_dob(value):
    value = (value or "").strip()
    if not value:
        return None, None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%m-%d-%Y", "%d/%m/%Y"):
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
        key = (col or "").strip().lower()
        if key in CSV_COLUMNS:
            mapping[col] = CSV_COLUMNS[key]
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
            if field == "date_of_birth":
                parsed, err = parse_dob(val)
                if err:
                    errors.append(err)
                record[field] = parsed
            elif field == "graduation_year":
                if val:
                    try:
                        record[field] = int(val)
                    except ValueError:
                        errors.append(f"Graduation year must be a number: {val}")
                else:
                    record[field] = None
            elif field == "secondary_positions":
                record[field] = [p.strip() for p in val.replace(";", ",").split(",") if p.strip()] if val else []
            else:
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
            "age_group": compute_age_group(data.get("date_of_birth")),
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
                    headers={"Content-Disposition": "attachment; filename=pbg_players.csv"})
