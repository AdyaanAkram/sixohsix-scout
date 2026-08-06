import statistics
from collections import defaultdict
from datetime import datetime as _dt
from datetime import timedelta as _td
from datetime import timezone as _tz

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import (ADMIN_ROLES, COACH_ROLES, STAFF_ROLES, active_assignment_filter,
                  get_current_user, require_roles)
from config import settings
from db import clean, db, log_audit, new_id, now_iso
from mailer import safe_send
from positions import resolve_template

router = APIRouter()

EVENT_STATUSES = ["Draft", "Registration Open", "Registration Closed", "Check-In Open",
                  "Evaluation Active", "Evaluation Complete", "Reports Under Review", "Closed"]

DONE_STATUSES = ["submitted", "approved"]

# A draft untouched for this long on a live event day means the device stopped syncing.
STALE_DRAFT_MINUTES = 30

# Timing guards: a station evaluation running past this was a form left open, not work,
# and a handful of samples is not an average worth showing a manager.
MAX_EVALUATION_SECONDS = 4 * 60 * 60
MIN_EVALUATION_SAMPLE = 5


def _parse_iso(value: str | None):
    if not value:
        return None
    try:
        dt = _dt.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=_tz.utc)
        return dt
    except Exception:
        return None


class EventBody(BaseModel):
    name: str
    event_type: str = "Evaluation"
    date: str
    start_time: str | None = None
    end_time: str | None = None
    location: str | None = None
    description: str | None = None
    age_groups: list[str] = []
    status: str = "Draft"


class GroupBody(BaseModel):
    name: str


class StationBody(BaseModel):
    name: str
    template_id: str | None = None
    group_ids: list[str] = []
    start_time: str | None = None
    end_time: str | None = None


class AssignmentBody(BaseModel):
    evaluator_id: str
    station_id: str
    group_ids: list[str] = []


class RosterBody(BaseModel):
    athlete_ids: list[str]
    group_id: str | None = None  # optional — assign all added players to this group


class CheckInBody(BaseModel):
    status: str | None = None  # checked_in / absent / registered
    bib_number: str | None = None
    group_id: str | None = None
    late_arrival: bool | None = None
    flagged_incomplete: bool | None = None


@router.get("/events")
async def list_events(user=Depends(require_roles(*STAFF_ROLES))):
    q = {"organization_id": user["organization_id"]}
    if user["role"] == "evaluator":
        assignments = await db.evaluator_assignments.find(
            {"evaluator_id": user["id"], "organization_id": user["organization_id"],
             **active_assignment_filter()},
            {"_id": 0, "event_id": 1}).to_list(100)
        event_ids = list({a["event_id"] for a in assignments})
        q["id"] = {"$in": event_ids}
    events = await db.events.find(q, {"_id": 0}).sort("date", -1).to_list(200)
    for e in events:
        e["player_count"] = await db.event_athletes.count_documents(
            {"event_id": e["id"], "organization_id": user["organization_id"]})
        e["evaluator_count"] = len(await db.evaluator_assignments.distinct(
            "evaluator_id",
            {"event_id": e["id"], "organization_id": user["organization_id"],
             **active_assignment_filter()}))
    return events


@router.post("/events")
async def create_event(body: EventBody, user=Depends(require_roles(*ADMIN_ROLES))):
    if body.status not in EVENT_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid event status.")
    doc = body.model_dump()
    doc.update({"id": new_id(), "organization_id": user["organization_id"],
                "created_by": user["id"], "created_at": now_iso(), "updated_at": now_iso()})
    await db.events.insert_one(doc)
    await log_audit(user["organization_id"], user, "event_created", "event", doc["id"], {"name": body.name})
    return clean(doc)


async def get_org_event(event_id: str, user):
    ev = await db.events.find_one({"id": event_id, "organization_id": user["organization_id"]}, {"_id": 0})
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found.")
    return ev


@router.get("/events/{event_id}")
async def get_event(event_id: str, user=Depends(require_roles(*STAFF_ROLES))):
    ev = await get_org_event(event_id, user)
    org = user["organization_id"]
    if user["role"] == "evaluator":
        assigned = await db.evaluator_assignments.find_one({
            "evaluator_id": user["id"], "event_id": event_id, "organization_id": org,
            **active_assignment_filter()})
        if not assigned:
            raise HTTPException(status_code=403, detail="You are not assigned to this event.")
    ev["player_count"] = await db.event_athletes.count_documents({"event_id": event_id, "organization_id": org})
    ev["checked_in_count"] = await db.event_athletes.count_documents(
        {"event_id": event_id, "organization_id": org, "status": "checked_in"})
    ev["evaluator_count"] = len(await db.evaluator_assignments.distinct(
        "evaluator_id", {"event_id": event_id, "organization_id": org, **active_assignment_filter()}))
    ev["station_count"] = await db.stations.count_documents({"event_id": event_id, "organization_id": org})
    ev["group_count"] = await db.event_groups.count_documents({"event_id": event_id, "organization_id": org})
    return ev


@router.patch("/events/{event_id}")
async def update_event(event_id: str, body: EventBody, user=Depends(require_roles(*ADMIN_ROLES))):
    await get_org_event(event_id, user)
    if body.status not in EVENT_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid event status.")
    updates = body.model_dump()
    updates["updated_at"] = now_iso()
    await db.events.update_one({"id": event_id, "organization_id": user["organization_id"]}, {"$set": updates})
    await log_audit(user["organization_id"], user, "event_updated", "event", event_id, {"status": body.status})
    return {"message": "Event updated."}


class StatusBody(BaseModel):
    status: str


@router.post("/events/{event_id}/status")
async def set_event_status(event_id: str, body: StatusBody, user=Depends(require_roles(*ADMIN_ROLES))):
    await get_org_event(event_id, user)
    if body.status not in EVENT_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid event status.")
    await db.events.update_one(
        {"id": event_id, "organization_id": user["organization_id"]},
        {"$set": {"status": body.status, "updated_at": now_iso()}})
    await log_audit(user["organization_id"], user, "event_status_changed", "event", event_id, {"status": body.status})
    return {"message": f"Event status set to {body.status}."}


# ---------------- Roster ----------------

async def _require_event_assignment(event_id: str, user):
    """Staff must have an active assignment to the event (not necessarily station/group)."""
    await get_org_event(event_id, user)
    if user["role"] in ADMIN_ROLES or user["role"] == "head_scout":
        return
    assigned = await db.evaluator_assignments.find_one({
        "event_id": event_id, "organization_id": user["organization_id"],
        "evaluator_id": user["id"], **active_assignment_filter(),
    })
    if not assigned and user["role"] not in ("coach",):
        # coaches without an assignment still need hand-off at camps — allow if on staff of org
        # but evaluators must be assigned
        if user["role"] == "evaluator":
            raise HTTPException(status_code=403, detail="You are not assigned to this event.")
    if user["role"] == "evaluator" and not assigned:
        raise HTTPException(status_code=403, detail="You are not assigned to this event.")


@router.get("/events/{event_id}/roster")
async def event_roster(event_id: str, user=Depends(require_roles(*STAFF_ROLES))):
    await get_org_event(event_id, user)
    org = user["organization_id"]
    entries = await db.event_athletes.find({"event_id": event_id, "organization_id": org}, {"_id": 0}).to_list(1000)
    athlete_ids = [e["athlete_id"] for e in entries]
    athletes = await db.athletes.find(
        {"id": {"$in": athlete_ids}, "organization_id": org}, {"_id": 0}).to_list(1000)
    amap = {a["id"]: a for a in athletes}
    groups = await db.event_groups.find({"event_id": event_id, "organization_id": org}, {"_id": 0}).to_list(100)
    gmap = {g["id"]: g["name"] for g in groups}
    out = []
    for e in entries:
        a = amap.get(e["athlete_id"])
        if not a:
            continue
        out.append({
            **e,
            "first_name": a.get("first_name"), "last_name": a.get("last_name"),
            "preferred_name": a.get("preferred_name"), "photo_url": a.get("photo_url"),
            "age_group": a.get("age_group"), "primary_position": a.get("primary_position"),
            "current_team": a.get("current_team"), "group_name": gmap.get(e.get("group_id")),
            "jersey_number": a.get("jersey_number"),
        })
    out.sort(key=lambda x: (x.get("last_name") or "", x.get("first_name") or ""))
    return out


@router.get("/events/{event_id}/roster/search")
async def roster_search(event_id: str, q: str = "", user=Depends(require_roles(*STAFF_ROLES))):
    """Event-scoped athlete picker for hand-off evaluates (Task 2).

    Caller must be staff with an assignment to the event. Returns identity + eval status
    for the caller's stations when available.
    """
    await _require_event_assignment(event_id, user)
    org = user["organization_id"]
    entries = await db.event_athletes.find({"event_id": event_id, "organization_id": org}, {"_id": 0}).to_list(1000)
    athlete_ids = [e["athlete_id"] for e in entries]
    athletes = await db.athletes.find(
        {"id": {"$in": athlete_ids}, "organization_id": org}, {"_id": 0}).to_list(1000)
    amap = {a["id"]: a for a in athletes}
    needle = (q or "").strip().lower()
    # Evaluations for this event (any station) — surface status for the caller's stations
    my_station_ids = []
    my_assignments = await db.evaluator_assignments.find({
        "event_id": event_id, "organization_id": org, "evaluator_id": user["id"],
        **active_assignment_filter(),
    }, {"_id": 0, "station_id": 1, "id": 1}).to_list(50)
    my_station_ids = [a["station_id"] for a in my_assignments]
    evals = await db.evaluations.find({
        "event_id": event_id, "organization_id": org, "evaluator_id": user["id"],
    }, {"_id": 0, "athlete_id": 1, "status": 1, "id": 1, "station_id": 1}).to_list(1000)
    emap = {}
    for ev in evals:
        emap.setdefault(ev["athlete_id"], []).append(ev)

    out = []
    for e in entries:
        a = amap.get(e["athlete_id"])
        if not a:
            continue
        name = f"{a.get('first_name', '')} {a.get('last_name', '')}".strip()
        jersey = a.get("jersey_number") or e.get("bib_number") or ""
        if needle:
            hay = f"{name} {jersey} {a.get('primary_position') or ''} {a.get('age_group') or ''}".lower()
            if needle not in hay:
                continue
        my_evals = emap.get(a["id"]) or []
        primary_ev = next((ev for ev in my_evals if ev.get("station_id") in my_station_ids), my_evals[0] if my_evals else None)
        out.append({
            "athlete_id": a["id"],
            "first_name": a.get("first_name"),
            "last_name": a.get("last_name"),
            "jersey_number": a.get("jersey_number"),
            "bib_number": e.get("bib_number"),
            "age_group": a.get("age_group"),
            "primary_position": a.get("primary_position"),
            "roster_status": e.get("status"),
            "evaluation_id": primary_ev["id"] if primary_ev else None,
            "evaluation_status": primary_ev["status"] if primary_ev else "not_started",
            "default_assignment_id": (my_assignments[0]["id"] if my_assignments else None),
        })
    out.sort(key=lambda x: (x.get("last_name") or "", x.get("first_name") or ""))
    return out[:100]


@router.post("/events/{event_id}/roster")
async def add_to_roster(event_id: str, body: RosterBody, user=Depends(require_roles(*ADMIN_ROLES))):
    await get_org_event(event_id, user)
    group_id = body.group_id or None
    if group_id:
        g = await db.event_groups.find_one({
            "id": group_id, "event_id": event_id, "organization_id": user["organization_id"]})
        if not g:
            raise HTTPException(status_code=400, detail="That group is not on this event. Create it under Groups first.")
    added = 0
    for aid in body.athlete_ids:
        athlete = await db.athletes.find_one({"id": aid, "organization_id": user["organization_id"]})
        if not athlete:
            continue
        existing = await db.event_athletes.find_one({
            "event_id": event_id, "athlete_id": aid,
            "organization_id": user["organization_id"]})
        if existing:
            continue
        await db.event_athletes.insert_one({
            "id": new_id(), "organization_id": user["organization_id"],
            "event_id": event_id, "athlete_id": aid, "status": "registered",
            "bib_number": None, "group_id": group_id, "late_arrival": False,
            "flagged_incomplete": False, "walk_up": False,
            "created_at": now_iso(), "updated_at": now_iso(),
        })
        added += 1
    await log_audit(user["organization_id"], user, "roster_updated", "event", event_id, {"added": added, "group_id": group_id})
    return {"added": added, "message": f"Added {added} players to the event roster."}


@router.delete("/events/{event_id}/roster/{athlete_id}")
async def remove_from_roster(event_id: str, athlete_id: str, user=Depends(require_roles(*ADMIN_ROLES))):
    await get_org_event(event_id, user)
    await db.event_athletes.delete_one({
        "event_id": event_id, "athlete_id": athlete_id, "organization_id": user["organization_id"]})
    await log_audit(user["organization_id"], user, "roster_player_removed", "event", event_id, {"athlete_id": athlete_id})
    return {"message": "Player removed from roster."}


@router.patch("/events/{event_id}/roster/{athlete_id}")
async def update_checkin(event_id: str, athlete_id: str, body: CheckInBody, user=Depends(require_roles(*ADMIN_ROLES, "head_scout", "coach"))):
    await get_org_event(event_id, user)
    entry = await db.event_athletes.find_one({
        "event_id": event_id, "athlete_id": athlete_id, "organization_id": user["organization_id"]})
    if not entry:
        raise HTTPException(status_code=404, detail="Player is not on this event roster.")
    # exclude_unset so explicit null (e.g. clear group_id) is kept; omit untouched fields
    updates = body.model_dump(exclude_unset=True)
    if "status" in updates and updates["status"] not in ("registered", "checked_in", "absent"):
        raise HTTPException(status_code=400, detail="Invalid check-in status.")
    if updates.get("status") == "checked_in":
        updates["checked_in_at"] = now_iso()
    if "group_id" in updates and updates["group_id"]:
        g = await db.event_groups.find_one({
            "id": updates["group_id"], "event_id": event_id, "organization_id": user["organization_id"]})
        if not g:
            raise HTTPException(status_code=400, detail="That group is not on this event.")
    if "group_id" in updates and updates["group_id"] == "":
        updates["group_id"] = None
    if "bib_number" in updates:
        # ensure bib uniqueness within event
        dup = await db.event_athletes.find_one({
            "event_id": event_id, "organization_id": user["organization_id"],
            "bib_number": updates["bib_number"], "athlete_id": {"$ne": athlete_id}})
        if dup and updates["bib_number"]:
            raise HTTPException(status_code=400, detail=f"Bib #{updates['bib_number']} is already assigned to another player.")
    updates["updated_at"] = now_iso()
    await db.event_athletes.update_one(
        {"id": entry["id"], "organization_id": user["organization_id"]}, {"$set": updates})
    await log_audit(user["organization_id"], user, "check_in_updated", "event_athlete", entry["id"], updates)
    return {"message": "Check-in updated."}


class WalkUpBody(BaseModel):
    first_name: str
    last_name: str
    date_of_birth: str | None = None
    primary_position: str | None = None
    bib_number: str | None = None
    group_id: str | None = None


@router.post("/events/{event_id}/walk-up")
async def add_walk_up(event_id: str, body: WalkUpBody, user=Depends(require_roles(*ADMIN_ROLES))):
    await get_org_event(event_id, user)
    from routes_players import compute_age, compute_age_group
    aid = new_id()
    await db.athletes.insert_one({
        "id": aid, "organization_id": user["organization_id"],
        "first_name": body.first_name, "last_name": body.last_name,
        "preferred_name": None, "date_of_birth": body.date_of_birth,
        "age": compute_age(body.date_of_birth), "age_group": compute_age_group(body.date_of_birth),
        "graduation_year": None, "primary_position": body.primary_position,
        "secondary_positions": [], "bats": None, "throws": None, "height": None,
        "weight": None, "jersey_number": None, "current_team": None, "school": None,
        "city": None, "state": None, "country": "USA", "guardian_name": None,
        "guardian_email": None, "guardian_phone": None, "emergency_contact": None,
        "status": "active", "photo_url": None, "shared_with_organizations": [],
        "created_by": user["id"],
        "created_at": now_iso(), "updated_at": now_iso(),
    })
    await db.event_athletes.insert_one({
        "id": new_id(), "organization_id": user["organization_id"],
        "event_id": event_id, "athlete_id": aid, "status": "checked_in",
        "checked_in_at": now_iso(), "bib_number": body.bib_number,
        "group_id": body.group_id, "late_arrival": False, "flagged_incomplete": True,
        "walk_up": True, "created_at": now_iso(), "updated_at": now_iso(),
    })
    await log_audit(user["organization_id"], user, "walk_up_added", "event", event_id, {"athlete_id": aid, "name": f"{body.first_name} {body.last_name}"})
    return {"athlete_id": aid, "message": "Walk-up player added and checked in."}


# ---------------- Groups ----------------

@router.get("/events/{event_id}/groups")
async def list_groups(event_id: str, user=Depends(require_roles(*STAFF_ROLES))):
    await get_org_event(event_id, user)
    org = user["organization_id"]
    groups = await db.event_groups.find({"event_id": event_id, "organization_id": org}, {"_id": 0}).to_list(100)
    for g in groups:
        g["player_count"] = await db.event_athletes.count_documents(
            {"event_id": event_id, "organization_id": org, "group_id": g["id"]})
    return groups


@router.post("/events/{event_id}/groups")
async def create_group(event_id: str, body: GroupBody, user=Depends(require_roles(*ADMIN_ROLES))):
    await get_org_event(event_id, user)
    doc = {"id": new_id(), "organization_id": user["organization_id"], "event_id": event_id,
           "name": body.name, "created_at": now_iso()}
    await db.event_groups.insert_one(doc)
    return clean(doc)


@router.delete("/events/{event_id}/groups/{group_id}")
async def delete_group(event_id: str, group_id: str, user=Depends(require_roles(*ADMIN_ROLES))):
    await get_org_event(event_id, user)
    org = user["organization_id"]
    await db.event_groups.delete_one({"id": group_id, "event_id": event_id, "organization_id": org})
    await db.event_athletes.update_many(
        {"event_id": event_id, "organization_id": org, "group_id": group_id},
        {"$set": {"group_id": None}})
    return {"message": "Group deleted."}


# ---------------- Stations ----------------

@router.get("/events/{event_id}/stations")
async def list_stations(event_id: str, user=Depends(require_roles(*STAFF_ROLES))):
    await get_org_event(event_id, user)
    org = user["organization_id"]
    stations = await db.stations.find({"event_id": event_id, "organization_id": org}, {"_id": 0}).to_list(100)
    templates = await db.evaluation_templates.find({"organization_id": org}, {"_id": 0, "id": 1, "name": 1}).to_list(100)
    tmap = {t["id"]: t["name"] for t in templates}
    for s in stations:
        s["template_name"] = tmap.get(s.get("template_id"))
        assignments = await db.evaluator_assignments.find({
            "station_id": s["id"], "event_id": event_id,
            "organization_id": user["organization_id"], **active_assignment_filter(),
        }, {"_id": 0}).to_list(50)
        s["evaluator_count"] = len(assignments)
        # completion
        group_ids = s.get("group_ids") or []
        q = {"event_id": event_id, "organization_id": org, "status": "checked_in"}
        if group_ids:
            q["group_id"] = {"$in": group_ids}
        expected = await db.event_athletes.count_documents(q)
        done = await db.evaluations.count_documents({
            "event_id": event_id, "organization_id": org, "station_id": s["id"],
            "status": {"$in": DONE_STATUSES}})
        s["expected"] = expected
        s["completed"] = done
        s["completion_pct"] = round(done / expected * 100) if expected else 0
    return stations


@router.post("/events/{event_id}/stations")
async def create_station(event_id: str, body: StationBody, user=Depends(require_roles(*ADMIN_ROLES))):
    await get_org_event(event_id, user)
    doc = body.model_dump()
    doc.update({"id": new_id(), "organization_id": user["organization_id"], "event_id": event_id,
                "created_at": now_iso(), "updated_at": now_iso()})
    await db.stations.insert_one(doc)
    await log_audit(user["organization_id"], user, "station_created", "station", doc["id"], {"name": body.name})
    return clean(doc)


@router.patch("/events/{event_id}/stations/{station_id}")
async def update_station(event_id: str, station_id: str, body: StationBody, user=Depends(require_roles(*ADMIN_ROLES))):
    await get_org_event(event_id, user)
    updates = body.model_dump()
    updates["updated_at"] = now_iso()
    res = await db.stations.update_one(
        {"id": station_id, "event_id": event_id, "organization_id": user["organization_id"]},
        {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Station not found.")
    return {"message": "Station updated."}


@router.delete("/events/{event_id}/stations/{station_id}")
async def delete_station(event_id: str, station_id: str, user=Depends(require_roles(*ADMIN_ROLES))):
    await get_org_event(event_id, user)
    await db.stations.delete_one({
        "id": station_id, "event_id": event_id, "organization_id": user["organization_id"]})
    await db.evaluator_assignments.delete_many({
        "station_id": station_id, "organization_id": user["organization_id"]})
    return {"message": "Station removed."}


# ---------------- Evaluator assignments ----------------

@router.get("/events/{event_id}/assignments")
async def list_assignments(event_id: str, user=Depends(require_roles(*STAFF_ROLES))):
    await get_org_event(event_id, user)
    assignments = await db.evaluator_assignments.find({
        "event_id": event_id, "organization_id": user["organization_id"],
        **active_assignment_filter(),
    }, {"_id": 0}).to_list(200)
    user_ids = [a["evaluator_id"] for a in assignments]
    # users is a global collection (org lives on memberships), so the org scoping here is
    # the assignment query above — user_ids can only come from this org's assignments.
    users = await db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "full_name": 1, "email": 1}).to_list(200)
    umap = {u["id"]: u for u in users}
    org = user["organization_id"]
    stations = await db.stations.find({"event_id": event_id, "organization_id": org}, {"_id": 0, "id": 1, "name": 1}).to_list(100)
    smap = {s["id"]: s["name"] for s in stations}
    groups = await db.event_groups.find({"event_id": event_id, "organization_id": org}, {"_id": 0, "id": 1, "name": 1}).to_list(100)
    gmap = {g["id"]: g["name"] for g in groups}
    for a in assignments:
        u = umap.get(a["evaluator_id"], {})
        a["evaluator_name"] = u.get("full_name")
        a["evaluator_email"] = u.get("email")
        a["station_name"] = smap.get(a["station_id"])
        a["group_names"] = [gmap.get(g) for g in (a.get("group_ids") or []) if gmap.get(g)]
    return assignments


@router.post("/events/{event_id}/assignments")
async def create_assignment(event_id: str, body: AssignmentBody, user=Depends(require_roles(*ADMIN_ROLES))):
    await get_org_event(event_id, user)
    membership = await db.memberships.find_one({"user_id": body.evaluator_id, "organization_id": user["organization_id"], "active": True})
    if not membership:
        raise HTTPException(status_code=400, detail="Evaluator is not a member of this organization.")
    station = await db.stations.find_one({
        "id": body.station_id, "event_id": event_id, "organization_id": user["organization_id"]})
    if not station:
        raise HTTPException(status_code=400, detail="Station not found for this event.")
    existing = await db.evaluator_assignments.find_one({
        "event_id": event_id, "station_id": body.station_id,
        "evaluator_id": body.evaluator_id, "organization_id": user["organization_id"]})
    if existing:
        # Re-assigning is an explicit admin action: it revives a revoked/expired row,
        # otherwise the assignment would stay invisible to every active-filtered query.
        updates = {"group_ids": body.group_ids, "active": True, "expires_at": None,
                   "updated_at": now_iso()}
        await db.evaluator_assignments.update_one(
            {"id": existing["id"], "organization_id": user["organization_id"]}, {"$set": updates})
        if existing.get("active") is False or existing.get("expires_at"):
            await log_audit(user["organization_id"], user, "evaluator_assignment_reactivated",
                            "assignment", existing["id"],
                            {"evaluator_id": body.evaluator_id, "station": station["name"]})
        return {"id": existing["id"], "message": "Assignment updated."}
    doc = {"id": new_id(), "organization_id": user["organization_id"], "event_id": event_id,
           "station_id": body.station_id, "evaluator_id": body.evaluator_id,
           "group_ids": body.group_ids, "active": True, "expires_at": None,
           "created_by": user["id"],
           "created_at": now_iso(), "updated_at": now_iso()}
    await db.evaluator_assignments.insert_one(doc)
    await log_audit(user["organization_id"], user, "evaluator_assigned", "assignment", doc["id"], {"evaluator_id": body.evaluator_id, "station": station["name"]})
    return clean(doc)


@router.delete("/events/{event_id}/assignments/{assignment_id}")
async def delete_assignment(event_id: str, assignment_id: str, user=Depends(require_roles(*ADMIN_ROLES))):
    await get_org_event(event_id, user)
    await db.evaluator_assignments.delete_one({
        "id": assignment_id, "event_id": event_id, "organization_id": user["organization_id"]})
    await log_audit(user["organization_id"], user, "evaluator_assignment_removed",
                    "assignment", assignment_id, {"event_id": event_id})
    return {"message": "Assignment removed."}


# ---------------- Live progress ----------------

def _station_applies(station: dict, group_id: str | None) -> bool:
    """A station with no group_ids applies to everyone; otherwise only to its groups."""
    gids = station.get("group_ids") or []
    return not gids or group_id in gids


def _missing_required_metrics(template: dict | None, scores: dict | None) -> list[dict]:
    """Required metrics still unanswered — same rule submit_evaluation enforces."""
    scores = scores or {}
    out = []
    for m in (template or {}).get("metrics", []):
        if not m.get("required") or m.get("metric_type") in ("comment", "observation"):
            continue
        entry = scores.get(m.get("id")) or {}
        if entry.get("not_observed"):
            continue
        if entry.get("value") in (None, ""):
            out.append({"metric_id": m.get("id"), "name": m.get("name"),
                        "category": m.get("category"), "metric_type": m.get("metric_type")})
    return out


@router.get("/events/{event_id}/progress")
async def event_progress(event_id: str, user=Depends(require_roles(*COACH_ROLES))):
    """Event manager dashboard (spec §13).

    Coach-readable: aggregate counts plus staff names only. No athlete identity,
    guardian contact or individual score lives in this payload, so the whole
    endpoint opens to COACH_ROLES without field-level gating.
    """
    ev = await get_org_event(event_id, user)
    org = user["organization_id"]
    base = {"event_id": event_id, "organization_id": org}

    entries = await db.event_athletes.find(
        base, {"_id": 0, "athlete_id": 1, "group_id": 1, "status": 1, "flagged_incomplete": 1}
    ).to_list(2000)
    stations = await db.stations.find(base, {"_id": 0}).to_list(100)
    evals = await db.evaluations.find(base, {
        "_id": 0, "id": 1, "athlete_id": 1, "station_id": 1, "evaluator_id": 1, "status": 1,
        "started_at": 1, "created_at": 1, "submitted_at": 1, "updated_at": 1,
    }).to_list(5000)

    checked_in_entries = [e for e in entries if e.get("status") == "checked_in"]
    total_players = len(entries)
    checked_in = len(checked_in_entries)
    players_flagged = sum(1 for e in entries if e.get("flagged_incomplete"))

    done_by_station = defaultdict(int)
    draft_by_station = defaultdict(int)
    done_by_evaluator = defaultdict(int)
    done_by_athlete = defaultdict(set)
    draft_by_athlete = defaultdict(set)
    for e in evals:
        if e.get("status") in DONE_STATUSES:
            done_by_station[e.get("station_id")] += 1
            done_by_evaluator[(e.get("station_id"), e.get("evaluator_id"))] += 1
            done_by_athlete[e.get("athlete_id")].add(e.get("station_id"))
        elif e.get("status") == "draft":
            draft_by_station[e.get("station_id")] += 1
            draft_by_athlete[e.get("athlete_id")].add(e.get("station_id"))

    station_progress = []
    total_expected = 0
    total_done = 0
    total_drafts = 0
    for s in stations:
        expected = sum(1 for e in checked_in_entries if _station_applies(s, e.get("group_id")))
        done = done_by_station.get(s["id"], 0)
        drafts = draft_by_station.get(s["id"], 0)
        total_expected += expected
        total_done += done
        total_drafts += drafts
        station_progress.append({"station_id": s["id"], "station_name": s["name"], "expected": expected,
                                 "completed": done, "drafts": drafts,
                                 "completion_pct": round(done / expected * 100) if expected else 0})

    # Per-player rollup over the stations that actually apply to each player's group.
    players_complete = 0
    players_in_progress = 0
    players_not_started = 0
    for e in checked_in_entries:
        applicable = {s["id"] for s in stations if _station_applies(s, e.get("group_id"))}
        done = applicable & done_by_athlete.get(e["athlete_id"], set())
        drafted = applicable & draft_by_athlete.get(e["athlete_id"], set())
        if applicable and done == applicable:
            players_complete += 1
        elif done or drafted:
            players_in_progress += 1
        else:
            players_not_started += 1

    assignments = await db.evaluator_assignments.find({
        **base, **active_assignment_filter()}, {"_id": 0}).to_list(200)
    evaluator_ids = list({a["evaluator_id"] for a in assignments})
    users = await db.users.find({"id": {"$in": evaluator_ids}}, {"_id": 0, "id": 1, "full_name": 1}).to_list(200)
    umap = {u["id"]: u.get("full_name") for u in users}
    smap = {s["id"]: s["name"] for s in stations}
    evaluator_progress = []
    for a in assignments:
        group_ids = a.get("group_ids") or []
        expected = sum(1 for e in checked_in_entries
                       if not group_ids or e.get("group_id") in group_ids)
        done = done_by_evaluator.get((a["station_id"], a["evaluator_id"]), 0)
        evaluator_progress.append({"evaluator_id": a["evaluator_id"], "evaluator_name": umap.get(a["evaluator_id"], ""),
                                   "station_name": smap.get(a["station_id"], ""), "expected": expected, "completed": done,
                                   "completion_pct": round(done / expected * 100) if expected else 0})

    # Average time on task: only submitted evaluations carrying both timestamps.
    durations = []
    for e in evals:
        if e.get("status") not in DONE_STATUSES:
            continue
        start = _parse_iso(e.get("started_at") or e.get("created_at"))
        end = _parse_iso(e.get("submitted_at"))
        if not start or not end:
            continue
        seconds = (end - start).total_seconds()
        if seconds <= 0 or seconds > MAX_EVALUATION_SECONDS:
            continue  # clock skew or an abandoned form, not a real duration
        durations.append(seconds)
    enough = len(durations) >= MIN_EVALUATION_SAMPLE
    avg_evaluation_seconds = round(sum(durations) / len(durations)) if enough else None
    median_evaluation_seconds = round(statistics.median(durations)) if enough else None

    # Only honest sync signal available: a draft the device stopped syncing.
    stale_cutoff = _dt.now(_tz.utc) - _td(minutes=STALE_DRAFT_MINUTES)
    stale_drafts = 0
    for e in evals:
        if e.get("status") != "draft":
            continue
        seen = _parse_iso(e.get("updated_at"))
        if seen and seen < stale_cutoff:
            stale_drafts += 1

    eval_ids = [e["id"] for e in evals]
    pending_media_q = {
        "organization_id": org, "consent_status": "pending_consent",
        "$or": [{"event_id": event_id}, {"evaluation_id": {"$in": eval_ids}}],
    }
    media_awaiting_approval = await db.athlete_media.count_documents(pending_media_q)
    videos_awaiting_approval = await db.athlete_media.count_documents(
        {**pending_media_q, "file_type": "video"})

    return {
        "event": ev,
        "total_players": total_players,
        "checked_in": checked_in,
        "players_in_progress": players_in_progress,
        "players_complete": players_complete,
        "players_not_started": players_not_started,
        "players_missing_scores": max(0, checked_in - players_complete),
        "players_flagged": players_flagged,
        "active_evaluators": len(evaluator_ids),
        "evaluations_completed": total_done,
        "evaluations_expected": total_expected,
        "evaluations_remaining": max(0, total_expected - total_done),
        "evaluations_draft": total_drafts,
        "avg_evaluation_seconds": avg_evaluation_seconds,
        "median_evaluation_seconds": median_evaluation_seconds,
        "avg_evaluation_sample": len(durations),
        "videos_awaiting_approval": videos_awaiting_approval,
        "media_awaiting_approval": media_awaiting_approval,
        "sync_problems": stale_drafts,
        "sync_stale_threshold_minutes": STALE_DRAFT_MINUTES,
        "station_progress": station_progress,
        "evaluator_progress": evaluator_progress,
    }


@router.get("/events/{event_id}/players/{athlete_id}/progress")
async def event_player_progress(event_id: str, athlete_id: str,
                                user=Depends(require_roles(*COACH_ROLES))):
    """Per-player drill-down (spec §13): exactly what is still incomplete.

    Station applicability follows the same group_ids rule as reports/event-completion.
    """
    ev = await get_org_event(event_id, user)
    org = user["organization_id"]
    entry = await db.event_athletes.find_one(
        {"event_id": event_id, "athlete_id": athlete_id, "organization_id": org}, {"_id": 0})
    if not entry:
        raise HTTPException(status_code=404, detail="Player is not on this event roster.")
    athlete = await db.athletes.find_one(
        {"id": athlete_id, "organization_id": org},
        {"_id": 0, "id": 1, "first_name": 1, "last_name": 1, "preferred_name": 1,
         "photo_url": 1, "age_group": 1, "primary_position": 1, "jersey_number": 1})
    if not athlete:
        raise HTTPException(status_code=404, detail="Player not found.")

    stations = await db.stations.find(
        {"event_id": event_id, "organization_id": org}, {"_id": 0}).to_list(100)
    evals = await db.evaluations.find(
        {"event_id": event_id, "organization_id": org, "athlete_id": athlete_id}, {"_id": 0}).to_list(200)
    templates = await db.evaluation_templates.find({"organization_id": org}, {"_id": 0}).to_list(200)
    tmap = {t["id"]: t for t in templates}
    group = None
    if entry.get("group_id"):
        group = await db.event_groups.find_one(
            {"id": entry["group_id"], "event_id": event_id, "organization_id": org}, {"_id": 0, "name": 1})

    by_station = defaultdict(list)
    for e in evals:
        by_station[e.get("station_id")].append(e)

    rows = []
    counts = {"complete": 0, "draft": 0, "missing": 0}
    missing_stations = []
    for s in stations:
        if not _station_applies(s, entry.get("group_id")):
            rows.append({"station_id": s["id"], "station_name": s["name"], "applies": False,
                         "status": "n/a", "evaluation_id": None, "evaluator_id": None,
                         "evaluator_name": None, "updated_at": None, "submitted_at": None,
                         "template_id": None, "missing_required": []})
            continue
        station_evals = by_station.get(s["id"], [])
        done = next((e for e in station_evals if e.get("status") in DONE_STATUSES), None)
        draft = next((e for e in station_evals if e.get("status") == "draft"), None)
        picked = done or draft
        if done:
            status = "complete"
            missing_required = []
        elif draft:
            status = "draft"
            missing_required = _missing_required_metrics(tmap.get(draft.get("template_id")), draft.get("scores"))
        else:
            status = "missing"
            # Nothing started: report every required metric of the template this
            # player would resolve to, so the manager sees the real gap.
            template, _reason = resolve_template(
                templates, position=athlete.get("primary_position"),
                station_template_id=s.get("template_id"), age_group=athlete.get("age_group"))
            missing_required = _missing_required_metrics(template, {})
            picked = None
        counts[status] += 1
        if status != "complete":
            missing_stations.append(s["name"])
        rows.append({
            "station_id": s["id"], "station_name": s["name"], "applies": True, "status": status,
            "evaluation_id": picked["id"] if picked else None,
            "evaluator_id": picked.get("evaluator_id") if picked else None,
            "evaluator_name": picked.get("evaluator_name") if picked else None,
            "updated_at": picked.get("updated_at") if picked else None,
            "submitted_at": picked.get("submitted_at") if picked else None,
            "template_id": (picked or {}).get("template_id") if picked else None,
            "missing_required": missing_required,
        })

    applicable = counts["complete"] + counts["draft"] + counts["missing"]
    return {
        "event": {"id": ev["id"], "name": ev.get("name"), "date": ev.get("date"), "status": ev.get("status")},
        "athlete": athlete,
        "bib_number": entry.get("bib_number"),
        "group_id": entry.get("group_id"),
        "group_name": (group or {}).get("name"),
        "check_in_status": entry.get("status"),
        "late_arrival": bool(entry.get("late_arrival")),
        "walk_up": bool(entry.get("walk_up")),
        "flagged_incomplete": bool(entry.get("flagged_incomplete")),
        "complete": applicable > 0 and counts["complete"] == applicable,
        "stations_applicable": applicable,
        "stations_complete": counts["complete"],
        "stations_draft": counts["draft"],
        "stations_missing": counts["missing"],
        "missing_stations": missing_stations,
        "stations": rows,
    }


# ---------------- Event staff invite codes (redeem) ----------------

import secrets as _secrets


class EventInviteBody(BaseModel):
    email: str | None = None
    role: str = "evaluator"  # evaluator | coach
    station_id: str | None = None
    ttl_hours: int = 48


class RedeemBody(BaseModel):
    code: str
    email: str
    full_name: str
    password: str


@router.post("/events/{event_id}/invites")
async def create_event_invite(event_id: str, body: EventInviteBody, user=Depends(require_roles(*ADMIN_ROLES))):
    await get_org_event(event_id, user)
    if body.role not in ("evaluator", "coach"):
        raise HTTPException(status_code=400, detail="role must be evaluator or coach")
    code = _secrets.token_hex(3).upper()  # 6 hex chars
    expires = (_dt.now(_tz.utc) + _td(hours=body.ttl_hours)).isoformat()
    doc = {
        "id": new_id(),
        "organization_id": user["organization_id"],
        "event_id": event_id,
        "email": (body.email or "").lower() or None,
        "role": body.role,
        "station_id": body.station_id,
        "code": code,
        "invited_by": user["id"],
        "invited_at": now_iso(),
        "expires_at": expires,
        "accepted_at": None,
        "accepted_by_user_id": None,
        "revoked": False,
    }
    await db.event_invites.insert_one(doc)
    await log_audit(user["organization_id"], user, "event_invite_created", "event_invite", doc["id"],
                    {"event_id": event_id, "role": body.role})
    from notifications import notify
    delivered = None
    if doc["email"]:
        # In-app notification for an existing user...
        u = await db.users.find_one({"email": doc["email"]}, {"_id": 0, "id": 1})
        if u:
            await notify(u["id"], "event_invite", "Event invite code",
                         f"Your code is {code}", {"event_id": event_id, "code": code})
        # ...and email the code so a brand-new coach receives it (spec §12).
        # safe_send never raises: if mail is down the admin still has `code` below to relay.
        event = await db.events.find_one({"id": event_id}, {"_id": 0, "name": 1})
        org = await db.organizations.find_one({"id": user["organization_id"]}, {"_id": 0, "name": 1})
        result = safe_send(doc["email"], "event_access_code", {
            "name": "Coach",
            "code": code,
            "event_name": (event or {}).get("name") or "the event",
            "org": (org or {}).get("name") or "60'6\" Athletics",
            "app_url": settings.app_public_url,
        })
        delivered = result.get("sent")
    # `code` is returned so the admin can relay it manually (mail is best-effort).
    return {**clean(doc), "email_delivered": delivered}


@router.get("/events/{event_id}/invites")
async def list_event_invites(event_id: str, user=Depends(require_roles(*ADMIN_ROLES))):
    await get_org_event(event_id, user)
    return await db.event_invites.find(
        {"event_id": event_id, "organization_id": user["organization_id"]}, {"_id": 0}
    ).sort("invited_at", -1).to_list(100)


async def _access_expires_for_invite(inv: dict) -> str:
    """Membership/assignment expiry = later of invite TTL and event end (date + end_time)."""
    candidates = []
    inv_exp = _parse_iso(inv.get("expires_at"))
    if inv_exp:
        candidates.append(inv_exp)
    ev = await db.events.find_one(
        {"id": inv["event_id"], "organization_id": inv["organization_id"]},
        {"_id": 0, "date": 1, "end_time": 1})
    if ev and ev.get("date"):
        day = str(ev["date"])[:10]
        end_t = (ev.get("end_time") or "23:59").strip()
        if len(end_t) == 5:
            end_t = f"{end_t}:00"
        event_end = _parse_iso(f"{day}T{end_t}+00:00")
        if event_end:
            # grace through end of event day for late wrap-up
            candidates.append(event_end + _td(hours=12))
    if not candidates:
        return (_dt.now(_tz.utc) + _td(hours=48)).isoformat()
    return max(candidates).isoformat()


@router.post("/events/invites/{invite_id}/revoke")
async def revoke_event_invite(invite_id: str, user=Depends(require_roles(*ADMIN_ROLES))):
    inv = await db.event_invites.find_one({"id": invite_id, "organization_id": user["organization_id"]})
    if not inv:
        raise HTTPException(status_code=404, detail="Invite not found.")
    await db.event_invites.update_one(
        {"id": invite_id, "organization_id": user["organization_id"]},
        {"$set": {"revoked": True, "revoked_at": now_iso()}})
    # Deactivate temporary membership created via this invite (leave permanent staff alone)
    uid = inv.get("accepted_by_user_id")
    if uid:
        mem = await db.memberships.find_one({
            "user_id": uid, "organization_id": inv["organization_id"],
        })
        if mem and (mem.get("temporary") or mem.get("event_invite_id") == invite_id):
            await db.memberships.update_one(
                {"id": mem["id"], "organization_id": inv["organization_id"]},
                {"$set": {"active": False, "revoked_at": now_iso(), "updated_at": now_iso()}},
            )
        await db.evaluator_assignments.update_many(
            {"event_id": inv["event_id"], "evaluator_id": uid, "organization_id": inv["organization_id"]},
            {"$set": {"active": False, "revoked_at": now_iso(), "updated_at": now_iso()}},
        )
    return {"message": "Invite revoked."}


@router.post("/events/redeem")
async def redeem_event_invite(body: RedeemBody):
    """Public redeem — creates user membership + optional station assignment."""
    from auth import hash_password
    code = body.code.strip().upper()
    inv = await db.event_invites.find_one({"code": code, "revoked": False})
    if not inv:
        raise HTTPException(status_code=404, detail="Invalid invite code.")
    if inv.get("accepted_at"):
        raise HTTPException(status_code=400, detail="This code was already used.")
    try:
        exp = _dt.fromisoformat(inv["expires_at"].replace("Z", "+00:00"))
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=_tz.utc)
        if exp < _dt.now(_tz.utc):
            raise HTTPException(status_code=400, detail="This invite code has expired.")
    except HTTPException:
        raise
    except Exception:
        pass
    email = body.email.strip().lower()
    if inv.get("email") and inv["email"] != email:
        raise HTTPException(status_code=400, detail="This code was issued for a different email.")
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")
    org_id = inv["organization_id"]
    access_expires = await _access_expires_for_invite(inv)
    membership_fields = {
        "role": inv["role"],
        "active": True,
        "temporary": True,
        "expires_at": access_expires,
        "event_invite_id": inv["id"],
        "event_id": inv["event_id"],
        "updated_at": now_iso(),
    }
    existing = await db.users.find_one({"email": email})
    if existing:
        uid = existing["id"]
        mem = await db.memberships.find_one({"user_id": uid, "organization_id": org_id})
        if not mem:
            await db.memberships.insert_one({
                "id": new_id(), "user_id": uid, "organization_id": org_id,
                "created_at": now_iso(), **membership_fields,
            })
        elif mem.get("temporary") or not mem.get("active"):
            # Refresh temporary access; do not demote permanent staff on re-redeem edge cases
            await db.memberships.update_one(
                {"id": mem["id"], "organization_id": org_id}, {"$set": membership_fields})
        else:
            # Permanent member redeeming an event invite — never expire their standing org
            # membership. Their event-scoped access is the assignment written below, which
            # carries access_expires (spec §12.7). An invite with no station_id grants a
            # permanent member nothing beyond the org access they already have.
            pass
    else:
        uid = new_id()
        await db.users.insert_one({
            "id": uid, "email": email, "full_name": body.full_name.strip(),
            "password_hash": hash_password(body.password), "active": True,
            "created_at": now_iso(), "updated_at": now_iso(),
        })
        await db.memberships.insert_one({
            "id": new_id(), "user_id": uid, "organization_id": org_id,
            "created_at": now_iso(), **membership_fields,
        })
    # Both invited roles work a station, so both get an expiring assignment.
    if inv.get("station_id"):
        existing_a = await db.evaluator_assignments.find_one({
            "event_id": inv["event_id"], "station_id": inv["station_id"],
            "evaluator_id": uid, "organization_id": org_id})
        if not existing_a:
            await db.evaluator_assignments.insert_one({
                "id": new_id(), "organization_id": org_id, "event_id": inv["event_id"],
                "station_id": inv["station_id"], "evaluator_id": uid, "group_ids": [],
                "expires_at": access_expires, "active": True,
                "created_by": inv.get("invited_by"), "created_at": now_iso(), "updated_at": now_iso(),
            })
        else:
            await db.evaluator_assignments.update_one(
                {"id": existing_a["id"], "organization_id": org_id},
                {"$set": {"expires_at": access_expires, "active": True, "updated_at": now_iso()}},
            )
    await db.event_invites.update_one({"id": inv["id"], "organization_id": org_id}, {"$set": {
        "accepted_at": now_iso(), "accepted_by_user_id": uid,
        "access_expires_at": access_expires,
    }})
    from auth import create_token
    await db.users.update_one(
        {"id": uid}, {"$set": {"active_organization_id": org_id, "updated_at": now_iso()}})
    org = await db.organizations.find_one({"id": org_id}, {"_id": 0, "name": 1})
    return {
        "token": create_token(uid, org_id),
        "user": {
            "id": uid, "email": email, "full_name": body.full_name.strip(),
            "role": inv["role"], "organization_id": org_id,
            "organization_name": (org or {}).get("name"),
            "membership_expires_at": access_expires,
        },
        "event_id": inv["event_id"],
        "expires_at": access_expires,
    }
