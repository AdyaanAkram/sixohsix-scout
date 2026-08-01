"""Athlete awards — submit → pending → approve/reject."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import ADMIN_ROLES, COACH_ROLES, STAFF_ROLES, get_current_user, require_roles
from db import clean, db, log_audit, new_id, now_iso
from notifications import notify, notify_athlete_users

router = APIRouter()

AWARD_CATEGORIES = ("defense", "offense", "overall", "milestone", "athleticism")


class AwardBody(BaseModel):
    athlete_id: str
    title: str = Field(min_length=2)
    category: str = "overall"
    description: str | None = None
    proof_url: str | None = None


class RejectBody(BaseModel):
    reason: str | None = None


@router.post("/awards")
async def submit_award(body: AwardBody, user=Depends(require_roles(*STAFF_ROLES, "athlete", "parent"))):
    if body.category not in AWARD_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"category must be one of {AWARD_CATEGORIES}")
    athlete = await db.athletes.find_one(
        {"id": body.athlete_id, "organization_id": user["organization_id"]}, {"_id": 0})
    if not athlete:
        raise HTTPException(status_code=404, detail="Player not found.")
    # Athletes/parents may only submit for their linked athlete
    if user["role"] in ("athlete", "parent"):
        linked = athlete.get("user_id") == user["id"] or athlete.get("guardian_user_id") == user["id"]
        if not linked:
            raise HTTPException(status_code=403, detail="You can only submit awards for your linked athlete.")
    doc = {
        "id": new_id(),
        "organization_id": user["organization_id"],
        "athlete_id": body.athlete_id,
        "title": body.title.strip(),
        "category": body.category,
        "description": body.description,
        "proof_url": body.proof_url,
        "submitted_by": user["id"],
        "submitted_by_name": user.get("full_name"),
        "submitted_by_role": user["role"],
        "status": "pending",
        "created_at": now_iso(),
        "verified_by": None,
        "verified_at": None,
        "reject_reason": None,
    }
    await db.awards.insert_one(doc)
    # Notify org admins
    memberships = await db.memberships.find(
        {"organization_id": user["organization_id"], "role": {"$in": list(ADMIN_ROLES)}, "active": True},
        {"_id": 0, "user_id": 1}).to_list(50)
    for m in memberships:
        await notify(m["user_id"], "award_pending", "Award pending review",
                     f"{body.title} for {athlete.get('first_name')} {athlete.get('last_name')}",
                     {"award_id": doc["id"], "athlete_id": body.athlete_id})
    await log_audit(user["organization_id"], user, "award_submitted", "award", doc["id"],
                    {"athlete_id": body.athlete_id})
    return clean(doc)


@router.get("/awards/athlete/{athlete_id}")
async def list_athlete_awards(athlete_id: str, user=Depends(require_roles(*STAFF_ROLES, "athlete", "parent"))):
    a = await db.athletes.find_one({"id": athlete_id, "organization_id": user["organization_id"]})
    if not a:
        raise HTTPException(status_code=404, detail="Player not found.")
    q = {"athlete_id": athlete_id, "organization_id": user["organization_id"]}
    if user["role"] in ("athlete", "parent"):
        q["status"] = {"$in": ["approved", "pending"]}
    return await db.awards.find(q, {"_id": 0}).sort("created_at", -1).to_list(100)


@router.get("/awards/pending")
async def pending_awards(user=Depends(require_roles(*ADMIN_ROLES, "head_scout"))):
    return await db.awards.find(
        {"organization_id": user["organization_id"], "status": "pending"}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)


@router.post("/awards/{award_id}/approve")
async def approve_award(award_id: str, user=Depends(require_roles(*ADMIN_ROLES, "head_scout"))):
    a = await db.awards.find_one({"id": award_id, "organization_id": user["organization_id"]})
    if not a:
        raise HTTPException(status_code=404, detail="Award not found.")
    if a["status"] != "pending":
        raise HTTPException(status_code=400, detail="Only pending awards can be approved.")
    ts = now_iso()
    await db.awards.update_one({"id": award_id}, {"$set": {
        "status": "approved", "verified_by": user["id"], "verified_by_name": user.get("full_name"),
        "verified_at": ts,
    }})
    athlete = await db.athletes.find_one({"id": a["athlete_id"], "organization_id": user["organization_id"]}, {"_id": 0})
    ms = {
        "id": new_id(),
        "organization_id": user["organization_id"],
        "athlete_id": a["athlete_id"],
        "kind": "badge_unlocked",
        "metric_key": None,
        "value": None,
        "unit": None,
        "prev_value": None,
        "delta": None,
        "label": f"Award · {a['title']}",
        "detail": a.get("description") or a["category"],
        "created_at": ts,
    }
    await db.milestones.insert_one(ms)
    if athlete:
        await notify_athlete_users(
            athlete, "award_approved", f"Award approved · {a['title']}",
            "Your award was verified by staff.",
            {"award_id": award_id, "athlete_id": a["athlete_id"]})
    await log_audit(user["organization_id"], user, "award_approved", "award", award_id)
    return {"message": "Award approved.", "milestone_id": ms["id"]}


@router.post("/awards/{award_id}/reject")
async def reject_award(award_id: str, body: RejectBody, user=Depends(require_roles(*ADMIN_ROLES, "head_scout"))):
    a = await db.awards.find_one({"id": award_id, "organization_id": user["organization_id"]})
    if not a:
        raise HTTPException(status_code=404, detail="Award not found.")
    if a["status"] != "pending":
        raise HTTPException(status_code=400, detail="Only pending awards can be rejected.")
    await db.awards.update_one({"id": award_id}, {"$set": {
        "status": "rejected", "reject_reason": body.reason,
        "verified_by": user["id"], "verified_at": now_iso(),
    }})
    athlete = await db.athletes.find_one({"id": a["athlete_id"], "organization_id": user["organization_id"]}, {"_id": 0})
    if athlete:
        await notify_athlete_users(
            athlete, "award_rejected", f"Award not approved · {a['title']}",
            body.reason or "Staff could not verify this award.",
            {"award_id": award_id, "athlete_id": a["athlete_id"]})
    await log_audit(user["organization_id"], user, "award_rejected", "award", award_id, {"reason": body.reason})
    return {"message": "Award rejected."}


@router.get("/me/awards")
async def me_awards(user=Depends(get_current_user)):
    role = user.get("role")
    org = user["organization_id"]
    if role == "athlete":
        a = await db.athletes.find_one({"user_id": user["id"], "organization_id": org}, {"_id": 0})
    elif role == "parent":
        a = await db.athletes.find_one({"guardian_user_id": user["id"], "organization_id": org}, {"_id": 0})
    else:
        raise HTTPException(status_code=403, detail="Athlete or guardian role required.")
    if not a:
        raise HTTPException(status_code=404, detail="No athlete profile linked.")
    return await db.awards.find(
        {"athlete_id": a["id"], "organization_id": org, "status": {"$in": ["approved", "pending"]}},
        {"_id": 0}).sort("created_at", -1).to_list(100)
