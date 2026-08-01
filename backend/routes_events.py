from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import ADMIN_ROLES, STAFF_ROLES, get_current_user, require_roles
from db import clean, db, log_audit, new_id, now_iso

router = APIRouter()

EVENT_STATUSES = ["Draft", "Registration Open", "Registration Closed", "Check-In Open",
                  "Evaluation Active", "Evaluation Complete", "Reports Under Review", "Closed"]


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
            {"evaluator_id": user["id"], "organization_id": user["organization_id"]},
            {"_id": 0, "event_id": 1}).to_list(100)
        event_ids = list({a["event_id"] for a in assignments})
        q["id"] = {"$in": event_ids}
    events = await db.events.find(q, {"_id": 0}).sort("date", -1).to_list(200)
    for e in events:
        e["player_count"] = await db.event_athletes.count_documents({"event_id": e["id"]})
        e["evaluator_count"] = len(await db.evaluator_assignments.distinct("evaluator_id", {"event_id": e["id"]}))
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
    if user["role"] == "evaluator":
        assigned = await db.evaluator_assignments.find_one({"evaluator_id": user["id"], "event_id": event_id})
        if not assigned:
            raise HTTPException(status_code=403, detail="You are not assigned to this event.")
    ev["player_count"] = await db.event_athletes.count_documents({"event_id": event_id})
    ev["checked_in_count"] = await db.event_athletes.count_documents({"event_id": event_id, "status": "checked_in"})
    ev["evaluator_count"] = len(await db.evaluator_assignments.distinct("evaluator_id", {"event_id": event_id}))
    ev["station_count"] = await db.stations.count_documents({"event_id": event_id})
    ev["group_count"] = await db.event_groups.count_documents({"event_id": event_id})
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
        "evaluator_id": user["id"],
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
        existing = await db.event_athletes.find_one({"event_id": event_id, "athlete_id": aid})
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
    groups = await db.event_groups.find({"event_id": event_id}, {"_id": 0}).to_list(100)
    for g in groups:
        g["player_count"] = await db.event_athletes.count_documents({"event_id": event_id, "group_id": g["id"]})
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
    await db.event_groups.delete_one({"id": group_id, "event_id": event_id})
    await db.event_athletes.update_many({"event_id": event_id, "group_id": group_id}, {"$set": {"group_id": None}})
    return {"message": "Group deleted."}


# ---------------- Stations ----------------

@router.get("/events/{event_id}/stations")
async def list_stations(event_id: str, user=Depends(require_roles(*STAFF_ROLES))):
    await get_org_event(event_id, user)
    stations = await db.stations.find({"event_id": event_id}, {"_id": 0}).to_list(100)
    templates = await db.evaluation_templates.find({"organization_id": user["organization_id"]}, {"_id": 0, "id": 1, "name": 1}).to_list(100)
    tmap = {t["id"]: t["name"] for t in templates}
    for s in stations:
        s["template_name"] = tmap.get(s.get("template_id"))
        assignments = await db.evaluator_assignments.find({"station_id": s["id"]}, {"_id": 0}).to_list(50)
        s["evaluator_count"] = len(assignments)
        # completion
        group_ids = s.get("group_ids") or []
        q = {"event_id": event_id, "status": "checked_in"}
        if group_ids:
            q["group_id"] = {"$in": group_ids}
        expected = await db.event_athletes.count_documents(q)
        done = await db.evaluations.count_documents({"event_id": event_id, "station_id": s["id"], "status": {"$in": ["submitted", "approved"]}})
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
    res = await db.stations.update_one({"id": station_id, "event_id": event_id}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Station not found.")
    return {"message": "Station updated."}


@router.delete("/events/{event_id}/stations/{station_id}")
async def delete_station(event_id: str, station_id: str, user=Depends(require_roles(*ADMIN_ROLES))):
    await get_org_event(event_id, user)
    await db.stations.delete_one({"id": station_id, "event_id": event_id})
    await db.evaluator_assignments.delete_many({"station_id": station_id})
    return {"message": "Station removed."}


# ---------------- Evaluator assignments ----------------

@router.get("/events/{event_id}/assignments")
async def list_assignments(event_id: str, user=Depends(require_roles(*STAFF_ROLES))):
    await get_org_event(event_id, user)
    assignments = await db.evaluator_assignments.find({"event_id": event_id}, {"_id": 0}).to_list(200)
    user_ids = [a["evaluator_id"] for a in assignments]
    users = await db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "full_name": 1, "email": 1}).to_list(200)
    umap = {u["id"]: u for u in users}
    stations = await db.stations.find({"event_id": event_id}, {"_id": 0, "id": 1, "name": 1}).to_list(100)
    smap = {s["id"]: s["name"] for s in stations}
    groups = await db.event_groups.find({"event_id": event_id}, {"_id": 0, "id": 1, "name": 1}).to_list(100)
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
    station = await db.stations.find_one({"id": body.station_id, "event_id": event_id})
    if not station:
        raise HTTPException(status_code=400, detail="Station not found for this event.")
    existing = await db.evaluator_assignments.find_one({"event_id": event_id, "station_id": body.station_id, "evaluator_id": body.evaluator_id})
    if existing:
        await db.evaluator_assignments.update_one({"id": existing["id"]}, {"$set": {"group_ids": body.group_ids, "updated_at": now_iso()}})
        return {"id": existing["id"], "message": "Assignment updated."}
    doc = {"id": new_id(), "organization_id": user["organization_id"], "event_id": event_id,
           "station_id": body.station_id, "evaluator_id": body.evaluator_id,
           "group_ids": body.group_ids, "created_by": user["id"],
           "created_at": now_iso(), "updated_at": now_iso()}
    await db.evaluator_assignments.insert_one(doc)
    await log_audit(user["organization_id"], user, "evaluator_assigned", "assignment", doc["id"], {"evaluator_id": body.evaluator_id, "station": station["name"]})
    return clean(doc)


@router.delete("/events/{event_id}/assignments/{assignment_id}")
async def delete_assignment(event_id: str, assignment_id: str, user=Depends(require_roles(*ADMIN_ROLES))):
    await get_org_event(event_id, user)
    await db.evaluator_assignments.delete_one({"id": assignment_id, "event_id": event_id})
    return {"message": "Assignment removed."}


# ---------------- Live progress ----------------

@router.get("/events/{event_id}/progress")
async def event_progress(event_id: str, user=Depends(require_roles(*ADMIN_ROLES, "head_scout"))):
    ev = await get_org_event(event_id, user)
    total_players = await db.event_athletes.count_documents({"event_id": event_id})
    checked_in = await db.event_athletes.count_documents({"event_id": event_id, "status": "checked_in"})
    stations = await db.stations.find({"event_id": event_id}, {"_id": 0}).to_list(100)
    station_progress = []
    total_expected = 0
    total_done = 0
    for s in stations:
        group_ids = s.get("group_ids") or []
        q = {"event_id": event_id, "status": "checked_in"}
        if group_ids:
            q["group_id"] = {"$in": group_ids}
        expected = await db.event_athletes.count_documents(q)
        done = await db.evaluations.count_documents({"event_id": event_id, "station_id": s["id"], "status": {"$in": ["submitted", "approved"]}})
        drafts = await db.evaluations.count_documents({"event_id": event_id, "station_id": s["id"], "status": "draft"})
        total_expected += expected
        total_done += done
        station_progress.append({"station_id": s["id"], "station_name": s["name"], "expected": expected,
                                 "completed": done, "drafts": drafts,
                                 "completion_pct": round(done / expected * 100) if expected else 0})
    # evaluator progress
    assignments = await db.evaluator_assignments.find({"event_id": event_id}, {"_id": 0}).to_list(200)
    evaluator_progress = []
    for a in assignments:
        u = await db.users.find_one({"id": a["evaluator_id"]}, {"_id": 0, "full_name": 1})
        s = await db.stations.find_one({"id": a["station_id"]}, {"_id": 0, "name": 1})
        group_ids = a.get("group_ids") or []
        q = {"event_id": event_id, "status": "checked_in"}
        if group_ids:
            q["group_id"] = {"$in": group_ids}
        expected = await db.event_athletes.count_documents(q)
        done = await db.evaluations.count_documents({"event_id": event_id, "station_id": a["station_id"], "evaluator_id": a["evaluator_id"], "status": {"$in": ["submitted", "approved"]}})
        evaluator_progress.append({"evaluator_id": a["evaluator_id"], "evaluator_name": u.get("full_name") if u else "",
                                   "station_name": s.get("name") if s else "", "expected": expected, "completed": done,
                                   "completion_pct": round(done / expected * 100) if expected else 0})
    return {
        "event": ev, "total_players": total_players, "checked_in": checked_in,
        "evaluations_completed": total_done, "evaluations_expected": total_expected,
        "evaluations_remaining": max(0, total_expected - total_done),
        "station_progress": station_progress, "evaluator_progress": evaluator_progress,
    }


# ---------------- Event staff invite codes (redeem) ----------------

import secrets as _secrets
from datetime import datetime as _dt, timedelta as _td, timezone as _tz


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
    # optional: notify existing user by email match
    if doc["email"]:
        u = await db.users.find_one({"email": doc["email"]}, {"_id": 0, "id": 1})
        if u:
            await notify(u["id"], "event_invite", "Event invite code",
                         f"Your code is {code}", {"event_id": event_id, "code": code})
    return clean(doc)


@router.get("/events/{event_id}/invites")
async def list_event_invites(event_id: str, user=Depends(require_roles(*ADMIN_ROLES))):
    await get_org_event(event_id, user)
    return await db.event_invites.find(
        {"event_id": event_id, "organization_id": user["organization_id"]}, {"_id": 0}
    ).sort("invited_at", -1).to_list(100)


@router.post("/events/invites/{invite_id}/revoke")
async def revoke_event_invite(invite_id: str, user=Depends(require_roles(*ADMIN_ROLES))):
    inv = await db.event_invites.find_one({"id": invite_id, "organization_id": user["organization_id"]})
    if not inv:
        raise HTTPException(status_code=404, detail="Invite not found.")
    await db.event_invites.update_one({"id": invite_id}, {"$set": {"revoked": True}})
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
    existing = await db.users.find_one({"email": email})
    if existing:
        uid = existing["id"]
        mem = await db.memberships.find_one({"user_id": uid, "organization_id": org_id})
        if not mem:
            await db.memberships.insert_one({
                "id": new_id(), "user_id": uid, "organization_id": org_id,
                "role": inv["role"], "active": True, "created_at": now_iso(),
            })
        else:
            await db.memberships.update_one({"id": mem["id"]}, {"$set": {"role": inv["role"], "active": True}})
    else:
        uid = new_id()
        await db.users.insert_one({
            "id": uid, "email": email, "full_name": body.full_name.strip(),
            "password_hash": hash_password(body.password), "active": True,
            "created_at": now_iso(), "updated_at": now_iso(),
        })
        await db.memberships.insert_one({
            "id": new_id(), "user_id": uid, "organization_id": org_id,
            "role": inv["role"], "active": True, "created_at": now_iso(),
        })
    if inv.get("station_id") and inv["role"] == "evaluator":
        existing_a = await db.evaluator_assignments.find_one({
            "event_id": inv["event_id"], "station_id": inv["station_id"], "evaluator_id": uid})
        if not existing_a:
            await db.evaluator_assignments.insert_one({
                "id": new_id(), "organization_id": org_id, "event_id": inv["event_id"],
                "station_id": inv["station_id"], "evaluator_id": uid, "group_ids": [],
                "created_by": inv.get("invited_by"), "created_at": now_iso(), "updated_at": now_iso(),
            })
    await db.event_invites.update_one({"id": inv["id"]}, {"$set": {
        "accepted_at": now_iso(), "accepted_by_user_id": uid,
    }})
    from auth import create_token
    org = await db.organizations.find_one({"id": org_id}, {"_id": 0, "name": 1})
    return {
        "token": create_token(uid),
        "user": {
            "id": uid, "email": email, "full_name": body.full_name.strip(),
            "role": inv["role"], "organization_id": org_id,
            "organization_name": (org or {}).get("name"),
        },
        "event_id": inv["event_id"],
    }
