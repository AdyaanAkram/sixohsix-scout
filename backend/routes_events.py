import csv
import io
import math
import re
import statistics
from collections import defaultdict
from datetime import datetime as _dt
from datetime import timedelta as _td
from datetime import timezone as _tz

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from pydantic import BaseModel

from auth import (ADMIN_ROLES, COACH_ROLES, STAFF_ROLES, active_assignment_filter,
                  get_current_user, require_roles)
from config import settings
from db import clean, db, log_audit, new_id, now_iso
from mailer import safe_send
from positions import AGE_BAND_SPANS, resolve_template, validate_positions
from scoring import metric_meta

router = APIRouter()

# Canonical event lifecycle. Draft -> Setup -> Ready -> Evaluation Active ->
# Evaluation Complete -> Review -> Published -> Closed.
EVENT_STATUSES = ["Draft", "Setup", "Ready", "Evaluation Active",
                  "Evaluation Complete", "Review", "Published", "Closed"]

# Statuses events created before the lifecycle revision may still carry. They
# stay valid on create/update and keep displaying as stored — existing data is
# never migrated. For lifecycle gating, any legacy/unknown status behaves as
# "Setup".
LEGACY_EVENT_STATUSES = ["Registration Open", "Registration Closed",
                         "Check-In Open", "Reports Under Review"]

ACCEPTED_EVENT_STATUSES = EVENT_STATUSES + LEGACY_EVENT_STATUSES

DONE_STATUSES = ["submitted", "approved"]

# Module states (Revision 5 §5). Additive on stations and testing-config entries.
# "required"    -> counts toward completeness; missing blocks submission-readiness.
# "optional"    -> tracked when done, but missing NEVER blocks completeness.
# "not_offered" -> the event does not run this module: it must NEVER count as
#                  missing or expected anywhere (progress, reports, completion).
MODULE_STATES = ("required", "optional", "not_offered")


def module_state_of(doc: dict) -> str:
    """Effective module state of a station/testing entry. Docs written before
    Revision 5 carry no module_state — they were always required."""
    ms = (doc or {}).get("module_state")
    return ms if ms in MODULE_STATES else "required"


def station_sort_key(s: dict):
    """List ordering (Revision 5 §4): display_order first, name breaks ties.
    Legacy stations without display_order sort as 0 (front, alphabetical)."""
    order = s.get("display_order")
    return (order if isinstance(order, int) else 0, s.get("name") or "")

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
    # Revision 5 additive fields (§4/§5)
    module_state: str = "required"   # required | optional | not_offered
    display_order: int = 0


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
    # Revision 5 §15: positions this athlete is being evaluated at TODAY.
    # Storage only this wave — evaluation resolution keeps its own override.
    positions_today: list[str] | None = None


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
    if body.status not in ACCEPTED_EVENT_STATUSES:
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


@router.delete("/events/{event_id}")
async def delete_event(event_id: str, force: bool = False,
                       user=Depends(require_roles(*ADMIN_ROLES))):
    """Delete an event and its operational children (roster links, groups,
    stations, assignments, invites, draft evaluations).

    Submitted/approved evaluations are permanent athlete history: their presence
    blocks deletion (409) unless the OWNER passes force=true, which deletes them
    with the event. Athlete profiles are never touched — only event linkage."""
    ev = await get_org_event(event_id, user)
    org = user["organization_id"]
    kept = await db.evaluations.count_documents({
        "event_id": event_id, "organization_id": org,
        "status": {"$in": ["submitted", "approved"]}})
    if kept and not (force and user["role"] == "owner"):
        raise HTTPException(
            status_code=409,
            detail=(f"This event has {kept} submitted/approved evaluation(s) in athlete "
                    "history. Only the organization owner can force-delete it."))
    removed = {}
    for coll, q in [
        ("evaluations", {"event_id": event_id, "organization_id": org} if force
         else {"event_id": event_id, "organization_id": org, "status": "draft"}),
        ("event_athletes", {"event_id": event_id, "organization_id": org}),
        ("event_groups", {"event_id": event_id, "organization_id": org}),
        ("stations", {"event_id": event_id, "organization_id": org}),
        ("evaluator_assignments", {"event_id": event_id, "organization_id": org}),
        ("event_invites", {"event_id": event_id, "organization_id": org}),
    ]:
        res = await db[coll].delete_many(q)
        removed[coll] = res.deleted_count
    await db.events.delete_one({"id": event_id, "organization_id": org})
    await log_audit(org, user, "event_deleted", "event", event_id,
                    {"name": ev.get("name"), "force": force, **removed})
    return {"message": "Event deleted.", "removed": removed}


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
    if body.status not in ACCEPTED_EVENT_STATUSES:
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
    """Move an event through its lifecycle. Only canonical statuses can be SET
    (legacy statuses keep displaying but are never written anew).

    The one gated transition is TO "Evaluation Active": the event must have a
    roster, at least one offered station and at least one active evaluator
    assignment — otherwise 409 with every unmet requirement spelled out. Every
    other transition is free for admins."""
    ev = await get_org_event(event_id, user)
    if body.status not in EVENT_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid event status. Use one of: {', '.join(EVENT_STATUSES)}.")
    org = user["organization_id"]
    if body.status == "Evaluation Active" and ev.get("status") != "Evaluation Active":
        base = {"event_id": event_id, "organization_id": org}
        roster_count = await db.event_athletes.count_documents(base)
        stations = await db.stations.find(base, {"_id": 0, "module_state": 1}).to_list(200)
        has_offered_station = any(module_state_of(s) != "not_offered" for s in stations)
        has_assignment = await db.evaluator_assignments.find_one(
            {**base, **active_assignment_filter()}) is not None
        unmet = []
        if roster_count == 0:
            unmet.append("at least one athlete on the roster")
        if not has_offered_station:
            unmet.append("at least one station that is offered at this event")
        if not has_assignment:
            unmet.append("at least one active evaluator assignment")
        if unmet:
            raise HTTPException(
                status_code=409,
                detail="Cannot start the evaluation yet — this event still needs "
                       + "; ".join(unmet) + ".")
    await db.events.update_one(
        {"id": event_id, "organization_id": org},
        {"$set": {"status": body.status, "updated_at": now_iso()}})
    await log_audit(org, user, "event_status_changed", "event", event_id,
                    {"from": ev.get("status"), "status": body.status})
    return {"message": f"Event status set to {body.status}.", "status": body.status}


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


@router.get("/events/{event_id}/export/csv")
async def export_event_roster(event_id: str,
                              user=Depends(require_roles(*ADMIN_ROLES, "head_scout"))):
    """This event's roster with the same depth as the athlete master export,
    plus the event-day columns (group, check-in, bib). The existing results
    export is leaderboard-only, so it is empty until evaluations are scored."""
    from routes_players import _export_rows
    org = user["organization_id"]
    event = await db.events.find_one({"id": event_id, "organization_id": org}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found.")
    links = await db.event_athletes.find(
        {"event_id": event_id, "organization_id": org}, {"_id": 0}).to_list(5000)
    ids = [l["athlete_id"] for l in links]
    if not ids:
        raise HTTPException(status_code=404, detail="No athletes on this event roster yet.")
    link_by_athlete = {l["athlete_id"]: l for l in links}

    groups = await db.groups.find({"event_id": event_id, "organization_id": org},
                                  {"_id": 0, "id": 1, "name": 1}).to_list(200)
    gname = {g["id"]: g.get("name") for g in groups}

    headers, rows = await _export_rows(org, athlete_ids=ids)
    id_i = headers.index("Athlete ID")
    headers = ["Group", "Checked In", "Bib"] + headers
    out = []
    for r in rows:
        link = link_by_athlete.get(r[id_i], {})
        out.append([
            gname.get(link.get("group_id")) or "",
            "Yes" if link.get("status") == "checked_in" else "",
            link.get("bib_number") or "",
        ] + r)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(headers)
    for r in out:
        writer.writerow(r)
    await log_audit(org, user, "event_roster_exported", "event", event_id, {"rows": len(out)})
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in (event.get("name") or "event"))[:40]
    return Response(content=output.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f"attachment; filename={safe}_roster.csv"})


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
            "positions_today": e.get("positions_today") or [],
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
        # A checked-in kid should never be ungrouped: when no group is set (and
        # none supplied), place them into the event's matching "Ages X-Y" group
        # automatically. Admins can still drag them elsewhere afterwards.
        if not entry.get("group_id") and not updates.get("group_id"):
            athlete = await db.athletes.find_one(
                {"id": athlete_id, "organization_id": user["organization_id"]},
                {"_id": 0, "age": 1})
            from routes_registration import _age_group_for_event
            auto_gid = await _age_group_for_event(
                user["organization_id"], event_id, (athlete or {}).get("age"))
            if auto_gid:
                updates["group_id"] = auto_gid
    if "group_id" in updates and updates["group_id"]:
        g = await db.event_groups.find_one({
            "id": updates["group_id"], "event_id": event_id, "organization_id": user["organization_id"]})
        if not g:
            raise HTTPException(status_code=400, detail="That group is not on this event.")
    if "group_id" in updates and updates["group_id"] == "":
        updates["group_id"] = None
    if "positions_today" in updates:
        # Explicit null/[] clears the day's positions; codes validate against the taxonomy.
        try:
            updates["positions_today"] = validate_positions(updates["positions_today"])
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
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


# ---------------- Athletic testing library + per-event config (Revision 5 §2) ----------------
#
# The library is the fixed five-test menu the client runs at ID events. Entries
# are sourced from scoring's canonical metric catalog (metric_meta) so labels,
# units and direction can never drift from the scoring/benchmark engine.
# home_to_second is its own catalog metric — the client is explicit it is NOT
# a 60-yard dash.

ATHLETIC_TEST_KEYS = ["ten_yd", "home_to_first", "home_to_second", "sixty_yard_dash", "broad_jump"]


def athletic_test_library() -> list[dict]:
    out = []
    for key in ATHLETIC_TEST_KEYS:
        meta = metric_meta(key)
        if not meta:  # catalog is code-owned; this only trips on a bad edit
            continue
        out.append({"key": meta["key"], "label": meta["label"],
                    "unit": meta["unit"], "lower_better": meta["lower_better"]})
    return out


@router.get("/athletic-tests")
async def list_athletic_tests(user=Depends(require_roles(*STAFF_ROLES))):
    """The five-test athletic testing menu every event configures from."""
    return athletic_test_library()


class TestingItem(BaseModel):
    key: str
    state: str = "required"  # required | optional | not_offered
    order: int = 0


class TestingBody(BaseModel):
    tests: list[TestingItem]


@router.put("/events/{event_id}/testing")
async def set_event_testing(event_id: str, body: TestingBody,
                            user=Depends(require_roles(*ADMIN_ROLES, "coach"))):
    """Store which athletic tests this event runs (additive `testing_config` on
    the event doc). Keys validate against the library; states against
    MODULE_STATES. GET /events/{event_id} returns testing_config as stored."""
    await get_org_event(event_id, user)
    allowed = {t["key"] for t in athletic_test_library()}
    config = []
    seen = set()
    for item in body.tests:
        key = (item.key or "").strip()
        if key not in allowed:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown athletic test key: {key or '(empty)'}. "
                       f"Allowed: {', '.join(ATHLETIC_TEST_KEYS)}")
        if item.state not in MODULE_STATES:
            raise HTTPException(
                status_code=400,
                detail=f"state must be one of: {', '.join(MODULE_STATES)}")
        if key in seen:
            raise HTTPException(status_code=400, detail=f"Duplicate athletic test key: {key}")
        seen.add(key)
        config.append({"key": key, "state": item.state, "order": item.order})
    config.sort(key=lambda t: t["order"])
    await db.events.update_one(
        {"id": event_id, "organization_id": user["organization_id"]},
        {"$set": {"testing_config": config, "updated_at": now_iso()}})
    await log_audit(user["organization_id"], user, "event_testing_updated", "event", event_id,
                    {"tests": {t["key"]: t["state"] for t in config}})
    return {"message": "Testing configuration saved.", "testing_config": config}


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
        s["module_state"] = module_state_of(s)
        s["display_order"] = s.get("display_order") if isinstance(s.get("display_order"), int) else 0
        s["template_name"] = tmap.get(s.get("template_id"))
        assignments = await db.evaluator_assignments.find({
            "station_id": s["id"], "event_id": event_id,
            "organization_id": user["organization_id"], **active_assignment_filter(),
        }, {"_id": 0}).to_list(50)
        s["evaluator_count"] = len(assignments)
        # completion — a not_offered station expects nobody (never counts as missing)
        done = await db.evaluations.count_documents({
            "event_id": event_id, "organization_id": org, "station_id": s["id"],
            "status": {"$in": DONE_STATUSES}})
        if s["module_state"] == "not_offered":
            expected = 0
        else:
            group_ids = s.get("group_ids") or []
            q = {"event_id": event_id, "organization_id": org, "status": "checked_in"}
            if group_ids:
                q["group_id"] = {"$in": group_ids}
            expected = await db.event_athletes.count_documents(q)
        s["expected"] = expected
        s["completed"] = done
        s["completion_pct"] = round(done / expected * 100) if expected else 0
    stations.sort(key=station_sort_key)
    return stations


@router.post("/events/{event_id}/stations")
async def create_station(event_id: str, body: StationBody, user=Depends(require_roles(*ADMIN_ROLES))):
    await get_org_event(event_id, user)
    if body.module_state not in MODULE_STATES:
        raise HTTPException(status_code=400,
                            detail=f"module_state must be one of: {', '.join(MODULE_STATES)}")
    doc = body.model_dump()
    doc.update({"id": new_id(), "organization_id": user["organization_id"], "event_id": event_id,
                "created_at": now_iso(), "updated_at": now_iso()})
    await db.stations.insert_one(doc)
    await log_audit(user["organization_id"], user, "station_created", "station", doc["id"], {"name": body.name})
    return clean(doc)


@router.patch("/events/{event_id}/stations/{station_id}")
async def update_station(event_id: str, station_id: str, body: StationBody, user=Depends(require_roles(*ADMIN_ROLES))):
    await get_org_event(event_id, user)
    # exclude_unset: true PATCH semantics — omitted fields keep their stored
    # values, so an older client that never sends module_state/display_order
    # can never silently reset a configured station back to defaults.
    updates = body.model_dump(exclude_unset=True)
    if "module_state" in updates and updates["module_state"] not in MODULE_STATES:
        raise HTTPException(status_code=400,
                            detail=f"module_state must be one of: {', '.join(MODULE_STATES)}")
    updates["updated_at"] = now_iso()
    res = await db.stations.update_one(
        {"id": station_id, "event_id": event_id, "organization_id": user["organization_id"]},
        {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Station not found.")
    await log_audit(user["organization_id"], user, "station_updated", "station", station_id,
                    {k: v for k, v in updates.items() if k != "updated_at"})
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

    # Module-state awareness (Revision 5 §5): a not_offered station is skipped
    # from expected/complete/missing everywhere — it can never count as missing.
    stations.sort(key=station_sort_key)
    station_progress = []
    total_expected = 0
    total_done = 0
    total_drafts = 0
    for s in stations:
        state = module_state_of(s)
        if state == "not_offered":
            station_progress.append({"station_id": s["id"], "station_name": s["name"],
                                     "module_state": state, "expected": 0, "completed": 0,
                                     "drafts": 0, "completion_pct": 0})
            continue
        expected = sum(1 for e in checked_in_entries if _station_applies(s, e.get("group_id")))
        done = done_by_station.get(s["id"], 0)
        drafts = draft_by_station.get(s["id"], 0)
        total_expected += expected
        total_done += done
        total_drafts += drafts
        station_progress.append({"station_id": s["id"], "station_name": s["name"],
                                 "module_state": state, "expected": expected,
                                 "completed": done, "drafts": drafts,
                                 "completion_pct": round(done / expected * 100) if expected else 0})

    # Per-player rollup over the stations that actually apply to each player's
    # group. Completeness = every REQUIRED applicable station done; optional
    # stations count as activity (in-progress) but never block completeness.
    players_complete = 0
    players_in_progress = 0
    players_not_started = 0
    for e in checked_in_entries:
        offered = [s for s in stations
                   if module_state_of(s) != "not_offered" and _station_applies(s, e.get("group_id"))]
        required = {s["id"] for s in offered if module_state_of(s) == "required"}
        tracked = {s["id"] for s in offered}
        done = tracked & done_by_athlete.get(e["athlete_id"], set())
        drafted = tracked & draft_by_athlete.get(e["athlete_id"], set())
        if tracked and required <= done:
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
    state_by_station = {s["id"]: module_state_of(s) for s in stations}
    evaluator_progress = []
    for a in assignments:
        group_ids = a.get("group_ids") or []
        if state_by_station.get(a["station_id"]) == "not_offered":
            expected = 0  # station not run at this event — nothing is owed
        else:
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


@router.get("/events/{event_id}/progress/athletes")
async def event_athletes_progress(event_id: str, user=Depends(require_roles(*STAFF_ROLES))):
    """Athlete-level live progress: one row per rostered athlete with per-station
    state, percent complete over REQUIRED stations, and exactly which station +
    required metrics are still missing (drill-down data).

    Bulk queries only — roster, groups, stations, templates and every event
    evaluation are each fetched once; nothing is queried per athlete."""
    await get_org_event(event_id, user)
    org = user["organization_id"]
    base = {"event_id": event_id, "organization_id": org}

    entries = await db.event_athletes.find(base, {"_id": 0}).to_list(2000)
    athletes = await db.athletes.find(
        {"id": {"$in": [e["athlete_id"] for e in entries]}, "organization_id": org},
        {"_id": 0, "id": 1, "first_name": 1, "last_name": 1}).to_list(2000)
    amap = {a["id"]: a for a in athletes}
    groups = await db.event_groups.find(base, {"_id": 0, "id": 1, "name": 1}).to_list(200)
    gmap = {g["id"]: g["name"] for g in groups}
    # not_offered stations are excluded everywhere — they can never be missing.
    stations = [s for s in await db.stations.find(base, {"_id": 0}).to_list(200)
                if module_state_of(s) != "not_offered"]
    stations.sort(key=station_sort_key)
    templates = await db.evaluation_templates.find({"organization_id": org}, {"_id": 0}).to_list(500)
    tmap = {t["id"]: t for t in templates}
    evals = await db.evaluations.find(base, {
        "_id": 0, "id": 1, "athlete_id": 1, "station_id": 1, "status": 1,
        "template_id": 1, "scores": 1, "computed": 1}).to_list(5000)

    submitted_total = sum(1 for e in evals if e.get("status") == "submitted")
    approved_total = sum(1 for e in evals if e.get("status") == "approved")
    evals_by_key = defaultdict(list)
    for e in evals:
        evals_by_key[(e.get("athlete_id"), e.get("station_id"))].append(e)

    def _missing_metric_names(ev: dict) -> list[str]:
        """Required-metric NAMES still missing on an evaluation. Prefers the
        stored computed.missing_required ids (exactly what submit enforces),
        mapped to names via the template; falls back to recomputing from
        scores for drafts saved before `computed` existed."""
        template = tmap.get(ev.get("template_id"))
        computed = ev.get("computed") or {}
        ids = computed.get("missing_required")
        if isinstance(ids, list):
            names = {m.get("id"): m.get("name") for m in (template or {}).get("metrics") or []}
            return [names.get(mid) or mid for mid in ids]
        return [m["name"] for m in _missing_required_metrics(template, ev.get("scores"))
                if m.get("name")]

    rows = []
    totals = {"checked_in": 0, "not_started": 0, "in_progress": 0, "complete": 0,
              "missing": 0, "flagged": 0, "submitted": submitted_total,
              "awaiting_review": submitted_total, "approved": approved_total}
    for entry in entries:
        a = amap.get(entry["athlete_id"])
        if not a:
            continue
        station_rows = []
        missing = []
        required_total = required_complete = 0
        any_done = any_draft = any_eval = False
        for s in stations:
            if not _station_applies(s, entry.get("group_id")):
                continue
            mod_state = module_state_of(s)  # required | optional
            station_evals = evals_by_key.get((entry["athlete_id"], s["id"]), [])
            done = next((e for e in station_evals if e.get("status") in DONE_STATUSES), None)
            draft = next((e for e in station_evals if e.get("status") == "draft"), None)
            done_missing = _missing_metric_names(done) if done else []
            if done and not done_missing:
                state = "complete"
            elif done or draft:
                state = "in_progress"
            elif mod_state == "optional":
                state = "optional"
            else:
                state = "missing"
            any_eval = any_eval or bool(station_evals)
            any_done = any_done or bool(done)
            any_draft = any_draft or bool(draft)
            if mod_state == "required":
                required_total += 1
                if state == "complete":
                    required_complete += 1
                else:
                    # Drill-down: name the station; for started work, the exact
                    # required metric names still unanswered.
                    started = done or draft
                    missing.append({"station": s["name"],
                                    "metrics": _missing_metric_names(started) if started else []})
            station_rows.append({"station_id": s["id"], "name": s["name"], "state": state})

        if required_total:
            pct_complete = round(required_complete / required_total * 100)
            status = ("complete" if required_complete == required_total
                      else "in_progress" if (any_done or any_draft) else "not_started")
        else:
            # No required stations: any evaluation at all counts as done work.
            pct_complete = 100 if any_eval else 0
            status = ("complete" if any_done
                      else "in_progress" if any_draft else "not_started")

        flagged = bool(entry.get("flagged_incomplete"))
        checked_in = entry.get("status") == "checked_in"
        totals[status] += 1
        if checked_in:
            totals["checked_in"] += 1
        if flagged:
            totals["flagged"] += 1
        if missing:
            totals["missing"] += 1
        rows.append({
            "athlete_id": a["id"],
            "name": f"{a.get('first_name') or ''} {a.get('last_name') or ''}".strip(),
            "bib_number": entry.get("bib_number"),
            "group_name": gmap.get(entry.get("group_id")),
            "pct_complete": pct_complete,
            "stations": station_rows,
            "missing": missing,
            "status": status,
            "flagged": flagged,
            "checked_in": checked_in,
        })
    rows.sort(key=lambda r: ((r.get("name") or "").split(" ")[-1].lower(), (r.get("name") or "").lower()))
    return {"athletes": rows, "totals": totals}


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
    missing_required_stations = []  # required-module gaps only — the submission blockers
    stations_not_offered = 0
    stations.sort(key=station_sort_key)
    for s in stations:
        state = module_state_of(s)
        if not _station_applies(s, entry.get("group_id")):
            rows.append({"station_id": s["id"], "station_name": s["name"], "applies": False,
                         "module_state": state, "status": "n/a", "evaluation_id": None,
                         "evaluator_id": None, "evaluator_name": None, "updated_at": None,
                         "submitted_at": None, "template_id": None, "missing_required": []})
            continue
        if state == "not_offered":
            # Not run at this event: reported for visibility, excluded from every
            # count and never listed as missing (Revision 5 §5 critical rule).
            stations_not_offered += 1
            rows.append({"station_id": s["id"], "station_name": s["name"], "applies": True,
                         "module_state": state, "status": "not_offered", "evaluation_id": None,
                         "evaluator_id": None, "evaluator_name": None, "updated_at": None,
                         "submitted_at": None, "template_id": None, "missing_required": []})
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
            if state == "required":
                missing_required_stations.append(s["name"])
        rows.append({
            "station_id": s["id"], "station_name": s["name"], "applies": True,
            "module_state": state, "status": status,
            "evaluation_id": picked["id"] if picked else None,
            "evaluator_id": picked.get("evaluator_id") if picked else None,
            "evaluator_name": picked.get("evaluator_name") if picked else None,
            "updated_at": picked.get("updated_at") if picked else None,
            "submitted_at": picked.get("submitted_at") if picked else None,
            "template_id": (picked or {}).get("template_id") if picked else None,
            "missing_required": missing_required,
        })

    applicable = counts["complete"] + counts["draft"] + counts["missing"]
    # A missing OPTIONAL module never blocks submission-readiness; a missing
    # required one always does. not_offered stations are outside both counts.
    required_complete = len(missing_required_stations) == 0
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
        "required_complete": required_complete,
        "ready_for_submission": applicable > 0 and required_complete,
        "stations_applicable": applicable,
        "stations_complete": counts["complete"],
        "stations_draft": counts["draft"],
        "stations_missing": counts["missing"],
        "stations_not_offered": stations_not_offered,
        "missing_stations": missing_stations,
        "missing_required_stations": missing_required_stations,
        "stations": rows,
    }


# ---------------- Event staff invite codes (redeem) ----------------

import secrets as _secrets


class EventInviteBody(BaseModel):
    email: str | None = None
    role: str = "evaluator"  # evaluator | coach
    station_id: str | None = None          # legacy single-station callers
    station_ids: list[str] = []            # preferred: one code, many stations
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
        "station_ids": list(dict.fromkeys(([body.station_id] if body.station_id else []) + (body.station_ids or []))),
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
    # Both invited roles work stations, so each granted station gets an
    # expiring assignment (legacy invites carry a single station_id).
    grant_stations = inv.get("station_ids") or ([inv["station_id"]] if inv.get("station_id") else [])
    for sid in grant_stations:
        existing_a = await db.evaluator_assignments.find_one({
            "event_id": inv["event_id"], "station_id": sid,
            "evaluator_id": uid, "organization_id": org_id})
        if not existing_a:
            await db.evaluator_assignments.insert_one({
                "id": new_id(), "organization_id": org_id, "event_id": inv["event_id"],
                "station_id": sid, "evaluator_id": uid, "group_ids": [],
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


# ---------------- Event-scoped CSV roster import (Revision 4, Task 1) ----------------
#
# Reuses the header-mapping vocabulary from routes_players (CSV_COLUMNS,
# _normalize_header, _split_full_name, parse_dob) so the two importers can never
# drift apart on what "grad year" or "B/T" means. Imports are done lazily inside
# the functions, matching the existing add_walk_up pattern in this file.

# Columns the org-level importer does not know but an event roster needs.
ROSTER_IMPORT_EXTRA_COLUMNS = {
    "bib": "bib_number", "bib number": "bib_number", "bib #": "bib_number",
    "bib num": "bib_number", "age": "age",
    # Explicit group placement from the sheet. A bare year ("2032") is
    # normalized to "Class of 2032" so it merges with auto-grouping's names.
    "event group": "event_group_hint", "group": "event_group_hint",
    "group name": "event_group_hint", "wave": "event_group_hint",
}


def _grad_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _athlete_display_name(a: dict) -> str:
    return f"{a.get('first_name') or ''} {a.get('last_name') or ''}".strip()


def _build_roster_column_mapping(fieldnames):
    from routes_players import CSV_COLUMNS, CSV_IGNORED_COLUMNS, _normalize_header
    mapping = {}
    unmapped = []
    for col in fieldnames:
        key = _normalize_header(col)
        if key in ROSTER_IMPORT_EXTRA_COLUMNS:
            mapping[col] = ROSTER_IMPORT_EXTRA_COLUMNS[key]
        elif key in CSV_COLUMNS:
            mapping[col] = CSV_COLUMNS[key]
        elif key in ("b/t", "bats/throws", "bat/throw"):
            mapping[col] = "bats_throws"
        elif key in CSV_IGNORED_COLUMNS:
            pass  # recognized but intentionally not stored (index, notes, consent…)
        else:
            unmapped.append(col)
    return mapping, unmapped


def _parse_roster_row(row: dict, mapping: dict) -> tuple[dict, list[str]]:
    """One CSV row -> (parsed record, errors). Mirrors routes_players.import_preview
    field-by-field so both importers accept the same files."""
    from positions import normalize_age_band
    from routes_players import _split_full_name, parse_dob
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
            # "R/R", "L-R", "S/R"
            parts = [p.strip().upper()[:1] for p in val.replace("-", "/").split("/") if p.strip()]
            if parts:
                record["bats"] = parts[0]
            if len(parts) > 1:
                record["throws"] = parts[1]
        elif field == "age_group_hint":
            record["age_group_hint"] = normalize_age_band(val) if val else None
        elif field == "date_of_birth":
            parsed, err = parse_dob(val)
            if err:
                errors.append(err)
            record[field] = parsed
        elif field == "age":
            if val:
                digits = "".join(ch for ch in val if ch.isdigit())
                record["age"] = int(digits) if digits else None
                if record["age"] is None:
                    errors.append(f"Age must be a number: {val}")
            else:
                record["age"] = None
        elif field == "graduation_year":
            if val:
                digits = "".join(ch for ch in val if ch.isdigit())
                record[field] = int(digits[:4]) if digits else None
                if record[field] is None:
                    errors.append(f"Graduation year must be a number: {val}")
            else:
                record[field] = None
        elif field == "secondary_positions":
            record[field] = [p.strip() for p in val.replace(";", ",").split(",") if p.strip()] if val else []
        else:
            # don't overwrite a stronger explicit field with empty
            if val or field not in record:
                record[field] = val or None
    # "Organization" fills the team only when the sheet had no team column.
    org_hint = record.pop("organization_hint", None)
    if org_hint and not record.get("current_team"):
        record["current_team"] = org_hint
    if not record.get("first_name"):
        errors.append("First name is required")
    if not record.get("last_name"):
        errors.append("Last name is required")
    return record, errors


def _classify_roster_row(record: dict, errors: list[str], candidates: list[dict],
                         on_roster_ids: set) -> tuple[str, str | None, str | None, list[str]]:
    """Matching rules against the org's athletes (permanent-ID reuse).

    Returns (status, athlete_id, athlete_name, reasons).
      - exact first+last (ci) + same DOB                      -> matched
      - exact first+last + same grad year, no DOB either side -> matched
      - exact first+last, evidence conflicting/absent         -> possible_duplicate
      - no name match                                         -> new
      - missing first or last name / parse error              -> error
      - valid new row, NO grad year but DOB/age present       -> needs_grad_confirmation
    """
    if errors:
        return "error", None, None, errors
    dob = record.get("date_of_birth")
    grad = _grad_int(record.get("graduation_year"))

    def _matched(cand, why):
        reasons = [why]
        if cand["id"] in on_roster_ids:
            reasons.append("already on roster")
        return "matched", cand["id"], _athlete_display_name(cand), reasons

    if candidates:
        if dob:
            hit = next((c for c in candidates if c.get("date_of_birth") == dob), None)
            if hit:
                return _matched(hit, "matched by name + date of birth")
        if not dob and grad is not None:
            hit = next((c for c in candidates
                        if not c.get("date_of_birth")
                        and _grad_int(c.get("graduation_year")) == grad), None)
            if hit:
                return _matched(hit, "matched by name + graduation year (no DOB on either side)")
        cand = candidates[0]
        reasons = ["name matches an existing athlete but DOB/graduation year evidence "
                   "is conflicting or absent — confirm before importing"]
        if len(candidates) > 1:
            reasons.append(f"{len(candidates)} existing athletes share this name")
        if cand["id"] in on_roster_ids:
            reasons.append("candidate already on this event roster")
        return "possible_duplicate", cand["id"], _athlete_display_name(cand), reasons

    if grad is None and (dob or record.get("age") is not None):
        return ("needs_grad_confirmation", None, None,
                ["no graduation year on the row — confirm one before auto-grouping "
                 "(row is still importable but will stay ungrouped)"])
    return "new", None, None, []


@router.post("/events/{event_id}/roster/import/preview")
async def roster_import_preview(event_id: str, file: UploadFile = File(...),
                                user=Depends(require_roles(*ADMIN_ROLES, "coach"))):
    """Parse an event roster CSV and classify every row against the org's athletes.
    Read-only: nothing is written until /confirm."""
    await get_org_event(event_id, user)
    org = user["organization_id"]
    from roster_files import rows_from_upload
    fieldnames, file_rows = await rows_from_upload(file)
    mapping, _unmapped = _build_roster_column_mapping(fieldnames)

    existing = await db.athletes.find(
        {"organization_id": org, "status": {"$ne": "merged"}},
        {"_id": 0, "id": 1, "first_name": 1, "last_name": 1,
         "date_of_birth": 1, "graduation_year": 1}).to_list(5000)
    by_name: dict = {}
    for a in existing:
        key = ((a.get("first_name") or "").strip().lower(),
               (a.get("last_name") or "").strip().lower())
        by_name.setdefault(key, []).append(a)
    on_roster_ids = {e["athlete_id"] for e in await db.event_athletes.find(
        {"event_id": event_id, "organization_id": org},
        {"_id": 0, "athlete_id": 1}).to_list(2000)}

    rows = []
    for idx, row in enumerate(file_rows):
        if idx >= 500:
            break
        record, errors = _parse_roster_row(row, mapping)
        key = ((record.get("first_name") or "").strip().lower(),
               (record.get("last_name") or "").strip().lower())
        status, aid, aname, reasons = _classify_roster_row(
            record, errors, by_name.get(key, []), on_roster_ids)
        rows.append({"row": idx + 2, "data": record, "status": status,
                     "athlete_id": aid, "athlete_name": aname, "reasons": reasons})

    summary = {
        "total": len(rows),
        "matched": sum(1 for r in rows if r["status"] == "matched"),
        "new": sum(1 for r in rows if r["status"] == "new"),
        "possible_duplicates": sum(1 for r in rows if r["status"] == "possible_duplicate"),
        "needs_confirmation": sum(1 for r in rows if r["status"] == "needs_grad_confirmation"),
        "errors": sum(1 for r in rows if r["status"] == "error"),
    }
    return {"rows": rows, "summary": summary}


class RosterImportRowAction(BaseModel):
    row: int
    action: str  # use_match | create | skip
    data: dict = {}
    athlete_id: str | None = None
    graduation_year: int | None = None  # lets the UI resolve needs_grad_confirmation rows


class RosterImportConfirmBody(BaseModel):
    rows: list[RosterImportRowAction]
    auto_group: bool = True


async def _add_import_row_to_roster(org: str, event_id: str, athlete_id: str,
                                    bib_number: str | None,
                                    group_id: str | None = None) -> bool:
    """Add an athlete to the event roster — same doc shape as add_to_roster, plus
    the CSV bib and optional explicit group. Idempotent: when the athlete is
    already rostered it returns False, but still fills a missing bib/group so a
    re-import with richer columns upgrades the entry instead of being a no-op."""
    existing = await db.event_athletes.find_one({
        "event_id": event_id, "athlete_id": athlete_id, "organization_id": org})
    if existing:
        patch = {}
        if bib_number and not existing.get("bib_number"):
            patch["bib_number"] = bib_number
        if group_id and not existing.get("group_id"):
            patch["group_id"] = group_id
        if patch:
            patch["updated_at"] = now_iso()
            await db.event_athletes.update_one({"id": existing["id"]}, {"$set": patch})
        return False
    await db.event_athletes.insert_one({
        "id": new_id(), "organization_id": org,
        "event_id": event_id, "athlete_id": athlete_id, "status": "registered",
        "bib_number": bib_number or None, "group_id": group_id, "late_arrival": False,
        "flagged_incomplete": False, "walk_up": False,
        "created_at": now_iso(), "updated_at": now_iso(),
    })
    return True


def _normalize_group_name(raw: str | None) -> str | None:
    """CSV group labels arrive as "2032", "Class of 2032" or free text.
    Bare years get auto-grouping's canonical name so the two never split."""
    name = (raw or "").strip()
    if not name:
        return None
    if re.fullmatch(r"(19|20)\d{2}", name):
        return f"Class of {name}"
    return name


async def _resolve_import_group(org: str, event_id: str, name: str,
                                cache: dict) -> str:
    """Find-or-create an event group by name (case-insensitive), memoized."""
    key = name.lower()
    if key in cache:
        return cache[key]
    g = await db.event_groups.find_one({
        "event_id": event_id, "organization_id": org,
        "name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}})
    if not g:
        g = {"id": new_id(), "organization_id": org, "event_id": event_id,
             "name": name, "created_at": now_iso()}
        await db.event_groups.insert_one({**g})
    cache[key] = g["id"]
    return g["id"]


# Profile fields a matched CSV row may FILL IN — never overwrite. Lets an org
# whose first import came from a names-only sheet repair its roster by
# re-importing a richer CSV, instead of hand-editing every profile.
_BACKFILL_FIELDS = [
    "preferred_name", "date_of_birth", "graduation_year", "primary_position",
    "secondary_positions", "bats", "throws", "height", "weight",
    "jersey_number", "current_team", "school", "city", "state",
    "guardian_name", "guardian_email", "guardian_phone", "email",
]


async def _backfill_matched_athlete(org: str, athlete: dict, data: dict) -> bool:
    """Fill EMPTY profile fields on a matched athlete from the CSV row.
    Existing values always win — a re-import can only add, never change.
    Returns True when anything was written; mutates `athlete` in place."""
    from routes_players import compute_age, compute_age_group
    from positions import normalize_age_band
    patch = {}
    for f in _BACKFILL_FIELDS:
        new = data.get(f)
        if new in (None, "", []):
            continue
        cur = athlete.get(f)
        if cur in (None, "", []):
            patch[f] = new
    # derived fields follow a newly-learned DOB / explicit band
    if "date_of_birth" in patch:
        patch["age"] = compute_age(patch["date_of_birth"])
        if not athlete.get("age_group"):
            patch["age_group"] = compute_age_group(patch["date_of_birth"])
    if not athlete.get("age_group") and not patch.get("age_group"):
        band = normalize_age_band(data.get("age_group_hint") or "")
        if band:
            patch["age_group"] = band
    if not patch:
        return False
    patch["updated_at"] = now_iso()
    await db.athletes.update_one({"id": athlete["id"], "organization_id": org},
                                 {"$set": patch})
    athlete.update(patch)
    return True


@router.post("/events/{event_id}/roster/import/confirm")
async def roster_import_confirm(event_id: str, body: RosterImportConfirmBody,
                                user=Depends(require_roles(*ADMIN_ROLES, "coach"))):
    """Apply the reviewed preview rows. use_match adds the EXISTING athlete
    (permanent-ID reuse — never a duplicate profile); create makes a new athlete
    via routes_players.athlete_doc; skip does nothing. create re-runs the match
    first, so confirming the same rows twice can never mint a duplicate."""
    from positions import age_band_for_age
    from routes_players import AthleteBody, athlete_doc
    await get_org_event(event_id, user)
    org = user["organization_id"]
    added = created = matched = skipped = flagged_no_grad = backfilled = 0
    group_cache: dict = {}

    for r in body.rows:
        data = dict(r.data or {})
        if r.graduation_year is not None:
            data["graduation_year"] = r.graduation_year
        # Bib: a dedicated bib column wins; a jersey/# column doubles as the bib
        # on an event roster sheet. Jersey still lands on the athlete profile.
        bib = str(data.get("bib_number") or data.get("jersey_number") or "").strip() or None
        # Explicit group from the sheet's event_group/group column, if any.
        # Resolved lazily (find-or-create) only when the row actually rosters,
        # so skipped/invalid rows can never mint empty groups.
        group_name = _normalize_group_name(data.pop("event_group_hint", None))

        async def _row_group_id():
            if not group_name:
                return None
            return await _resolve_import_group(org, event_id, group_name, group_cache)

        if r.action == "skip":
            skipped += 1
            continue

        if r.action == "use_match":
            if not r.athlete_id:
                skipped += 1
                continue
            athlete = await db.athletes.find_one({"id": r.athlete_id, "organization_id": org})
            if not athlete:
                skipped += 1
                continue
            if r.graduation_year is not None and _grad_int(athlete.get("graduation_year")) is None:
                await db.athletes.update_one(
                    {"id": athlete["id"], "organization_id": org},
                    {"$set": {"graduation_year": r.graduation_year, "updated_at": now_iso()}})
                athlete["graduation_year"] = r.graduation_year
            if await _backfill_matched_athlete(org, athlete, data):
                backfilled += 1
            matched += 1
            if await _add_import_row_to_roster(org, event_id, athlete["id"], bib,
                                               group_id=await _row_group_id()):
                added += 1
            if _grad_int(athlete.get("graduation_year")) is None:
                flagged_no_grad += 1
            continue

        if r.action == "create":
            first = (data.get("first_name") or "").strip()
            last = (data.get("last_name") or "").strip()
            if not first or not last:
                skipped += 1
                continue
            # Permanent-ID guard: NEVER create when a match exists, even if the
            # caller said "create" (e.g. the same confirm replayed after a retry).
            candidates = await db.athletes.find(
                {"organization_id": org, "status": {"$ne": "merged"},
                 "first_name": {"$regex": f"^{re.escape(first)}$", "$options": "i"},
                 "last_name": {"$regex": f"^{re.escape(last)}$", "$options": "i"}},
                {"_id": 0}).to_list(20)
            dob = data.get("date_of_birth")
            grad = _grad_int(data.get("graduation_year"))
            dup = None
            if dob:
                dup = next((c for c in candidates if c.get("date_of_birth") == dob), None)
            elif grad is not None:
                dup = next((c for c in candidates
                            if not c.get("date_of_birth")
                            and _grad_int(c.get("graduation_year")) == grad), None)
            if dup:
                if await _backfill_matched_athlete(org, dup, data):
                    backfilled += 1
                matched += 1
                if await _add_import_row_to_roster(org, event_id, dup["id"], bib,
                                                   group_id=await _row_group_id()):
                    added += 1
                if _grad_int(dup.get("graduation_year")) is None:
                    flagged_no_grad += 1
                continue
            # Explicit age band: a normalized CSV division wins, else derive from a
            # bare age column when there is no DOB (athlete_doc derives from DOB).
            if not data.get("age_group"):
                hint = data.get("age_group_hint")
                if hint:
                    data["age_group"] = hint
                elif not dob and data.get("age") is not None:
                    data["age_group"] = age_band_for_age(data.get("age"))
            allowed = set(AthleteBody.model_fields)
            payload = {k: v for k, v in data.items() if k in allowed and v not in (None, "")}
            try:
                athlete_body = AthleteBody(**payload)
            except Exception:
                skipped += 1
                continue
            doc = athlete_doc(athlete_body, org, user["id"])
            await db.athletes.insert_one(doc)
            created += 1
            if await _add_import_row_to_roster(org, event_id, doc["id"], bib,
                                               group_id=await _row_group_id()):
                added += 1
            if _grad_int(doc.get("graduation_year")) is None:
                flagged_no_grad += 1
            continue

        skipped += 1  # unknown action

    groups_out = []
    if body.auto_group:
        result = await _auto_group_by_grad(event_id, org)
        groups_out = result["groups"]

    await log_audit(org, user, "roster_csv_imported", "event", event_id,
                    {"added": added, "created": created, "matched": matched,
                     "skipped": skipped, "flagged_no_grad": flagged_no_grad,
                     "backfilled": backfilled, "auto_group": body.auto_group})
    return {"added": added, "created": created, "matched": matched,
            "skipped": skipped, "flagged_no_grad": flagged_no_grad,
            "backfilled": backfilled, "groups": groups_out}


# ---------------- Auto-group by graduation year (Revision 4, Task 2) ----------------

async def _auto_group_by_grad(event_id: str, org: str, *, regroup_all: bool = False) -> dict:
    """Ensure a "Class of {year}" group per rostered grad year and place athletes.
    Manual placements (a non-null group_id) are preserved unless regroup_all.
    Athletes with no graduation_year are never bucketed into an invented year."""
    entries = await db.event_athletes.find(
        {"event_id": event_id, "organization_id": org}, {"_id": 0}).to_list(2000)
    athlete_ids = [e["athlete_id"] for e in entries]
    athletes = await db.athletes.find(
        {"id": {"$in": athlete_ids}, "organization_id": org},
        {"_id": 0, "id": 1, "first_name": 1, "last_name": 1, "graduation_year": 1}).to_list(2000)
    amap = {a["id"]: a for a in athletes}
    groups = await db.event_groups.find(
        {"event_id": event_id, "organization_id": org}, {"_id": 0}).to_list(200)
    by_name = {g["name"]: g for g in groups}

    unassigned = []
    grad_group_ids = set()
    for e in entries:
        a = amap.get(e["athlete_id"])
        if not a:
            continue
        grad = _grad_int(a.get("graduation_year"))
        if grad is None:
            unassigned.append({"athlete_id": a["id"], "name": _athlete_display_name(a)})
            continue
        gname = f"Class of {grad}"
        g = by_name.get(gname)
        if not g:
            g = {"id": new_id(), "organization_id": org, "event_id": event_id,
                 "name": gname, "created_at": now_iso()}
            await db.event_groups.insert_one({**g})
            by_name[gname] = g
        grad_group_ids.add(g["id"])
        if (e.get("group_id") is None or regroup_all) and e.get("group_id") != g["id"]:
            await db.event_athletes.update_one(
                {"id": e["id"], "organization_id": org},
                {"$set": {"group_id": g["id"], "updated_at": now_iso()}})

    out_groups = []
    for g in by_name.values():
        if g["id"] not in grad_group_ids:
            continue
        count = await db.event_athletes.count_documents(
            {"event_id": event_id, "organization_id": org, "group_id": g["id"]})
        out_groups.append({"id": g["id"], "name": g["name"], "count": count})
    out_groups.sort(key=lambda g: g["name"])
    return {"groups": out_groups, "unassigned": unassigned}


class AutoGroupBody(BaseModel):
    regroup_all: bool = False


@router.post("/events/{event_id}/groups/auto-by-grad")
async def auto_group_by_grad(event_id: str, body: AutoGroupBody | None = None,
                             user=Depends(require_roles(*ADMIN_ROLES, "coach"))):
    await get_org_event(event_id, user)
    org = user["organization_id"]
    regroup_all = bool(body and body.regroup_all)
    result = await _auto_group_by_grad(event_id, org, regroup_all=regroup_all)
    await log_audit(org, user, "groups_auto_by_grad", "event", event_id,
                    {"groups": [g["name"] for g in result["groups"]],
                     "unassigned": len(result["unassigned"]),
                     "regroup_all": regroup_all})
    return result


@router.patch("/events/{event_id}/groups/{group_id}")
async def rename_group(event_id: str, group_id: str, body: GroupBody,
                       user=Depends(require_roles(*ADMIN_ROLES))):
    await get_org_event(event_id, user)
    org = user["organization_id"]
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Group name is required.")
    res = await db.event_groups.update_one(
        {"id": group_id, "event_id": event_id, "organization_id": org},
        {"$set": {"name": name}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Group not found.")
    await log_audit(org, user, "group_renamed", "event_group", group_id,
                    {"event_id": event_id, "name": name})
    return {"message": "Group renamed.", "id": group_id, "name": name}


class GroupMergeBody(BaseModel):
    into_group_id: str


@router.post("/events/{event_id}/groups/{group_id}/merge")
async def merge_group(event_id: str, group_id: str, body: GroupMergeBody,
                      user=Depends(require_roles(*ADMIN_ROLES))):
    """Move every member of {group_id} into into_group_id, repoint any
    evaluator_assignments and stations referencing the source group, then delete
    the source. (Single-athlete moves already exist: PATCH
    /events/{event_id}/roster/{athlete_id} with {"group_id": ...}.)"""
    await get_org_event(event_id, user)
    org = user["organization_id"]
    if body.into_group_id == group_id:
        raise HTTPException(status_code=400, detail="Cannot merge a group into itself.")
    src = await db.event_groups.find_one(
        {"id": group_id, "event_id": event_id, "organization_id": org}, {"_id": 0})
    dst = await db.event_groups.find_one(
        {"id": body.into_group_id, "event_id": event_id, "organization_id": org}, {"_id": 0})
    if not src or not dst:
        raise HTTPException(status_code=404, detail="Group not found on this event.")
    moved = await db.event_athletes.update_many(
        {"event_id": event_id, "organization_id": org, "group_id": group_id},
        {"$set": {"group_id": dst["id"], "updated_at": now_iso()}})
    # Repoint group references. Two-step ($addToSet then $pull) because Mongo
    # cannot address the same field in one update. Stations carry group_ids too —
    # leaving a deleted id there would silently shrink a station's applicability.
    for coll in (db.evaluator_assignments, db.stations):
        await coll.update_many(
            {"event_id": event_id, "organization_id": org, "group_ids": group_id},
            {"$addToSet": {"group_ids": dst["id"]}})
        await coll.update_many(
            {"event_id": event_id, "organization_id": org, "group_ids": group_id},
            {"$pull": {"group_ids": group_id}})
    await db.event_groups.delete_one({"id": group_id, "event_id": event_id, "organization_id": org})
    await log_audit(org, user, "groups_merged", "event_group", dst["id"],
                    {"event_id": event_id, "from": src["name"], "into": dst["name"],
                     "moved": moved.modified_count})
    return {"message": f"Merged {src['name']} into {dst['name']}.",
            "moved": moved.modified_count, "into_group_id": dst["id"],
            "deleted_group_id": group_id}


# ---------------- Station preset library (Revision 4, Task 3) ----------------
#
# The client's ten stations for the 8-12 station model. Presets create stations
# through the EXISTING shape (same fields create_station writes) and bias
# template resolution ONLY through the existing station.template_id field —
# positions.resolve_template consults it at step 6, AFTER the athlete's own
# age+position template (steps 1-5). So a P at the Pitching station gets his
# age band's Pitching form; the hint only catches athletes the age/position
# chain cannot place. No second evaluation engine, no new schema.

STATION_PRESETS = [
    {"key": "athletic_movement", "name": "Athletic Movement",
     "description": "Speed, jumps and general athleticism testing (60-yard, home-to-first, broad/vertical jump)."},
    {"key": "hitting", "name": "Hitting",
     "description": "Batting practice rounds: exit velocity, bat speed, approach and contact quality."},
    {"key": "infield", "name": "Infield",
     "description": "Ground balls, footwork, glove work, infield throws and range."},
    {"key": "outfield", "name": "Outfield",
     "description": "Fly balls, routes and reads, closing speed and outfield throws."},
    {"key": "throwing_arm", "name": "Throwing / Arm",
     "description": "Arm strength and accuracy: throwing velocity, carry and exchange."},
    {"key": "pitching", "name": "Pitching",
     "description": "Bullpen work: velocity, command, secondary pitches and mechanics."},
    {"key": "catching", "name": "Catching",
     "description": "Receiving, blocking, pop time and throws to bases."},
    {"key": "base_running", "name": "Base Running",
     "description": "Home-to-first, leads and jumps, turns, reads and instincts."},
    {"key": "baseball_iq", "name": "Baseball IQ / Instincts",
     "description": "Situational awareness, decision-making and on-field communication."},
    {"key": "character", "name": "Character / Coachability",
     "description": "Effort, coachability, confidence, teammate impact and response to failure."},
]

# How each preset picks its station.template_id fallback:
#   template_name -> the seeded age-neutral station form of that name
#   position      -> the seeded position-family form via resolve_template itself
#                    (mid band, same mixed-camp default seed.py uses)
# throwing_arm has no dedicated seeded family: its station carries no template
# hint and rides the athlete's own age/position resolution -> org default.
_PRESET_TEMPLATE_HINTS = {
    "athletic_movement": {"template_name": "Athletic Testing Station"},
    "hitting": {"template_name": "Hitting Station"},
    "infield": {"position": "IF"},
    "outfield": {"position": "OF"},
    "throwing_arm": {},
    "pitching": {"position": "P"},
    "catching": {"position": "C"},
    "base_running": {"template_name": "Base Running Station"},
    "baseball_iq": {"template_name": "Baseball IQ Station"},
    "character": {"template_name": "Character and Coachability Station"},
}

PRESET_FALLBACK_AGE_BAND = "13U-14U"  # seed.py's sane default for a mixed camp


def _preset_template_id(templates: list[dict], key: str) -> str | None:
    """Best station-default template for a preset from the org's template list.
    Returns None when no suitable template exists — the resolver's later steps
    (org default) still guarantee a form, so never guess here."""
    hint = _PRESET_TEMPLATE_HINTS.get(key) or {}
    name = hint.get("template_name")
    if name:
        exact = next((t for t in templates
                      if (t.get("name") or "").strip().lower() == name.lower()), None)
        if exact:
            return exact["id"]
        sub = next((t for t in templates
                    if name.lower() in (t.get("name") or "").lower()), None)
        return sub["id"] if sub else None
    pos = hint.get("position")
    if pos:
        tpl, reason = resolve_template(
            templates, position=pos, station_template_id=None,
            age_group=PRESET_FALLBACK_AGE_BAND)
        # Only accept a real position-family hit — hinting the org default here
        # would defeat the resolver's own fallback chain.
        if tpl and (reason or "").startswith("position"):
            return tpl["id"]
    return None


@router.get("/station-presets")
async def list_station_presets(user=Depends(require_roles(*STAFF_ROLES))):
    return STATION_PRESETS


class StationPresetsBody(BaseModel):
    keys: list[str]


@router.post("/events/{event_id}/stations/presets")
async def create_preset_stations(event_id: str, body: StationPresetsBody,
                                 user=Depends(require_roles(*ADMIN_ROLES))):
    """Bulk-create preset stations on an event. Idempotent: presets whose station
    name already exists on the event are skipped, never duplicated."""
    await get_org_event(event_id, user)
    org = user["organization_id"]
    by_key = {p["key"]: p for p in STATION_PRESETS}
    unknown = [k for k in body.keys if k not in by_key]
    if unknown:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown preset key(s): {', '.join(unknown)}. "
                   f"Allowed: {', '.join(by_key)}")
    templates = await db.evaluation_templates.find({"organization_id": org}, {"_id": 0}).to_list(500)
    tmap = {t["id"]: t.get("name") for t in templates}
    existing = await db.stations.find(
        {"event_id": event_id, "organization_id": org}, {"_id": 0, "name": 1}).to_list(200)
    existing_names = {(s.get("name") or "").strip().lower() for s in existing}

    created, skipped = [], []
    for key in dict.fromkeys(body.keys):  # de-dupe, keep order
        preset = by_key[key]
        if preset["name"].strip().lower() in existing_names:
            skipped.append(preset["name"])
            continue
        tid = _preset_template_id(templates, key)
        doc = {"id": new_id(), "organization_id": org, "event_id": event_id,
               "name": preset["name"], "template_id": tid, "group_ids": [],
               "start_time": None, "end_time": None, "preset_key": key,
               "station_kind": {"athletic_movement": "athletic", "throwing_arm": "throwing"}.get(key, key),
               "created_at": now_iso(), "updated_at": now_iso()}
        await db.stations.insert_one(doc)
        existing_names.add(preset["name"].strip().lower())
        created.append({**clean(doc), "template_name": tmap.get(tid)})
    await log_audit(org, user, "stations_presets_created", "event", event_id,
                    {"created": [c["name"] for c in created], "skipped": skipped})
    return {"created": created, "skipped": skipped}


# ---------------- Staffing recommendation (Revision 5 §7-9) ----------------
#
# Pure deterministic arithmetic over live event data (roster, groups, stations,
# assignments). Every knob is a named constant with its rationale. Missing data
# produces honest zeros and no warnings — never an invented estimate.

# Group sizing (§7): a group should clear one station rep-cycle without a queue.
GROUP_TARGET_YOUNG = 7    # 8-12 majority: shorter attention spans -> tighter groups
GROUP_TARGET_OLDER = 8    # 13U+ majority: older athletes sustain a larger rotation
YOUNG_AGE_CEILING = 12    # an age band whose upper age <= this counts toward "young"

# Evaluators (§8): minimum assumes one evaluator can float across adjacent
# stations; recommended is one per active station; ideal adds a specialty/floater.
EVALUATOR_SHARE_FACTOR = 0.6

# Check-in/data staff (§8): one per 25 enrolled keeps the check-in line moving;
# at least one whenever anyone is enrolled.
CHECKIN_PER_ENROLLED = 25

# Metrics/timing (§8): one operator runs a gun + stopwatch line; enrollment past
# this threshold is worth splitting into a second parallel timing line.
METRICS_SPLIT_ENROLLMENT = 40

# Flow coaches (§8): recommended one per two groups keeps every rotation moving;
# minimum one per four still functions with the site manager pitching in.
FLOW_GROUPS_PER_COACH_REC = 2
FLOW_GROUPS_PER_COACH_MIN = 4

# Media/video (§9): never required to run the evaluation; one dedicated shooter
# is worth it at showcase scale.
MEDIA_ENROLLMENT_THRESHOLD = 40


@router.get("/events/{event_id}/staffing")
async def event_staffing(event_id: str, user=Depends(require_roles(*ADMIN_ROLES, "coach"))):
    """Deterministic staffing recommendation computed from live event data.

    Scales the 60'6\" standard from "12 athletes, one field, one radar gun" to
    "80 athletes across multiple fields" using the documented constants above.
    """
    ev = await get_org_event(event_id, user)
    org = user["organization_id"]
    base = {"event_id": event_id, "organization_id": org}

    entries = await db.event_athletes.find(base, {"_id": 0, "athlete_id": 1}).to_list(2000)
    enrollment = len(entries)
    group_docs = await db.event_groups.find(base, {"_id": 0, "id": 1, "name": 1}).to_list(200)
    groups = len(group_docs)
    stations = await db.stations.find(
        base, {"_id": 0, "id": 1, "name": 1, "module_state": 1}).to_list(200)
    active = [s for s in stations if module_state_of(s) != "not_offered"]
    active_stations = len(active)

    # Age mix from the rostered athletes' actual bands — unknown bands are
    # counted as unknown, never guessed into a bucket.
    athletes = await db.athletes.find(
        {"id": {"$in": [e["athlete_id"] for e in entries]}, "organization_id": org},
        {"_id": 0, "age_group": 1}).to_list(2000)
    young = older = unknown = 0
    for a in athletes:
        span = AGE_BAND_SPANS.get(a.get("age_group"))
        if not span:
            unknown += 1
        elif span[1] <= YOUNG_AGE_CEILING:
            young += 1
        else:
            older += 1
    group_target = GROUP_TARGET_YOUNG if young > older else GROUP_TARGET_OLDER
    recommended_groups = math.ceil(enrollment / group_target) if enrollment else 0

    assignments = await db.evaluator_assignments.find(
        {**base, **active_assignment_filter()},
        {"_id": 0, "evaluator_id": 1, "station_id": 1, "group_ids": 1}).to_list(500)
    assigned_evaluators = len({a["evaluator_id"] for a in assignments})

    # Timing work exists when the event offers any athletic test, or (for events
    # configured before testing_config existed) runs an active testing station.
    offered_tests = [t for t in (ev.get("testing_config") or [])
                     if t.get("state") in ("required", "optional")]
    has_timing_work = bool(offered_tests) or any(
        "athletic" in (s.get("name") or "").lower() or "testing" in (s.get("name") or "").lower()
        for s in active)

    def role(name, minimum, recommended, ideal):
        return {"role": name, "minimum": minimum,
                "recommended": max(minimum, recommended), "ideal": max(minimum, recommended, ideal)}

    checkin_min = max(1, math.ceil(enrollment / CHECKIN_PER_ENROLLED)) if enrollment else 0
    eval_min = math.ceil(active_stations * EVALUATOR_SHARE_FACTOR)
    metrics_rec = (2 if enrollment > METRICS_SPLIT_ENROLLMENT else 1) if has_timing_work else 0
    flow_min = math.ceil(groups / FLOW_GROUPS_PER_COACH_MIN) if groups else 0
    flow_rec = math.ceil(groups / FLOW_GROUPS_PER_COACH_REC) if groups else 0

    roles = [
        # Someone is always accountable for the site, even at 12 athletes.
        role("Event/Site Manager", 1, 1, 1),
        role("Check-In/Data Staff", checkin_min, checkin_min,
             checkin_min + (1 if enrollment else 0)),  # ideal adds a walk-up buffer
        role("Evaluators", eval_min, active_stations,
             active_stations + (1 if active_stations else 0)),  # ideal adds a floater
        role("Metrics/Timing", 1 if has_timing_work else 0, metrics_rec, metrics_rec),
        role("Group/Flow Coaches", flow_min, flow_rec, groups),  # ideal: one per group
        role("Media/Video", 0, 1 if enrollment >= MEDIA_ENROLLMENT_THRESHOLD else 0,
             1 if enrollment else 0),
    ]
    staff = {
        "minimum": sum(r["minimum"] for r in roles),
        "recommended": sum(r["recommended"] for r in roles),
        "ideal": sum(r["ideal"] for r in roles),
    }

    # Deterministic warnings (§10) — each derives from data actually present.
    warnings = []
    if active_stations and assigned_evaluators < active_stations:
        warnings.append(f"⚠ {active_stations} active stations but only "
                        f"{assigned_evaluators} evaluators assigned")
    if assignments and group_docs:
        # An assignment with empty group_ids covers every group.
        covered = set()
        for a in assignments:
            gids = a.get("group_ids") or []
            if not gids:
                covered = {g["id"] for g in group_docs}
                break
            covered.update(gids)
        uncovered = [g["name"] for g in group_docs if g["id"] not in covered]
        if uncovered:
            warnings.append(f"⚠ {len(uncovered)} group(s) have no evaluator "
                            f"assignment coverage: {', '.join(sorted(uncovered))}")
    if enrollment and groups and recommended_groups:
        if groups < recommended_groups:
            warnings.append(f"⚠ {enrollment} enrolled across {groups} group(s) — "
                            f"recommend {recommended_groups} groups of ~{group_target}")
        elif groups > recommended_groups * 2:
            warnings.append(f"⚠ {groups} groups for {enrollment} enrolled is over-split — "
                            f"recommend {recommended_groups} groups of ~{group_target}")

    return {
        "enrollment": enrollment,
        "groups": groups,
        "active_stations": active_stations,
        "recommended_groups": recommended_groups,
        "group_size_target": group_target,
        "age_mix": {"young": young, "older": older, "unknown": unknown},
        "staff": staff,
        "roles": roles,
        "assigned_evaluators": assigned_evaluators,
        "warnings": warnings,
    }
