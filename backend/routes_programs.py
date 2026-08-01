"""Programmes, sessions, enrolments, attendance — year-round training chassis.

Keep `events` for evaluation days. A session may optionally link `event_id`.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import ADMIN_ROLES, COACH_ROLES, STAFF_ROLES, require_roles
from db import clean, db, log_audit, new_id, now_iso

router = APIRouter(prefix="/programs", tags=["programs"])

PROGRAM_TYPES = ("camp", "clinic", "training_block", "coaching_clinic")
PROGRAM_STATUSES = ("draft", "open", "in_progress", "completed", "cancelled")
ENROLL_STATUSES = ("pending", "enrolled", "waitlisted", "withdrawn", "completed")
ATTEND_STATUSES = ("present", "absent", "late", "excused")
SESSION_STATUSES = ("scheduled", "in_progress", "completed", "cancelled")


class ProgramBody(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    type: str = "camp"
    start_date: str | None = None
    end_date: str | None = None
    capacity: int | None = Field(default=None, ge=1, le=5000)
    price_cents: int | None = Field(default=None, ge=0)
    age_groups: list[str] = []
    description: str | None = Field(default=None, max_length=5000)
    location_id: str | None = None
    status: str = "draft"


class ProgramPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    type: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    capacity: int | None = Field(default=None, ge=1, le=5000)
    price_cents: int | None = Field(default=None, ge=0)
    age_groups: list[str] | None = None
    description: str | None = Field(default=None, max_length=5000)
    location_id: str | None = None
    status: str | None = None

    class Config:
        extra = "forbid"


class SessionBody(BaseModel):
    date: str
    start_time: str | None = None
    end_time: str | None = None
    location_id: str | None = None
    session_number: int | None = None
    focus: str | None = Field(default=None, max_length=500)
    event_id: str | None = None  # optional link to evaluation event
    status: str = "scheduled"


class EnrollBody(BaseModel):
    athlete_id: str
    status: str = "enrolled"
    payment_status: str = "unpaid"
    source: str = "staff"


class AttendanceBody(BaseModel):
    athlete_id: str
    status: str = "present"


class LocationBody(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    address: str | None = None
    city: str | None = None
    state: str | None = None
    notes: str | None = None


def _org(user):
    return user["organization_id"]


@router.get("/locations")
async def list_locations(user=Depends(require_roles(*STAFF_ROLES))):
    rows = await db.locations.find({"organization_id": _org(user)}, {"_id": 0}).sort("name", 1).to_list(200)
    return rows


@router.post("/locations")
async def create_location(body: LocationBody, user=Depends(require_roles(*ADMIN_ROLES, *COACH_ROLES))):
    doc = {
        "id": new_id(),
        "organization_id": _org(user),
        **body.model_dump(),
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.locations.insert_one(doc)
    await log_audit(_org(user), user, "location_created", "location", doc["id"], {"name": body.name})
    return clean(doc)


@router.get("")
async def list_programs(
    status: str | None = None,
    type: str | None = None,
    user=Depends(require_roles(*STAFF_ROLES)),
):
    q: dict = {"organization_id": _org(user)}
    if status:
        q["status"] = status
    if type:
        q["type"] = type
    rows = await db.programs.find(q, {"_id": 0}).sort("start_date", -1).to_list(500)
    return rows


@router.post("")
async def create_program(body: ProgramBody, user=Depends(require_roles(*ADMIN_ROLES, *COACH_ROLES))):
    if body.type not in PROGRAM_TYPES:
        raise HTTPException(422, detail=f"type must be one of {PROGRAM_TYPES}")
    if body.status not in PROGRAM_STATUSES:
        raise HTTPException(422, detail=f"status must be one of {PROGRAM_STATUSES}")
    doc = {
        "id": new_id(),
        "organization_id": _org(user),
        **body.model_dump(),
        "created_by": user["id"],
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.programs.insert_one(doc)
    await log_audit(_org(user), user, "program_created", "program", doc["id"], {"name": body.name, "type": body.type})
    return clean(doc)


@router.get("/{program_id}")
async def get_program(program_id: str, user=Depends(require_roles(*STAFF_ROLES))):
    prog = await db.programs.find_one({"id": program_id, "organization_id": _org(user)}, {"_id": 0})
    if not prog:
        raise HTTPException(404, detail="Program not found.")
    sessions = await db.sessions.find(
        {"program_id": program_id, "organization_id": _org(user)}, {"_id": 0}
    ).sort("date", 1).to_list(500)
    enrolled = await db.enrollments.count_documents({
        "program_id": program_id, "organization_id": _org(user),
        "status": {"$in": ["enrolled", "completed"]},
    })
    return {**prog, "sessions": sessions, "enrollment_count": enrolled}


@router.patch("/{program_id}")
async def patch_program(program_id: str, body: ProgramPatch, user=Depends(require_roles(*ADMIN_ROLES, *COACH_ROLES))):
    prog = await db.programs.find_one({"id": program_id, "organization_id": _org(user)}, {"_id": 0})
    if not prog:
        raise HTTPException(404, detail="Program not found.")
    updates = body.model_dump(exclude_unset=True)
    if "type" in updates and updates["type"] not in PROGRAM_TYPES:
        raise HTTPException(422, detail=f"type must be one of {PROGRAM_TYPES}")
    if "status" in updates and updates["status"] not in PROGRAM_STATUSES:
        raise HTTPException(422, detail=f"status must be one of {PROGRAM_STATUSES}")
    if not updates:
        return clean(prog)
    updates["updated_at"] = now_iso()
    await db.programs.update_one({"id": program_id, "organization_id": _org(user)}, {"$set": updates})
    prog.update(updates)
    return clean(prog)


@router.post("/{program_id}/sessions")
async def add_session(program_id: str, body: SessionBody, user=Depends(require_roles(*ADMIN_ROLES, *COACH_ROLES))):
    prog = await db.programs.find_one({"id": program_id, "organization_id": _org(user)}, {"_id": 0, "id": 1})
    if not prog:
        raise HTTPException(404, detail="Program not found.")
    if body.status not in SESSION_STATUSES:
        raise HTTPException(422, detail=f"status must be one of {SESSION_STATUSES}")
    if body.event_id:
        ev = await db.events.find_one({"id": body.event_id, "organization_id": _org(user)}, {"_id": 0, "id": 1})
        if not ev:
            raise HTTPException(422, detail="Linked event not found in this organization.")
    count = await db.sessions.count_documents({"program_id": program_id, "organization_id": _org(user)})
    doc = {
        "id": new_id(),
        "organization_id": _org(user),
        "program_id": program_id,
        **body.model_dump(),
        "session_number": body.session_number if body.session_number is not None else count + 1,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.sessions.insert_one(doc)
    await log_audit(_org(user), user, "session_created", "session", doc["id"], {"program_id": program_id})
    return clean(doc)


@router.get("/{program_id}/sessions")
async def list_sessions(program_id: str, user=Depends(require_roles(*STAFF_ROLES))):
    prog = await db.programs.find_one({"id": program_id, "organization_id": _org(user)}, {"_id": 0, "id": 1})
    if not prog:
        raise HTTPException(404, detail="Program not found.")
    return await db.sessions.find(
        {"program_id": program_id, "organization_id": _org(user)}, {"_id": 0}
    ).sort("date", 1).to_list(500)


@router.get("/{program_id}/enrollments")
async def list_enrollments(program_id: str, user=Depends(require_roles(*STAFF_ROLES))):
    prog = await db.programs.find_one({"id": program_id, "organization_id": _org(user)}, {"_id": 0, "id": 1})
    if not prog:
        raise HTTPException(404, detail="Program not found.")
    rows = await db.enrollments.find(
        {"program_id": program_id, "organization_id": _org(user)}, {"_id": 0}
    ).to_list(2000)
    athlete_ids = [r["athlete_id"] for r in rows]
    athletes = await db.athletes.find(
        {"id": {"$in": athlete_ids}, "organization_id": _org(user)},
        {"_id": 0, "id": 1, "first_name": 1, "last_name": 1, "age_group": 1, "primary_position": 1},
    ).to_list(2000)
    amap = {a["id"]: a for a in athletes}
    return [{**r, "athlete": amap.get(r["athlete_id"])} for r in rows]


@router.post("/{program_id}/enrollments")
async def enroll_athlete(program_id: str, body: EnrollBody, user=Depends(require_roles(*ADMIN_ROLES, *COACH_ROLES))):
    prog = await db.programs.find_one({"id": program_id, "organization_id": _org(user)}, {"_id": 0})
    if not prog:
        raise HTTPException(404, detail="Program not found.")
    athlete = await db.athletes.find_one(
        {"id": body.athlete_id, "organization_id": _org(user)}, {"_id": 0, "id": 1})
    if not athlete:
        raise HTTPException(404, detail="Athlete not found.")
    if body.status not in ENROLL_STATUSES:
        raise HTTPException(422, detail=f"status must be one of {ENROLL_STATUSES}")
    if prog.get("capacity"):
        n = await db.enrollments.count_documents({
            "program_id": program_id, "organization_id": _org(user),
            "status": {"$in": ["enrolled", "completed"]},
        })
        if n >= prog["capacity"] and body.status == "enrolled":
            raise HTTPException(409, detail="Program is at capacity. Use waitlisted status.")
    existing = await db.enrollments.find_one({
        "program_id": program_id, "athlete_id": body.athlete_id, "organization_id": _org(user),
    })
    if existing:
        raise HTTPException(400, detail="Athlete already enrolled in this program.")
    doc = {
        "id": new_id(),
        "organization_id": _org(user),
        "program_id": program_id,
        "athlete_id": body.athlete_id,
        "status": body.status,
        "payment_status": body.payment_status,
        "source": body.source,
        "enrolled_at": now_iso(),
        "enrolled_by": user["id"],
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.enrollments.insert_one(doc)
    await log_audit(_org(user), user, "enrollment_created", "enrollment", doc["id"],
                    {"program_id": program_id, "athlete_id": body.athlete_id})
    return clean(doc)


@router.post("/sessions/{session_id}/attendance")
async def record_attendance(session_id: str, body: AttendanceBody, user=Depends(require_roles(*STAFF_ROLES))):
    session = await db.sessions.find_one({"id": session_id, "organization_id": _org(user)}, {"_id": 0})
    if not session:
        raise HTTPException(404, detail="Session not found.")
    if body.status not in ATTEND_STATUSES:
        raise HTTPException(422, detail=f"status must be one of {ATTEND_STATUSES}")
    enrolled = await db.enrollments.find_one({
        "program_id": session["program_id"], "athlete_id": body.athlete_id,
        "organization_id": _org(user), "status": {"$in": ["enrolled", "completed"]},
    })
    if not enrolled:
        raise HTTPException(422, detail="Athlete is not enrolled in this program.")
    now = now_iso()
    await db.attendance.update_one(
        {"session_id": session_id, "athlete_id": body.athlete_id, "organization_id": _org(user)},
        {"$set": {
            "status": body.status, "recorded_by": user["id"], "recorded_at": now, "updated_at": now,
        }, "$setOnInsert": {
            "id": new_id(), "organization_id": _org(user), "session_id": session_id,
            "athlete_id": body.athlete_id, "program_id": session["program_id"], "created_at": now,
        }},
        upsert=True,
    )
    row = await db.attendance.find_one(
        {"session_id": session_id, "athlete_id": body.athlete_id, "organization_id": _org(user)},
        {"_id": 0})
    return clean(row)


@router.get("/sessions/{session_id}/attendance")
async def list_attendance(session_id: str, user=Depends(require_roles(*STAFF_ROLES))):
    session = await db.sessions.find_one({"id": session_id, "organization_id": _org(user)}, {"_id": 0, "id": 1})
    if not session:
        raise HTTPException(404, detail="Session not found.")
    return await db.attendance.find(
        {"session_id": session_id, "organization_id": _org(user)}, {"_id": 0}
    ).to_list(2000)
