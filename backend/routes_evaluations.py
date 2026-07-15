from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import (ADMIN_ROLES, REVIEW_ROLES, STAFF_ROLES, get_current_user,
                  require_roles)
from db import clean, db, log_audit, new_id, now_iso
from scoring import compute_evaluation_scores

router = APIRouter()

METRIC_TYPES = ["rating_5", "rating_10", "numeric", "time", "velocity", "yes_no",
                "multiple_choice", "comment", "observation"]


# ---------------- Templates ----------------

class MetricBody(BaseModel):
    id: str | None = None
    key: str | None = None
    name: str
    description: str | None = None
    category: str
    metric_type: str
    unit: str | None = None
    weight: float = 1
    required: bool = False
    min_value: float | None = None
    max_value: float | None = None
    display_order: int = 0
    higher_is_better: bool = True
    options: list[str] = []


class CategoryBody(BaseModel):
    name: str
    weight: float = 1


class TemplateBody(BaseModel):
    name: str
    description: str | None = None
    age_group: str | None = None
    position: str | None = None
    event_type: str | None = None
    categories: list[CategoryBody] = []
    metrics: list[MetricBody] = []


@router.get("/templates")
async def list_templates(user=Depends(require_roles(*STAFF_ROLES))):
    return await db.evaluation_templates.find({"organization_id": user["organization_id"]}, {"_id": 0}).sort("name", 1).to_list(100)


@router.get("/templates/{template_id}")
async def get_template(template_id: str, user=Depends(require_roles(*STAFF_ROLES))):
    t = await db.evaluation_templates.find_one({"id": template_id, "organization_id": user["organization_id"]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Template not found.")
    return t


@router.post("/templates")
async def create_template(body: TemplateBody, user=Depends(require_roles(*ADMIN_ROLES))):
    doc = body.model_dump()
    for m in doc["metrics"]:
        if not m.get("id"):
            m["id"] = new_id()
        if m["metric_type"] not in METRIC_TYPES:
            raise HTTPException(status_code=400, detail=f"Invalid metric type: {m['metric_type']}")
    doc.update({"id": new_id(), "organization_id": user["organization_id"],
                "created_by": user["id"], "created_at": now_iso(), "updated_at": now_iso()})
    await db.evaluation_templates.insert_one(doc)
    await log_audit(user["organization_id"], user, "template_created", "template", doc["id"], {"name": body.name})
    return clean(doc)


@router.put("/templates/{template_id}")
async def update_template(template_id: str, body: TemplateBody, user=Depends(require_roles(*ADMIN_ROLES))):
    t = await db.evaluation_templates.find_one({"id": template_id, "organization_id": user["organization_id"]})
    if not t:
        raise HTTPException(status_code=404, detail="Template not found.")
    doc = body.model_dump()
    for m in doc["metrics"]:
        if not m.get("id"):
            m["id"] = new_id()
    doc["updated_at"] = now_iso()
    await db.evaluation_templates.update_one({"id": template_id}, {"$set": doc})
    await log_audit(user["organization_id"], user, "template_updated", "template", template_id, {"name": body.name})
    return {"message": "Template updated."}


@router.delete("/templates/{template_id}")
async def delete_template(template_id: str, user=Depends(require_roles(*ADMIN_ROLES))):
    in_use = await db.stations.find_one({"template_id": template_id})
    if in_use:
        raise HTTPException(status_code=400, detail="Template is in use by a station and cannot be deleted.")
    await db.evaluation_templates.delete_one({"id": template_id, "organization_id": user["organization_id"]})
    return {"message": "Template deleted."}


# ---------------- Benchmarks ----------------

class BenchmarkBody(BaseModel):
    metric_key: str
    age_group: str | None = None
    position: str | None = None
    unit: str | None = None
    higher_is_better: bool = True
    floor_value: float
    elite_value: float


@router.get("/benchmarks")
async def list_benchmarks(user=Depends(require_roles(*STAFF_ROLES))):
    return await db.metric_benchmarks.find({"organization_id": user["organization_id"]}, {"_id": 0}).to_list(500)


@router.post("/benchmarks")
async def create_benchmark(body: BenchmarkBody, user=Depends(require_roles(*ADMIN_ROLES))):
    doc = body.model_dump()
    doc.update({"id": new_id(), "organization_id": user["organization_id"], "created_at": now_iso()})
    await db.metric_benchmarks.insert_one(doc)
    return clean(doc)


# ---------------- Evaluator assignments (my view) ----------------

async def _assignment_with_context(a, org_id):
    event = await db.events.find_one({"id": a["event_id"]}, {"_id": 0})
    station = await db.stations.find_one({"id": a["station_id"]}, {"_id": 0})
    groups = await db.event_groups.find({"id": {"$in": a.get("group_ids") or []}}, {"_id": 0}).to_list(20)
    template = None
    if station and station.get("template_id"):
        template = await db.evaluation_templates.find_one({"id": station["template_id"]}, {"_id": 0})
    # progress
    group_ids = a.get("group_ids") or []
    q = {"event_id": a["event_id"], "status": "checked_in"}
    if group_ids:
        q["group_id"] = {"$in": group_ids}
    expected = await db.event_athletes.count_documents(q)
    done = await db.evaluations.count_documents({"event_id": a["event_id"], "station_id": a["station_id"], "evaluator_id": a["evaluator_id"], "status": {"$in": ["submitted", "approved"]}})
    return {
        **a, "event": event, "station": station, "groups": groups,
        "template": template, "expected": expected, "completed": done,
        "remaining": max(0, expected - done),
    }


@router.get("/my-assignments")
async def my_assignments(user=Depends(require_roles(*STAFF_ROLES))):
    q = {"organization_id": user["organization_id"]}
    if user["role"] == "evaluator":
        q["evaluator_id"] = user["id"]
    else:
        q["evaluator_id"] = user["id"]
    assignments = await db.evaluator_assignments.find(q, {"_id": 0}).to_list(50)
    return [await _assignment_with_context(a, user["organization_id"]) for a in assignments]


async def _check_assignment_access(user, assignment_id):
    a = await db.evaluator_assignments.find_one({"id": assignment_id, "organization_id": user["organization_id"]}, {"_id": 0})
    if not a:
        raise HTTPException(status_code=404, detail="Assignment not found.")
    if user["role"] == "evaluator" and a["evaluator_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="This is not your assignment.")
    return a


@router.get("/my-assignments/{assignment_id}/athletes")
async def assignment_athletes(assignment_id: str, user=Depends(require_roles(*STAFF_ROLES))):
    a = await _check_assignment_access(user, assignment_id)
    group_ids = a.get("group_ids") or []
    q = {"event_id": a["event_id"], "status": "checked_in"}
    if group_ids:
        q["group_id"] = {"$in": group_ids}
    entries = await db.event_athletes.find(q, {"_id": 0}).to_list(500)
    athlete_ids = [e["athlete_id"] for e in entries]
    athletes = await db.athletes.find({"id": {"$in": athlete_ids}}, {"_id": 0}).to_list(500)
    amap = {x["id"]: x for x in athletes}
    groups = await db.event_groups.find({"event_id": a["event_id"]}, {"_id": 0}).to_list(50)
    gmap = {g["id"]: g["name"] for g in groups}
    # evaluation status per athlete for this evaluator+station
    evals = await db.evaluations.find({"event_id": a["event_id"], "station_id": a["station_id"], "evaluator_id": a["evaluator_id"]}, {"_id": 0, "athlete_id": 1, "status": 1, "id": 1, "updated_at": 1}).to_list(500)
    emap = {e["athlete_id"]: e for e in evals}
    out = []
    for e in entries:
        ath = amap.get(e["athlete_id"])
        if not ath:
            continue
        ev = emap.get(e["athlete_id"])
        out.append({
            "athlete_id": ath["id"], "first_name": ath.get("first_name"), "last_name": ath.get("last_name"),
            "preferred_name": ath.get("preferred_name"), "photo_url": ath.get("photo_url"),
            "age_group": ath.get("age_group"), "primary_position": ath.get("primary_position"),
            "bib_number": e.get("bib_number"), "group_name": gmap.get(e.get("group_id")),
            "evaluation_id": ev["id"] if ev else None,
            "evaluation_status": ev["status"] if ev else "not_started",
        })
    out.sort(key=lambda x: (x.get("bib_number") or "zzz", x.get("last_name") or ""))
    return out


# ---------------- Evaluations: start / autosave / submit ----------------

class StartBody(BaseModel):
    assignment_id: str
    athlete_id: str


@router.post("/evaluations/start")
async def start_evaluation(body: StartBody, user=Depends(require_roles(*STAFF_ROLES))):
    a = await _check_assignment_access(user, body.assignment_id)
    # verify athlete is in assigned group + checked in
    group_ids = a.get("group_ids") or []
    q = {"event_id": a["event_id"], "athlete_id": body.athlete_id}
    entry = await db.event_athletes.find_one(q)
    if not entry:
        raise HTTPException(status_code=403, detail="This player is not on the event roster.")
    if group_ids and entry.get("group_id") not in group_ids:
        raise HTTPException(status_code=403, detail="This player is not in your assigned group.")
    existing = await db.evaluations.find_one({
        "event_id": a["event_id"], "station_id": a["station_id"],
        "evaluator_id": a["evaluator_id"], "athlete_id": body.athlete_id,
    }, {"_id": 0})
    if existing:
        return existing
    station = await db.stations.find_one({"id": a["station_id"]}, {"_id": 0})
    doc = {
        "id": new_id(), "organization_id": user["organization_id"],
        "event_id": a["event_id"], "station_id": a["station_id"],
        "assignment_id": a["id"], "template_id": station.get("template_id") if station else None,
        "athlete_id": body.athlete_id, "evaluator_id": a["evaluator_id"],
        "evaluator_name": user.get("full_name"),
        "status": "draft", "scores": {}, "comments": {"strengths": "", "development_needs": "", "general": "", "quick_tags": []},
        "computed": None, "client_updated_at": None,
        "created_at": now_iso(), "updated_at": now_iso(),
        "submitted_at": None, "reviewed_by": None, "review_note": None,
    }
    await db.evaluations.insert_one(doc)
    return clean(doc)


class AutosaveBody(BaseModel):
    scores: dict | None = None
    comments: dict | None = None
    client_updated_at: str | None = None


async def _get_own_evaluation(evaluation_id: str, user):
    ev = await db.evaluations.find_one({"id": evaluation_id, "organization_id": user["organization_id"]}, {"_id": 0})
    if not ev:
        raise HTTPException(status_code=404, detail="Evaluation not found.")
    if user["role"] == "evaluator" and ev["evaluator_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="You can only edit your own evaluations.")
    return ev


async def _compute(ev):
    template = await db.evaluation_templates.find_one({"id": ev.get("template_id")}, {"_id": 0}) or {"metrics": [], "categories": []}
    benchmarks = await db.metric_benchmarks.find({"organization_id": ev["organization_id"]}, {"_id": 0}).to_list(500)
    athlete = await db.athletes.find_one({"id": ev["athlete_id"]}, {"_id": 0, "age_group": 1, "primary_position": 1})
    return compute_evaluation_scores(
        template, ev.get("scores") or {}, benchmarks,
        age_group=(athlete or {}).get("age_group"),
        position=(athlete or {}).get("primary_position"))


@router.put("/evaluations/{evaluation_id}/autosave")
async def autosave(evaluation_id: str, body: AutosaveBody, user=Depends(require_roles(*STAFF_ROLES))):
    ev = await _get_own_evaluation(evaluation_id, user)
    if ev["status"] in ("submitted", "approved"):
        raise HTTPException(status_code=409, detail="This evaluation has been submitted and is locked.")
    # idempotent sync: ignore stale offline payloads
    if body.client_updated_at and ev.get("client_updated_at") and body.client_updated_at < ev["client_updated_at"]:
        return {"status": "stale_ignored", "updated_at": ev["updated_at"], "evaluation_id": evaluation_id}
    updates = {"updated_at": now_iso()}
    if body.scores is not None:
        updates["scores"] = body.scores
    if body.comments is not None:
        updates["comments"] = body.comments
    if body.client_updated_at:
        updates["client_updated_at"] = body.client_updated_at
    await db.evaluations.update_one({"id": evaluation_id}, {"$set": updates})
    ev.update(updates)
    computed = await _compute(ev)
    await db.evaluations.update_one({"id": evaluation_id}, {"$set": {"computed": computed}})
    return {"status": "saved", "updated_at": updates["updated_at"], "computed": computed, "evaluation_id": evaluation_id}


@router.get("/evaluations/{evaluation_id}")
async def get_evaluation(evaluation_id: str, user=Depends(require_roles(*STAFF_ROLES))):
    ev = await db.evaluations.find_one({"id": evaluation_id, "organization_id": user["organization_id"]}, {"_id": 0})
    if not ev:
        raise HTTPException(status_code=404, detail="Evaluation not found.")
    if user["role"] == "evaluator" and ev["evaluator_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="You can only view your own evaluations.")
    template = await db.evaluation_templates.find_one({"id": ev.get("template_id")}, {"_id": 0})
    athlete = await db.athletes.find_one({"id": ev["athlete_id"]}, {"_id": 0, "guardian_name": 0, "guardian_email": 0, "guardian_phone": 0, "emergency_contact": 0})
    entry = await db.event_athletes.find_one({"event_id": ev["event_id"], "athlete_id": ev["athlete_id"]}, {"_id": 0, "bib_number": 1, "group_id": 1})
    station = await db.stations.find_one({"id": ev["station_id"]}, {"_id": 0, "name": 1})
    event = await db.events.find_one({"id": ev["event_id"]}, {"_id": 0, "name": 1})
    return {**ev, "template": template, "athlete": athlete,
            "bib_number": (entry or {}).get("bib_number"),
            "station_name": (station or {}).get("name"), "event_name": (event or {}).get("name")}


@router.post("/evaluations/{evaluation_id}/submit")
async def submit_evaluation(evaluation_id: str, user=Depends(require_roles(*STAFF_ROLES))):
    ev = await _get_own_evaluation(evaluation_id, user)
    if ev["status"] in ("submitted", "approved"):
        raise HTTPException(status_code=409, detail="This evaluation was already submitted.")
    # validate required metrics
    template = await db.evaluation_templates.find_one({"id": ev.get("template_id")}, {"_id": 0}) or {"metrics": []}
    scores = ev.get("scores") or {}
    missing = []
    for m in template.get("metrics", []):
        if m.get("required") and m.get("metric_type") not in ("comment", "observation"):
            entry = scores.get(m["id"]) or {}
            if entry.get("not_observed"):
                continue
            if entry.get("value") in (None, ""):
                missing.append(m["name"])
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required metrics: {', '.join(missing)}")
    computed = await _compute(ev)
    ts = now_iso()
    await db.evaluations.update_one({"id": evaluation_id}, {"$set": {
        "status": "submitted", "submitted_at": ts, "updated_at": ts, "computed": computed}})
    await log_audit(user["organization_id"], user, "evaluation_submitted", "evaluation", evaluation_id, {"athlete_id": ev["athlete_id"]})
    return {"status": "submitted", "submitted_at": ts, "computed": computed}


@router.get("/my-evaluations")
async def my_evaluations(user=Depends(require_roles(*STAFF_ROLES))):
    evals = await db.evaluations.find({"evaluator_id": user["id"], "organization_id": user["organization_id"]}, {"_id": 0}).sort("updated_at", -1).to_list(200)
    out = []
    for ev in evals:
        athlete = await db.athletes.find_one({"id": ev["athlete_id"]}, {"_id": 0, "first_name": 1, "last_name": 1, "age_group": 1, "photo_url": 1})
        station = await db.stations.find_one({"id": ev["station_id"]}, {"_id": 0, "name": 1})
        out.append({**ev, "athlete": athlete, "station_name": (station or {}).get("name")})
    return out


# ---------------- Head Scout review ----------------

@router.get("/review/queue")
async def review_queue(event_id: str | None = None, user=Depends(require_roles(*REVIEW_ROLES))):
    q = {"organization_id": user["organization_id"], "status": {"$in": ["submitted", "approved", "returned"]}}
    if event_id:
        q["event_id"] = event_id
    evals = await db.evaluations.find(q, {"_id": 0}).sort("submitted_at", -1).to_list(500)
    out = []
    for ev in evals:
        athlete = await db.athletes.find_one({"id": ev["athlete_id"]}, {"_id": 0, "first_name": 1, "last_name": 1, "age_group": 1, "primary_position": 1, "photo_url": 1})
        station = await db.stations.find_one({"id": ev["station_id"]}, {"_id": 0, "name": 1})
        event = await db.events.find_one({"id": ev["event_id"]}, {"_id": 0, "name": 1})
        out.append({**ev, "athlete": athlete, "station_name": (station or {}).get("name"), "event_name": (event or {}).get("name")})
    return out


class ReviewBody(BaseModel):
    note: str | None = None


@router.post("/evaluations/{evaluation_id}/approve")
async def approve_evaluation(evaluation_id: str, body: ReviewBody, user=Depends(require_roles(*REVIEW_ROLES))):
    ev = await db.evaluations.find_one({"id": evaluation_id, "organization_id": user["organization_id"]})
    if not ev:
        raise HTTPException(status_code=404, detail="Evaluation not found.")
    if ev["status"] != "submitted":
        raise HTTPException(status_code=400, detail="Only submitted evaluations can be approved.")
    await db.evaluations.update_one({"id": evaluation_id}, {"$set": {
        "status": "approved", "reviewed_by": user["id"], "reviewed_by_name": user.get("full_name"),
        "review_note": body.note, "reviewed_at": now_iso(), "updated_at": now_iso()}})
    await log_audit(user["organization_id"], user, "evaluation_approved", "evaluation", evaluation_id, {"note": body.note})
    return {"message": "Evaluation approved."}


@router.post("/evaluations/{evaluation_id}/return")
async def return_evaluation(evaluation_id: str, body: ReviewBody, user=Depends(require_roles(*REVIEW_ROLES))):
    ev = await db.evaluations.find_one({"id": evaluation_id, "organization_id": user["organization_id"]})
    if not ev:
        raise HTTPException(status_code=404, detail="Evaluation not found.")
    if ev["status"] not in ("submitted", "approved"):
        raise HTTPException(status_code=400, detail="Only submitted evaluations can be returned.")
    await db.evaluations.update_one({"id": evaluation_id}, {"$set": {
        "status": "draft", "returned": True, "review_note": body.note,
        "reviewed_by": user["id"], "reviewed_by_name": user.get("full_name"),
        "reviewed_at": now_iso(), "updated_at": now_iso()}})
    await log_audit(user["organization_id"], user, "evaluation_returned", "evaluation", evaluation_id, {"note": body.note})
    return {"message": "Evaluation returned to the evaluator for revision."}


# admin-authorized revision of a locked evaluation (audit recorded)
@router.post("/evaluations/{evaluation_id}/unlock")
async def unlock_evaluation(evaluation_id: str, body: ReviewBody, user=Depends(require_roles(*ADMIN_ROLES, "head_scout"))):
    ev = await db.evaluations.find_one({"id": evaluation_id, "organization_id": user["organization_id"]})
    if not ev:
        raise HTTPException(status_code=404, detail="Evaluation not found.")
    await db.evaluations.update_one({"id": evaluation_id}, {"$set": {"status": "draft", "updated_at": now_iso()}})
    await log_audit(user["organization_id"], user, "evaluation_unlocked", "evaluation", evaluation_id, {"reason": body.note or "authorized revision"})
    return {"message": "Evaluation unlocked for authorized revision. This action was recorded in the audit log."}
