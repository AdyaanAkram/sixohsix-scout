from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import COACH_ROLES, REVIEW_ROLES, STAFF_ROLES, require_roles
from db import clean, db, log_audit, new_id, now_iso

router = APIRouter()

ASSESSMENT_TYPES = ["Practice Observation", "Game Observation", "Training Assessment",
                    "Tryout Assessment", "Showcase Assessment", "Development Check-In",
                    "Injury Return Observation", "Position Review", "Scout Follow-Up"]

# Canonical note types / visibility buckets (append-only — never overwrite)
NOTE_TYPES = [
    "general", "development", "private_staff", "parent_visible", "scout", "follow_up",
    # legacy values kept for reads
    "assessment", "scout_assessment",
]

PARENT_VISIBLE_TYPES = {"parent_visible", "general"}
ATHLETE_HIDDEN_TYPES = {"private_staff", "scout", "follow_up", "scout_assessment"}
EVALUATOR_HIDDEN_TYPES = {"private_staff", "scout"}

GOAL_STATUSES = ["Not Started", "Active", "Improving", "Needs Attention", "Completed", "Archived"]


def _normalize_note_type(raw: str | None, assessment_type: str | None = None) -> str:
    t = (raw or "").strip().lower().replace(" ", "_")
    aliases = {
        "private": "private_staff",
        "staff": "private_staff",
        "staff_private": "private_staff",
        "parent": "parent_visible",
        "parents": "parent_visible",
        "assessment": "development",
        "scout_assessment": "scout",
        "scouting": "scout",
    }
    t = aliases.get(t, t)
    if t in NOTE_TYPES and t not in ("assessment", "scout_assessment"):
        return t
    if assessment_type == "Scout Follow-Up":
        return "follow_up"
    return "development"


def _note_visible_to_role(note: dict, role: str) -> bool:
    ntype = note.get("note_type") or note.get("visibility") or "general"
    if note.get("confidential") and role not in ("owner", "admin", "head_scout"):
        return False
    if role in ("athlete", "parent", "guardian"):
        if ntype in ATHLETE_HIDDEN_TYPES:
            return False
        return ntype in PARENT_VISIBLE_TYPES or bool(note.get("parent_visible_note"))
    if role == "evaluator":
        if ntype in EVALUATOR_HIDDEN_TYPES:
            return False
        return True
    return True


def _strip_note_for_role(note: dict, role: str) -> dict:
    out = dict(note)
    if role in ("athlete", "parent", "guardian", "evaluator"):
        out.pop("internal_note", None)
    if role in ("athlete", "parent", "guardian"):
        # Prefer parent-facing text when present
        if out.get("parent_visible_note") and not out.get("summary"):
            out["summary"] = out["parent_visible_note"]
    return out


# ---------------- Coach / YTD assessments (athlete notes) ----------------

class NoteBody(BaseModel):
    athlete_id: str
    assessment_date: str | None = None
    assessment_type: str = "Practice Observation"
    note_type: str = "development"
    visibility: str | None = None  # alias of note_type when provided
    team_or_program: str | None = None
    strengths: str | None = None
    development_priorities: str | None = None
    recommended_drills: str | None = None
    position_recommendation: str | None = None
    follow_up_date: str | None = None
    internal_note: str | None = None
    parent_visible_note: str | None = None
    summary: str | None = None
    goal_id: str | None = None


@router.get("/athletes/{athlete_id}/notes")
async def list_notes(athlete_id: str, user=Depends(require_roles(*STAFF_ROLES))):
    a = await db.athletes.find_one({"id": athlete_id, "organization_id": user["organization_id"]})
    if not a:
        raise HTTPException(status_code=404, detail="Player not found.")
    notes = await db.athlete_notes.find(
        {"athlete_id": athlete_id, "organization_id": user["organization_id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    role = user["role"]
    return [_strip_note_for_role(n, role) for n in notes if _note_visible_to_role(n, role)]


@router.post("/athletes/{athlete_id}/notes")
async def create_note(athlete_id: str, body: NoteBody, user=Depends(require_roles(*COACH_ROLES))):
    a = await db.athletes.find_one({"id": athlete_id, "organization_id": user["organization_id"]})
    if not a:
        raise HTTPException(status_code=404, detail="Player not found.")
    if body.assessment_type not in ASSESSMENT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid assessment type.")
    note_type = _normalize_note_type(body.visibility or body.note_type, body.assessment_type)
    doc = body.model_dump()
    doc.update({
        "id": new_id(), "organization_id": user["organization_id"],
        "athlete_id": athlete_id,
        "note_type": note_type,
        "visibility": note_type,
        "author_id": user["id"], "author_name": user.get("full_name"), "author_role": user["role"],
        "assessment_date": body.assessment_date or now_iso()[:10],
        "created_at": now_iso(), "updated_at": now_iso(),
        # AI-ready fields (unused in MVP)
        "ai_draft": None, "ai_model": None, "ai_generated_at": None,
        "ai_approved_by": None, "ai_approved_at": None, "ai_status": None,
    })
    # Append-only: always insert, never update/overwrite an existing note
    await db.athlete_notes.insert_one(doc)
    await log_audit(user["organization_id"], user, "assessment_added", "athlete_note", doc["id"],
                    {"athlete_id": athlete_id, "type": body.assessment_type, "note_type": note_type})
    return clean(doc)


# ---------------- Head scout final assessment ----------------

class ScoutAssessmentBody(BaseModel):
    athlete_id: str
    summary: str
    position_recommendation: str | None = None
    development_recommendation: str | None = None
    flag_follow_up: bool = False
    team_consideration: bool = False
    confidential: bool = False


@router.post("/scout-assessments")
async def create_scout_assessment(body: ScoutAssessmentBody, user=Depends(require_roles(*REVIEW_ROLES))):
    a = await db.athletes.find_one({"id": body.athlete_id, "organization_id": user["organization_id"]})
    if not a:
        raise HTTPException(status_code=404, detail="Player not found.")
    note_type = "scout"
    doc = {
        "id": new_id(), "organization_id": user["organization_id"],
        "athlete_id": body.athlete_id,
        "note_type": note_type,
        "visibility": "private_staff" if body.confidential else "scout",
        "assessment_type": "Head Scout Assessment",
        "author_id": user["id"], "author_name": user.get("full_name"), "author_role": user["role"],
        "summary": body.summary,
        "position_recommendation": body.position_recommendation,
        "development_recommendation": body.development_recommendation,
        "flag_follow_up": body.flag_follow_up,
        "team_consideration": body.team_consideration,
        "confidential": body.confidential,
        "assessment_date": now_iso()[:10],
        "created_at": now_iso(), "updated_at": now_iso(),
    }
    # Append-only
    await db.athlete_notes.insert_one(doc)
    if body.flag_follow_up:
        await db.athletes.update_one({"id": body.athlete_id}, {"$set": {"flagged_follow_up": True, "updated_at": now_iso()}})
    if body.position_recommendation:
        await db.athletes.update_one({"id": body.athlete_id}, {"$set": {"position_projection": body.position_recommendation}})
    await log_audit(user["organization_id"], user, "scout_assessment_added", "athlete_note", doc["id"], {"athlete_id": body.athlete_id})
    return clean(doc)


@router.get("/flagged-athletes")
async def flagged_athletes(user=Depends(require_roles(*REVIEW_ROLES))):
    athletes = await db.athletes.find({"organization_id": user["organization_id"], "flagged_follow_up": True, "status": "active"}, {"_id": 0}).to_list(200)
    return athletes


class FlagBody(BaseModel):
    flagged: bool


@router.post("/athletes/{athlete_id}/flag")
async def flag_athlete(athlete_id: str, body: FlagBody, user=Depends(require_roles(*REVIEW_ROLES))):
    res = await db.athletes.update_one(
        {"id": athlete_id, "organization_id": user["organization_id"]},
        {"$set": {"flagged_follow_up": body.flagged, "updated_at": now_iso()}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Player not found.")
    await log_audit(user["organization_id"], user, "athlete_flagged" if body.flagged else "athlete_unflagged", "athlete", athlete_id)
    return {"message": "Follow-up flag updated."}


# ---------------- Development goals ----------------

class GoalBody(BaseModel):
    athlete_id: str
    title: str
    description: str | None = None
    category: str | None = None
    starting_point: str | None = None
    target: str | None = None
    target_date: str | None = None
    assigned_coach_id: str | None = None
    recommended_drills: str | None = None
    progress: int = 0
    status: str = "Not Started"
    notes: str | None = None


class GoalUpdateBody(BaseModel):
    title: str | None = None
    description: str | None = None
    category: str | None = None
    starting_point: str | None = None
    target: str | None = None
    target_date: str | None = None
    recommended_drills: str | None = None
    progress: int | None = None
    status: str | None = None
    notes: str | None = None


@router.get("/athletes/{athlete_id}/goals")
async def list_goals(athlete_id: str, user=Depends(require_roles(*STAFF_ROLES))):
    a = await db.athletes.find_one({"id": athlete_id, "organization_id": user["organization_id"]})
    if not a:
        raise HTTPException(status_code=404, detail="Player not found.")
    return await db.athlete_goals.find({"athlete_id": athlete_id, "organization_id": user["organization_id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)


@router.post("/goals")
async def create_goal(body: GoalBody, user=Depends(require_roles(*COACH_ROLES))):
    a = await db.athletes.find_one({"id": body.athlete_id, "organization_id": user["organization_id"]})
    if not a:
        raise HTTPException(status_code=404, detail="Player not found.")
    if body.status not in GOAL_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid goal status.")
    doc = body.model_dump()
    coach_name = user.get("full_name")
    if body.assigned_coach_id:
        coach = await db.users.find_one({"id": body.assigned_coach_id}, {"_id": 0, "full_name": 1})
        if coach:
            coach_name = coach["full_name"]
    doc.update({
        "id": new_id(), "organization_id": user["organization_id"],
        "assigned_coach_id": body.assigned_coach_id or user["id"],
        "assigned_coach_name": coach_name,
        "created_by": user["id"], "created_at": now_iso(), "updated_at": now_iso(),
    })
    await db.athlete_goals.insert_one(doc)
    await log_audit(user["organization_id"], user, "goal_created", "athlete_goal", doc["id"], {"athlete_id": body.athlete_id, "title": body.title})
    return clean(doc)


@router.patch("/goals/{goal_id}")
async def update_goal(goal_id: str, body: GoalUpdateBody, user=Depends(require_roles(*COACH_ROLES))):
    g = await db.athlete_goals.find_one({"id": goal_id, "organization_id": user["organization_id"]})
    if not g:
        raise HTTPException(status_code=404, detail="Goal not found.")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if "status" in updates and updates["status"] not in GOAL_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid goal status.")
    if "progress" in updates:
        updates["progress"] = max(0, min(100, updates["progress"]))
    updates["updated_at"] = now_iso()
    await db.athlete_goals.update_one({"id": goal_id}, {"$set": updates})
    await log_audit(user["organization_id"], user, "goal_updated", "athlete_goal", goal_id, updates)
    return {"message": "Goal updated."}


@router.get("/development/overview")
async def development_overview(user=Depends(require_roles(*COACH_ROLES))):
    goals = await db.athlete_goals.find({"organization_id": user["organization_id"], "status": {"$ne": "Archived"}}, {"_id": 0}).sort("updated_at", -1).to_list(300)
    athlete_ids = list({g["athlete_id"] for g in goals})
    athletes = await db.athletes.find({"id": {"$in": athlete_ids}}, {"_id": 0, "id": 1, "first_name": 1, "last_name": 1, "age_group": 1, "primary_position": 1, "photo_url": 1}).to_list(300)
    amap = {a["id"]: a for a in athletes}
    for g in goals:
        g["athlete"] = amap.get(g["athlete_id"])
    recent_notes = await db.athlete_notes.find({"organization_id": user["organization_id"], "note_type": "assessment"}, {"_id": 0}).sort("created_at", -1).to_list(20)
    for n in recent_notes:
        n["athlete"] = amap.get(n["athlete_id"]) or await db.athletes.find_one(
            {"id": n["athlete_id"], "organization_id": user["organization_id"]},
            {"_id": 0, "id": 1, "first_name": 1, "last_name": 1, "age_group": 1})
    return {"goals": goals, "recent_assessments": recent_notes}
