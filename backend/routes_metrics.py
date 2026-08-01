"""Verified objective metrics + personal-best milestones."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import COACH_ROLES, STAFF_ROLES, get_current_user, require_roles
from db import clean, db, log_audit, new_id, now_iso
from notifications import notify_athlete_users

router = APIRouter()

METRIC_CATALOG = {
    "exit_velo": {"label": "Exit Velocity", "unit": "mph", "lower_better": False},
    "pitch_velo": {"label": "Pitch Velocity", "unit": "mph", "lower_better": False},
    "throwing_velo": {"label": "Throwing Velocity", "unit": "mph", "lower_better": False},
    "bat_speed": {"label": "Bat Speed", "unit": "mph", "lower_better": False},
    "sixty_yd": {"label": "60-Yard Dash", "unit": "sec", "lower_better": True},
    "pop_time": {"label": "Pop Time", "unit": "sec", "lower_better": True},
    "vertical_jump": {"label": "Vertical Jump", "unit": "in", "lower_better": False},
    "ten_yd": {"label": "10-Yard Split", "unit": "sec", "lower_better": True},
}


class MetricBody(BaseModel):
    athlete_id: str
    metric_key: str
    value: float
    unit: str | None = None
    measured_at: str | None = None
    source: str | None = None


@router.get("/metrics/catalog")
async def metric_catalog(user=Depends(require_roles(*STAFF_ROLES))):
    return [
        {"key": k, "label": v["label"], "unit": v["unit"], "lower_better": v["lower_better"]}
        for k, v in METRIC_CATALOG.items()
    ]


@router.post("/metrics")
async def add_metric(body: MetricBody, user=Depends(require_roles(*COACH_ROLES))):
    meta = METRIC_CATALOG.get(body.metric_key)
    if not meta:
        raise HTTPException(status_code=400, detail=f"Unknown metric_key. Use one of: {', '.join(METRIC_CATALOG)}")
    athlete = await db.athletes.find_one(
        {"id": body.athlete_id, "organization_id": user["organization_id"]}, {"_id": 0})
    if not athlete:
        raise HTTPException(status_code=404, detail="Player not found.")

    prior = await db.verified_metrics.find({
        "athlete_id": body.athlete_id,
        "organization_id": user["organization_id"],
        "metric_key": body.metric_key,
    }, {"_id": 0}).to_list(500)

    lower = meta["lower_better"]
    prev_best = None
    is_pb = True
    if prior:
        vals = [p["value"] for p in prior]
        prev_best = min(vals) if lower else max(vals)
        is_pb = (body.value < prev_best) if lower else (body.value > prev_best)

    unit = body.unit or meta["unit"]
    doc = {
        "id": new_id(),
        "organization_id": user["organization_id"],
        "athlete_id": body.athlete_id,
        "metric_key": body.metric_key,
        "value": float(body.value),
        "unit": unit,
        "verified_by": user["id"],
        "verified_by_name": user.get("full_name"),
        "measured_at": body.measured_at or now_iso()[:10],
        "source": body.source,
        "created_at": now_iso(),
    }
    await db.verified_metrics.insert_one(doc)
    await log_audit(user["organization_id"], user, "metric_verified", "verified_metric", doc["id"],
                    {"athlete_id": body.athlete_id, "metric_key": body.metric_key, "value": body.value})

    milestone = None
    if is_pb:
        label = meta["label"]
        delta = round(body.value - prev_best, 2) if prev_best is not None else None
        milestone = {
            "id": new_id(),
            "organization_id": user["organization_id"],
            "athlete_id": body.athlete_id,
            "kind": "personal_best",
            "metric_key": body.metric_key,
            "value": float(body.value),
            "unit": unit,
            "prev_value": prev_best,
            "delta": delta,
            "label": f"New PB · {label}",
            "detail": f"{body.value} {unit}" + (f" (was {prev_best} {unit})" if prev_best is not None else ""),
            "created_at": now_iso(),
        }
        await db.milestones.insert_one(milestone)
        await notify_athlete_users(
            athlete, "personal_best",
            f"New PB · {label}",
            f"{body.value} {unit} verified by {user.get('full_name')}. That's a new personal best!",
            {"athlete_id": body.athlete_id, "milestone_id": milestone["id"], "metric_key": body.metric_key},
        )
    return {**clean(doc), "is_personal_best": is_pb, "milestone": clean(milestone) if milestone else None}


@router.get("/metrics/athlete/{athlete_id}")
async def list_metrics(athlete_id: str, user=Depends(require_roles(*STAFF_ROLES))):
    a = await db.athletes.find_one({"id": athlete_id, "organization_id": user["organization_id"]})
    if not a:
        raise HTTPException(status_code=404, detail="Player not found.")
    return await db.verified_metrics.find(
        {"athlete_id": athlete_id, "organization_id": user["organization_id"]}, {"_id": 0}
    ).sort("measured_at", -1).to_list(200)


@router.get("/milestones/athlete/{athlete_id}")
async def list_milestones(athlete_id: str, user=Depends(require_roles(*STAFF_ROLES))):
    a = await db.athletes.find_one({"id": athlete_id, "organization_id": user["organization_id"]})
    if not a:
        raise HTTPException(status_code=404, detail="Player not found.")
    return await db.milestones.find(
        {"athlete_id": athlete_id, "organization_id": user["organization_id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)


@router.get("/me/metrics")
async def me_metrics(user=Depends(get_current_user)):
    role = user.get("role")
    org = user["organization_id"]
    if role == "athlete":
        a = await db.athletes.find_one({"user_id": user["id"], "organization_id": org}, {"_id": 0})
    elif role == "parent":
        a = await db.athletes.find_one({"guardian_user_id": user["id"], "organization_id": org}, {"_id": 0})
    else:
        raise HTTPException(status_code=403, detail="Athlete or guardian role required.")
    if not a:
        raise HTTPException(status_code=404, detail="No athlete profile linked to this account.")
    metrics = await db.verified_metrics.find(
        {"athlete_id": a["id"], "organization_id": org}, {"_id": 0}
    ).sort("measured_at", -1).to_list(200)
    milestones = await db.milestones.find(
        {"athlete_id": a["id"], "organization_id": org}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return {"metrics": metrics, "milestones": milestones}
