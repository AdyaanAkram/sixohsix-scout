"""Drill library + rule-based development plans."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from auth import ADMIN_ROLES, COACH_ROLES, STAFF_ROLES, require_roles
from db import clean, db, log_audit, new_id, now_iso
from drill_catalog import DEFAULT_DRILLS
from scoring import aggregate_player_scores

router = APIRouter()


class DrillBody(BaseModel):
    name: str
    category: str = "general"
    description: str | None = None
    positions: list[str] = []
    video_url: str | None = None
    metric_tags: list[str] = []
    active: bool = True


async def ensure_org_drills(org_id: str) -> int:
    """Seed default drills for an org if empty. Returns count inserted."""
    n = await db.drills.count_documents({"organization_id": org_id})
    if n > 0:
        return 0
    docs = []
    for d in DEFAULT_DRILLS:
        docs.append({
            "id": new_id(),
            "organization_id": org_id,
            "key": d["key"],
            "name": d["name"],
            "category": d["category"],
            "description": d["description"],
            "positions": d["positions"],
            "video_url": None,
            "metric_tags": d.get("metric_tags") or [],
            "active": True,
            "created_at": now_iso(),
        })
    if docs:
        await db.drills.insert_many(docs)
    return len(docs)


@router.get("/drills")
async def list_drills(
    position: str | None = None,
    user=Depends(require_roles(*STAFF_ROLES)),
):
    await ensure_org_drills(user["organization_id"])
    q = {"organization_id": user["organization_id"], "active": True}
    if position:
        q["positions"] = position
    return await db.drills.find(q, {"_id": 0}).sort("name", 1).to_list(500)


@router.post("/drills")
async def create_drill(body: DrillBody, user=Depends(require_roles(*ADMIN_ROLES))):
    doc = body.model_dump()
    doc.update({
        "id": new_id(),
        "organization_id": user["organization_id"],
        "key": None,
        "created_at": now_iso(),
    })
    await db.drills.insert_one(doc)
    await log_audit(user["organization_id"], user, "drill_created", "drill", doc["id"])
    return clean(doc)


@router.patch("/drills/{drill_id}")
async def update_drill(drill_id: str, body: DrillBody, user=Depends(require_roles(*ADMIN_ROLES))):
    existing = await db.drills.find_one({"id": drill_id, "organization_id": user["organization_id"]})
    if not existing:
        raise HTTPException(status_code=404, detail="Drill not found.")
    updates = body.model_dump()
    updates["updated_at"] = now_iso()
    await db.drills.update_one({"id": drill_id}, {"$set": updates})
    return {"message": "Drill updated."}


@router.post("/drills/seed-defaults")
async def seed_defaults(user=Depends(require_roles(*ADMIN_ROLES))):
    # Force re-seed only if empty; for refresh wipe org drills then seed
    n = await ensure_org_drills(user["organization_id"])
    total = await db.drills.count_documents({"organization_id": user["organization_id"]})
    return {"inserted": n, "total": total}


def _pick_drills(drills: list, position: str | None, categories: list[str], limit: int = 5) -> list:
    pos = (position or "").upper()
    scored = []
    for d in drills:
        positions = [p.upper() for p in (d.get("positions") or [])]
        score = 0
        if pos and pos in positions:
            score += 3
        if "HIT" in positions and any(c.lower() in ("hitting", "offense", "power") for c in categories):
            score += 2
        if "ATH" in positions:
            score += 1
        if d.get("category") and any(d["category"].lower() in c.lower() for c in categories):
            score += 2
        if score > 0:
            scored.append((score, d))
    scored.sort(key=lambda x: -x[0])
    out = []
    seen = set()
    for _, d in scored:
        if d["id"] in seen:
            continue
        seen.add(d["id"])
        out.append({
            "id": d["id"], "name": d["name"], "category": d["category"],
            "description": d.get("description"), "video_url": d.get("video_url"),
        })
        if len(out) >= limit:
            break
    # fallback: any drills
    if len(out) < limit:
        for d in drills:
            if d["id"] in seen:
                continue
            out.append({
                "id": d["id"], "name": d["name"], "category": d["category"],
                "description": d.get("description"), "video_url": d.get("video_url"),
            })
            if len(out) >= limit:
                break
    return out


@router.post("/athletes/{athlete_id}/development-plan")
async def generate_plan(athlete_id: str, user=Depends(require_roles(*COACH_ROLES))):
    org = user["organization_id"]
    athlete = await db.athletes.find_one({"id": athlete_id, "organization_id": org}, {"_id": 0})
    if not athlete:
        raise HTTPException(status_code=404, detail="Player not found.")
    await ensure_org_drills(org)
    evals = await db.evaluations.find({
        "athlete_id": athlete_id, "organization_id": org,
        "status": {"$in": ["submitted", "approved"]},
    }, {"_id": 0}).to_list(200)
    agg = aggregate_player_scores(evals) if evals else {"category_scores": {}}
    cats = agg.get("category_scores") or {}
    # cats: { name: { score, ... } }
    ranked = sorted(
        [(name, (data.get("score") if isinstance(data, dict) else data) or 0) for name, data in cats.items()],
        key=lambda x: x[1],
    )
    weaknesses = [n for n, _ in ranked[:3]] if ranked else ["fundamentals", "Consistency"]
    strengths = [n for n, _ in ranked[-3:][::-1]] if ranked else ["Work ethic"]
    priorities = [f"Improve {w}" for w in weaknesses[:3]]
    drills_db = await db.drills.find({"organization_id": org, "active": True}, {"_id": 0}).to_list(500)
    drills = _pick_drills(drills_db, athlete.get("primary_position"), weaknesses + strengths)
    weekly = [f"2–3 sessions: focus on {w}" for w in weaknesses[:2]] or ["2 skill sessions this week"]
    monthly = [f"Measurable gain on {w}" for w in weaknesses[:2]] or ["Complete monthly skill block"]
    plan = {
        "id": new_id(),
        "organization_id": org,
        "athlete_id": athlete_id,
        "strengths": strengths,
        "weaknesses": weaknesses,
        "priorities": priorities,
        "drills": drills,
        "weekly_goals": weekly,
        "monthly_goals": monthly,
        "ninety_day_plan": (
            f"90-day focus for {athlete.get('first_name')}: "
            f"build {', '.join(strengths[:2]) or 'strengths'} while closing gaps in "
            f"{', '.join(weaknesses[:2]) or 'priority skills'}."
        ),
        "mental_notes": "Track one process goal per session; film one rep weekly.",
        "generated_by": user["id"],
        "generated_by_name": user.get("full_name"),
        "generator": "rules",
        "created_at": now_iso(),
    }
    await db.development_plans.insert_one(plan)
    await log_audit(org, user, "development_plan_generated", "development_plan", plan["id"],
                    {"athlete_id": athlete_id})
    return clean(plan)


@router.get("/athletes/{athlete_id}/development-plan/latest")
async def latest_plan(athlete_id: str, user=Depends(require_roles(*STAFF_ROLES))):
    plan = await db.development_plans.find_one(
        {"athlete_id": athlete_id, "organization_id": user["organization_id"]},
        {"_id": 0}, sort=[("created_at", -1)])
    if not plan:
        raise HTTPException(status_code=404, detail="No development plan yet.")
    return plan
