from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from auth import (ADMIN_ROLES, REVIEW_ROLES, STAFF_ROLES,
                  active_assignment_filter, get_current_user, require_roles)
from db import clean, db, log_audit, new_id, now_iso
from positions import (AGE_BANDS, POSITION_TAXONOMY, normalize_position,
                       resolve_template, validate_positions)
from routes_metrics import METRIC_CATALOG
from routes_players import restrict_guardian
from scoring import aggregate_player_scores, compute_evaluation_scores

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
    display_order: int = 0


class TemplateBody(BaseModel):
    name: str
    description: str | None = None
    age_group: str | None = None
    position: str | None = None  # legacy single-position hint; prefer applies_to_positions
    event_type: str | None = None
    categories: list[CategoryBody] = []
    metrics: list[MetricBody] = []
    applies_to_positions: list[str] = Field(default_factory=list)
    is_default: bool = False


def validate_age_group(age_group: str | None) -> str | None:
    if age_group in (None, ""):
        return None
    for band in AGE_BANDS:
        if str(age_group).strip().lower() == band.lower():
            return band
    raise HTTPException(
        status_code=422,
        detail=f"Unknown age band: {age_group}. Allowed: {', '.join(AGE_BANDS)}")


def _apply_display_order(items: list[dict]) -> list[dict]:
    """Sort by the admin-supplied display_order, then renumber sequentially so
    reorder/add/remove always round-trips to a dense, stable ordering."""
    ordered = sorted(enumerate(items), key=lambda p: (int(p[1].get("display_order") or 0), p[0]))
    out = []
    for idx, (_, item) in enumerate(ordered):
        item["display_order"] = idx
        out.append(item)
    return out


def _prepare_template_doc(body: TemplateBody) -> dict:
    doc = body.model_dump()
    try:
        doc["applies_to_positions"] = validate_positions(doc.get("applies_to_positions") or [])
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    doc["age_group"] = validate_age_group(doc.get("age_group"))
    if doc["applies_to_positions"] and not doc.get("position"):
        doc["position"] = doc["applies_to_positions"][0]
    for m in doc["metrics"]:
        if not m.get("id"):
            m["id"] = new_id()
        if m["metric_type"] not in METRIC_TYPES:
            raise HTTPException(status_code=400, detail=f"Invalid metric type: {m['metric_type']}")
    names = [c["name"] for c in doc["categories"]]
    if len(names) != len(set(names)):
        raise HTTPException(status_code=422, detail="Category names must be unique within a template.")
    doc["categories"] = _apply_display_order(doc["categories"])
    doc["metrics"] = _apply_display_order(doc["metrics"])
    return doc


async def _enforce_single_default(org_id: str, template_id: str | None = None):
    q = {"organization_id": org_id, "is_default": True}
    if template_id:
        q["id"] = {"$ne": template_id}
    await db.evaluation_templates.update_many(q, {"$set": {"is_default": False}})


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
    doc = _prepare_template_doc(body)
    doc.update({
        "id": new_id(),
        "organization_id": user["organization_id"],
        "template_version": 1,
        "created_by": user["id"],
        "created_at": now_iso(),
        "updated_at": now_iso(),
    })
    if doc.get("is_default"):
        await _enforce_single_default(user["organization_id"])
    await db.evaluation_templates.insert_one(doc)
    await log_audit(user["organization_id"], user, "template_created", "template", doc["id"], {"name": body.name})
    return clean(doc)


@router.put("/templates/{template_id}")
async def update_template(template_id: str, body: TemplateBody, user=Depends(require_roles(*ADMIN_ROLES))):
    t = await db.evaluation_templates.find_one({"id": template_id, "organization_id": user["organization_id"]})
    if not t:
        raise HTTPException(status_code=404, detail="Template not found.")
    doc = _prepare_template_doc(body)
    doc["updated_at"] = now_iso()
    doc["template_version"] = int(t.get("template_version") or 1) + 1
    if doc.get("is_default"):
        await _enforce_single_default(user["organization_id"], template_id=template_id)
    await db.evaluation_templates.update_one(
        {"id": template_id, "organization_id": user["organization_id"]}, {"$set": doc})
    await log_audit(user["organization_id"], user, "template_updated", "template", template_id, {"name": body.name})
    return {"message": "Template updated.", "template_version": doc["template_version"]}


class TemplateOrderBody(BaseModel):
    category_names: list[str] = Field(default_factory=list)
    metric_ids: list[str] = Field(default_factory=list)


@router.put("/templates/{template_id}/order")
async def reorder_template(template_id: str, body: TemplateOrderBody, user=Depends(require_roles(*ADMIN_ROLES))):
    """Reorder categories and/or metrics without resending the whole template."""
    t = await db.evaluation_templates.find_one(
        {"id": template_id, "organization_id": user["organization_id"]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Template not found.")

    categories = t.get("categories") or []
    metrics = t.get("metrics") or []
    updates = {"updated_at": now_iso()}

    if body.category_names:
        known = {c["name"] for c in categories}
        unknown = [n for n in body.category_names if n not in known]
        if unknown:
            raise HTTPException(status_code=422, detail=f"Unknown categories: {', '.join(unknown)}")
        rank = {n: i for i, n in enumerate(body.category_names)}
        for c in categories:
            c["display_order"] = rank.get(c["name"], len(rank))
        updates["categories"] = _apply_display_order(categories)

    if body.metric_ids:
        known = {m["id"] for m in metrics if m.get("id")}
        unknown = [m for m in body.metric_ids if m not in known]
        if unknown:
            raise HTTPException(status_code=422, detail=f"Unknown metrics: {', '.join(unknown)}")
        rank = {m: i for i, m in enumerate(body.metric_ids)}
        for m in metrics:
            m["display_order"] = rank.get(m.get("id"), len(rank))
        updates["metrics"] = _apply_display_order(metrics)

    if len(updates) == 1:
        raise HTTPException(status_code=400, detail="Provide category_names and/or metric_ids to reorder.")

    # Ordering is presentational, so template_version is left alone: bumping it would
    # make already-submitted evaluations look like they used a superseded template.
    await db.evaluation_templates.update_one(
        {"id": template_id, "organization_id": user["organization_id"]}, {"$set": updates})
    await log_audit(user["organization_id"], user, "template_reordered", "template", template_id,
                    {"categories": bool(body.category_names), "metrics": bool(body.metric_ids)})
    return {"message": "Template order updated.",
            "categories": updates.get("categories", categories),
            "metrics": updates.get("metrics", metrics)}


@router.delete("/templates/{template_id}")
async def delete_template(template_id: str, user=Depends(require_roles(*ADMIN_ROLES))):
    in_use = await db.stations.find_one({
        "template_id": template_id, "organization_id": user["organization_id"]})
    if in_use:
        raise HTTPException(status_code=400, detail="Template is in use by a station and cannot be deleted.")
    res = await db.evaluation_templates.delete_one(
        {"id": template_id, "organization_id": user["organization_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Template not found.")
    await log_audit(user["organization_id"], user, "template_deleted", "template", template_id)
    return {"message": "Template deleted."}


@router.get("/positions")
async def list_positions(user=Depends(require_roles(*STAFF_ROLES))):
    return {"positions": POSITION_TAXONOMY}


@router.get("/age-bands")
async def list_age_bands(user=Depends(require_roles(*STAFF_ROLES))):
    return {"age_bands": list(AGE_BANDS)}


# ---------------- Position-based template resolution ----------------

async def _assert_station_assignment(user, station_id: str, event_id: str):
    org = user["organization_id"]
    station = await db.stations.find_one(
        {"id": station_id, "event_id": event_id, "organization_id": org}, {"_id": 0})
    if not station:
        raise HTTPException(status_code=404, detail="Station not found.")
    event = await db.events.find_one({"id": event_id, "organization_id": org}, {"_id": 0, "id": 1})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found.")
    if user["role"] == "evaluator":
        a = await db.evaluator_assignments.find_one({
            "organization_id": org, "event_id": event_id,
            "station_id": station_id, "evaluator_id": user["id"],
            **active_assignment_filter(),
        }, {"_id": 0})
        if not a:
            raise HTTPException(status_code=403, detail="You are not assigned to this station, or your assignment has ended.")
        return station, a
    a = await db.evaluator_assignments.find_one({
        "organization_id": org, "event_id": event_id, "evaluator_id": user["id"],
        **active_assignment_filter(),
    }, {"_id": 0})
    if not a and user["role"] not in ADMIN_ROLES + ("head_scout", "coach"):
        raise HTTPException(status_code=403, detail="You are not assigned to this event.")
    return station, a


async def _resolve_for_athlete(*, org_id: str, athlete: dict, station: dict, position_override: str | None = None):
    position = normalize_position(position_override) or normalize_position(athlete.get("primary_position"))
    templates = await db.evaluation_templates.find({"organization_id": org_id}, {"_id": 0}).to_list(200)
    template, reason = resolve_template(
        templates,
        position=position,
        station_template_id=station.get("template_id"),
        age_group=athlete.get("age_group"),
    )
    if not template:
        name = f"{athlete.get('first_name', '')} {athlete.get('last_name', '')}".strip() or athlete.get("id")
        raise HTTPException(
            status_code=422,
            detail=(
                f"No evaluation template found for {name} "
                f"(position={position or 'unknown'}, age={athlete.get('age_group') or 'unknown'}). "
                "Assign a position template, a station template, or an org default."
            ),
        )
    return template, reason, position


@router.get("/evaluations/template-for")
async def template_for(
    athlete_id: str = Query(...),
    station_id: str = Query(...),
    event_id: str = Query(...),
    position: str | None = Query(None, description="Evaluate-as position override"),
    user=Depends(require_roles(*STAFF_ROLES)),
):
    station, _ = await _assert_station_assignment(user, station_id, event_id)
    athlete = await db.athletes.find_one(
        {"id": athlete_id, "organization_id": user["organization_id"]}, {"_id": 0})
    if not athlete:
        raise HTTPException(status_code=404, detail="Player not found.")
    entry = await db.event_athletes.find_one({
        "event_id": event_id, "athlete_id": athlete_id,
        "organization_id": user["organization_id"],
    })
    if not entry:
        raise HTTPException(status_code=403, detail="This player is not on the event roster.")

    if position:
        try:
            validate_positions([position])
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))

    template, reason, resolved_pos = await _resolve_for_athlete(
        org_id=user["organization_id"], athlete=athlete, station=station, position_override=position)
    return {
        "template": template,
        "resolution_reason": reason,
        "resolved_position": resolved_pos,
        "athlete_primary_position": athlete.get("primary_position"),
        "evaluated_as_position": normalize_position(position) if position else None,
        "station_id": station_id,
        "event_id": event_id,
        "athlete_id": athlete_id,
    }


@router.get("/evaluations/templates-for-station")
async def templates_for_station(
    station_id: str = Query(...),
    event_id: str = Query(...),
    user=Depends(require_roles(*STAFF_ROLES)),
):
    """Prefetch every org template for offline resolution at this station."""
    station, _ = await _assert_station_assignment(user, station_id, event_id)
    templates = await db.evaluation_templates.find(
        {"organization_id": user["organization_id"]}, {"_id": 0}).to_list(200)
    return {
        "station_id": station_id,
        "event_id": event_id,
        "station_template_id": station.get("template_id"),
        "positions": POSITION_TAXONOMY,
        "templates": templates,
    }


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
    event = await db.events.find_one({"id": a["event_id"], "organization_id": org_id}, {"_id": 0})
    station = await db.stations.find_one({"id": a["station_id"], "organization_id": org_id}, {"_id": 0})
    groups = await db.event_groups.find(
        {"id": {"$in": a.get("group_ids") or []}, "organization_id": org_id}, {"_id": 0}).to_list(20)
    template = None
    if station and station.get("template_id"):
        template = await db.evaluation_templates.find_one(
            {"id": station["template_id"], "organization_id": org_id}, {"_id": 0})
    group_ids = a.get("group_ids") or []
    q = {"event_id": a["event_id"], "status": "checked_in", "organization_id": org_id}
    if group_ids:
        q["group_id"] = {"$in": group_ids}
    expected = await db.event_athletes.count_documents(q)
    done = await db.evaluations.count_documents({
        "event_id": a["event_id"], "station_id": a["station_id"],
        "evaluator_id": a["evaluator_id"], "organization_id": org_id,
        "status": {"$in": ["submitted", "approved"]},
    })
    return {
        **a, "event": event, "station": station, "groups": groups,
        "template": template, "expected": expected, "completed": done,
        "remaining": max(0, expected - done),
    }


@router.get("/my-assignments")
async def my_assignments(user=Depends(require_roles(*STAFF_ROLES))):
    q = {"organization_id": user["organization_id"], "evaluator_id": user["id"],
         **active_assignment_filter()}
    assignments = await db.evaluator_assignments.find(q, {"_id": 0}).to_list(50)
    return [await _assignment_with_context(a, user["organization_id"]) for a in assignments]


async def _check_assignment_access(user, assignment_id):
    org = user["organization_id"]
    a = await db.evaluator_assignments.find_one(
        {"id": assignment_id, "organization_id": org, **active_assignment_filter()}, {"_id": 0})
    if not a:
        exists = await db.evaluator_assignments.find_one(
            {"id": assignment_id, "organization_id": org}, {"_id": 0, "id": 1})
        if exists:
            raise HTTPException(status_code=403, detail="This assignment has been revoked or has expired.")
        raise HTTPException(status_code=404, detail="Assignment not found.")
    if user["role"] == "evaluator" and a["evaluator_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="This is not your assignment.")
    return a


@router.get("/my-assignments/{assignment_id}/athletes")
async def assignment_athletes(assignment_id: str, user=Depends(require_roles(*STAFF_ROLES))):
    a = await _check_assignment_access(user, assignment_id)
    org = user["organization_id"]
    group_ids = a.get("group_ids") or []
    q = {"event_id": a["event_id"], "status": "checked_in", "organization_id": org}
    if group_ids:
        q["group_id"] = {"$in": group_ids}
    entries = await db.event_athletes.find(q, {"_id": 0}).to_list(500)
    athlete_ids = [e["athlete_id"] for e in entries]
    athletes = await db.athletes.find(
        {"id": {"$in": athlete_ids}, "organization_id": org}, {"_id": 0}).to_list(500)
    amap = {x["id"]: x for x in athletes}
    groups = await db.event_groups.find({"event_id": a["event_id"], "organization_id": org}, {"_id": 0}).to_list(50)
    gmap = {g["id"]: g["name"] for g in groups}
    evals = await db.evaluations.find({
        "event_id": a["event_id"], "station_id": a["station_id"],
        "evaluator_id": a["evaluator_id"], "organization_id": org,
    }, {"_id": 0, "athlete_id": 1, "status": 1, "id": 1, "updated_at": 1, "returned": 1}).to_list(500)
    emap = {e["athlete_id"]: e for e in evals}
    out = []
    for e in entries:
        ath = amap.get(e["athlete_id"])
        if not ath:
            continue
        ev = emap.get(e["athlete_id"])
        status = "not_started"
        if ev:
            # Returned-for-revision is stored as draft + returned flag; surface as "returned" for UI.
            status = "returned" if (ev.get("returned") and ev.get("status") == "draft") else ev["status"]
        out.append({
            "athlete_id": ath["id"], "first_name": ath.get("first_name"), "last_name": ath.get("last_name"),
            "preferred_name": ath.get("preferred_name"), "photo_url": ath.get("photo_url"),
            "age_group": ath.get("age_group"), "primary_position": ath.get("primary_position"),
            "bib_number": e.get("bib_number"), "group_name": gmap.get(e.get("group_id")),
            "evaluation_id": ev["id"] if ev else None,
            "evaluation_status": status,
        })
    out.sort(key=lambda x: (x.get("bib_number") or "zzz", x.get("last_name") or ""))
    return out


# ---------------- Evaluations: start / autosave / submit ----------------

class StartBody(BaseModel):
    assignment_id: str
    athlete_id: str
    evaluated_as_position: str | None = None
    allow_unassigned: bool = False


@router.post("/evaluations/start")
async def start_evaluation(body: StartBody, user=Depends(require_roles(*STAFF_ROLES))):
    a = await _check_assignment_access(user, body.assignment_id)
    org = user["organization_id"]
    group_ids = a.get("group_ids") or []
    entry = await db.event_athletes.find_one({
        "event_id": a["event_id"], "athlete_id": body.athlete_id, "organization_id": org})
    if not entry:
        raise HTTPException(status_code=403, detail="This player is not on the event roster.")

    unassigned_handoff = False
    if group_ids and entry.get("group_id") not in group_ids:
        if body.allow_unassigned:
            unassigned_handoff = True
        else:
            raise HTTPException(status_code=403, detail="This player is not in your assigned group.")

    existing = await db.evaluations.find_one({
        "event_id": a["event_id"], "station_id": a["station_id"],
        "evaluator_id": a["evaluator_id"], "athlete_id": body.athlete_id,
        "organization_id": org,
    }, {"_id": 0})
    if existing:
        return existing

    station = await db.stations.find_one({"id": a["station_id"], "organization_id": org}, {"_id": 0})
    if not station:
        raise HTTPException(status_code=404, detail="Station not found.")

    athlete = await db.athletes.find_one({"id": body.athlete_id, "organization_id": org}, {"_id": 0})
    if not athlete:
        raise HTTPException(status_code=404, detail="Player not found.")

    override = None
    if body.evaluated_as_position:
        try:
            override = validate_positions([body.evaluated_as_position])[0]
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))

    template, reason, resolved_pos = await _resolve_for_athlete(
        org_id=org, athlete=athlete, station=station, position_override=override)

    doc = {
        "id": new_id(), "organization_id": org,
        "event_id": a["event_id"], "station_id": a["station_id"],
        "assignment_id": a["id"],
        "template_id": template["id"],
        "template_version": int(template.get("template_version") or 1),
        "template_resolution_reason": reason,
        "athlete_id": body.athlete_id, "evaluator_id": a["evaluator_id"],
        "evaluator_name": user.get("full_name"),
        "evaluated_as_position": override,
        "resolved_position": resolved_pos,
        "status": "draft", "scores": {},
        "comments": {"strengths": "", "development_needs": "", "general": "", "quick_tags": []},
        "recommendation": None, "next_evaluation_date": None,
        "computed": None, "client_updated_at": None,
        "created_at": now_iso(), "updated_at": now_iso(),
        "submitted_at": None, "reviewed_by": None, "review_note": None,
        "started_unassigned": unassigned_handoff,
    }
    await db.evaluations.insert_one(doc)
    action = "evaluation_started_unassigned" if unassigned_handoff else "evaluation_started"
    await log_audit(
        org, user, action, "evaluation", doc["id"],
        {"athlete_id": body.athlete_id, "event_id": a["event_id"],
         "station_id": a["station_id"], "assignment_id": a["id"],
         "template_id": template["id"], "reason": reason})
    return clean(doc)


class AutosaveBody(BaseModel):
    scores: dict | None = None
    comments: dict | None = None
    client_updated_at: str | None = None
    evaluated_as_position: str | None = None
    recommendation: str | None = Field(default=None, max_length=4000)
    next_evaluation_date: str | None = None


def _validate_next_evaluation_date(value: str | None) -> str | None:
    if value in (None, ""):
        return None
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date().isoformat()
    except ValueError:
        raise HTTPException(status_code=422, detail="next_evaluation_date must be a YYYY-MM-DD date.")


async def _get_own_evaluation(evaluation_id: str, user):
    ev = await db.evaluations.find_one({"id": evaluation_id, "organization_id": user["organization_id"]}, {"_id": 0})
    if not ev:
        raise HTTPException(status_code=404, detail="Evaluation not found.")
    if user["role"] == "evaluator" and ev["evaluator_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="You can only edit your own evaluations.")
    return ev


async def _compute(ev):
    org = ev["organization_id"]
    template = await db.evaluation_templates.find_one(
        {"id": ev.get("template_id"), "organization_id": org}, {"_id": 0}) or {"metrics": [], "categories": []}
    benchmarks = await db.metric_benchmarks.find({"organization_id": org}, {"_id": 0}).to_list(500)
    athlete = await db.athletes.find_one(
        {"id": ev["athlete_id"], "organization_id": org},
        {"_id": 0, "age_group": 1, "primary_position": 1})
    pos = ev.get("evaluated_as_position") or (athlete or {}).get("primary_position")
    return compute_evaluation_scores(
        template, ev.get("scores") or {}, benchmarks,
        age_group=(athlete or {}).get("age_group"), position=pos)


@router.put("/evaluations/{evaluation_id}/autosave")
async def autosave(evaluation_id: str, body: AutosaveBody, user=Depends(require_roles(*STAFF_ROLES))):
    ev = await _get_own_evaluation(evaluation_id, user)
    if ev["status"] in ("submitted", "approved"):
        raise HTTPException(status_code=409, detail="This evaluation has been submitted and is locked.")
    if body.client_updated_at and ev.get("client_updated_at") and body.client_updated_at < ev["client_updated_at"]:
        return {"status": "stale_ignored", "updated_at": ev["updated_at"], "evaluation_id": evaluation_id}
    updates = {"updated_at": now_iso()}
    if body.scores is not None:
        updates["scores"] = body.scores
    if body.comments is not None:
        updates["comments"] = body.comments
    if body.client_updated_at:
        updates["client_updated_at"] = body.client_updated_at
    if body.recommendation is not None:
        updates["recommendation"] = body.recommendation.strip() or None
    if body.next_evaluation_date is not None:
        updates["next_evaluation_date"] = _validate_next_evaluation_date(body.next_evaluation_date)
    if body.evaluated_as_position is not None:
        if body.evaluated_as_position == "":
            updates["evaluated_as_position"] = None
        else:
            try:
                updates["evaluated_as_position"] = validate_positions([body.evaluated_as_position])[0]
            except ValueError as e:
                raise HTTPException(status_code=422, detail=str(e))
            if not ev.get("scores"):
                station = await db.stations.find_one(
                    {"id": ev["station_id"], "organization_id": user["organization_id"]}, {"_id": 0})
                athlete = await db.athletes.find_one(
                    {"id": ev["athlete_id"], "organization_id": user["organization_id"]}, {"_id": 0})
                if station and athlete:
                    template, reason, resolved_pos = await _resolve_for_athlete(
                        org_id=user["organization_id"], athlete=athlete, station=station,
                        position_override=updates["evaluated_as_position"])
                    updates["template_id"] = template["id"]
                    updates["template_version"] = int(template.get("template_version") or 1)
                    updates["template_resolution_reason"] = reason
                    updates["resolved_position"] = resolved_pos
    await db.evaluations.update_one(
        {"id": evaluation_id, "organization_id": user["organization_id"]}, {"$set": updates})
    ev.update(updates)
    computed = await _compute(ev)
    await db.evaluations.update_one(
        {"id": evaluation_id, "organization_id": user["organization_id"]}, {"$set": {"computed": computed}})
    return {"status": "saved", "updated_at": updates["updated_at"], "computed": computed, "evaluation_id": evaluation_id}


@router.get("/evaluations/{evaluation_id}")
async def get_evaluation(evaluation_id: str, user=Depends(require_roles(*STAFF_ROLES))):
    org = user["organization_id"]
    ev = await db.evaluations.find_one({"id": evaluation_id, "organization_id": org}, {"_id": 0})
    if not ev:
        raise HTTPException(status_code=404, detail="Evaluation not found.")
    if user["role"] == "evaluator" and ev["evaluator_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="You can only view your own evaluations.")
    template = await db.evaluation_templates.find_one(
        {"id": ev.get("template_id"), "organization_id": org}, {"_id": 0})
    athlete = await db.athletes.find_one({"id": ev["athlete_id"], "organization_id": org}, {"_id": 0})
    if athlete:
        athlete = restrict_guardian(athlete, user["role"])
    entry = await db.event_athletes.find_one(
        {"event_id": ev["event_id"], "athlete_id": ev["athlete_id"], "organization_id": org},
        {"_id": 0, "bib_number": 1, "group_id": 1})
    station = None
    if ev.get("station_id"):
        station = await db.stations.find_one(
            {"id": ev["station_id"], "organization_id": org}, {"_id": 0, "name": 1, "template_id": 1})
    event = await db.events.find_one(
        {"id": ev["event_id"], "organization_id": org}, {"_id": 0, "name": 1})
    return {**ev, "template": template, "athlete": athlete,
            "recommendation": ev.get("recommendation"),
            "next_evaluation_date": ev.get("next_evaluation_date"),
            "bib_number": (entry or {}).get("bib_number"),
            "station_name": (station or {}).get("name"), "event_name": (event or {}).get("name"),
            "station_template_id": (station or {}).get("template_id")}


class SubmitBody(BaseModel):
    recommendation: str | None = Field(default=None, max_length=4000)
    next_evaluation_date: str | None = None


@router.post("/evaluations/{evaluation_id}/submit")
async def submit_evaluation(evaluation_id: str, body: SubmitBody = SubmitBody(), user=Depends(require_roles(*STAFF_ROLES))):
    ev = await _get_own_evaluation(evaluation_id, user)
    if ev["status"] in ("submitted", "approved"):
        raise HTTPException(status_code=409, detail="This evaluation was already submitted.")
    template = await db.evaluation_templates.find_one(
        {"id": ev.get("template_id"), "organization_id": user["organization_id"]},
        {"_id": 0}) or {"metrics": []}
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
    updates = {
        "status": "submitted", "submitted_at": ts, "updated_at": ts, "computed": computed,
        "returned": False,
    }
    if body.recommendation is not None:
        updates["recommendation"] = body.recommendation.strip() or None
    if body.next_evaluation_date is not None:
        updates["next_evaluation_date"] = _validate_next_evaluation_date(body.next_evaluation_date)
    await db.evaluations.update_one(
        {"id": evaluation_id, "organization_id": user["organization_id"]}, {"$set": updates})
    await log_audit(user["organization_id"], user, "evaluation_submitted", "evaluation", evaluation_id,
                    {"athlete_id": ev["athlete_id"],
                     "recommendation_set": bool(updates.get("recommendation")),
                     "next_evaluation_date": updates.get("next_evaluation_date")})
    return {"status": "submitted", "submitted_at": ts, "computed": computed,
            "recommendation": updates.get("recommendation", ev.get("recommendation")),
            "next_evaluation_date": updates.get("next_evaluation_date", ev.get("next_evaluation_date"))}


# ---------------- Evaluation results ----------------

RESULTS_TOP_N = 3
MEASUREMENT_WINDOW_DAYS = 7


def _to_date(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date()
    except ValueError:
        return None


def _metric_rows(template: dict, computed: dict) -> list[dict]:
    results = (computed or {}).get("metric_results") or {}
    rows = []
    for m in sorted(template.get("metrics") or [], key=lambda x: int(x.get("display_order") or 0)):
        r = results.get(m["id"]) or {}
        rows.append({
            "metric_id": m["id"],
            "key": m.get("key"),
            "name": m.get("name"),
            "category": m.get("category"),
            "metric_type": m.get("metric_type"),
            "unit": m.get("unit"),
            "raw": r.get("raw"),
            "normalized": r.get("normalized"),
            "percentile": r.get("percentile"),
            "not_observed": bool(r.get("not_observed")),
        })
    return rows


def _rank_scored_items(category_scores: dict, metric_rows: list[dict]) -> list[dict]:
    """Strengths and development needs are derived from structured scores only —
    the free-text comment blobs are returned verbatim, never parsed."""
    items = [
        {"label": name, "score": data.get("score"), "weight": data.get("weight"),
         "source": "category", "category": name}
        for name, data in (category_scores or {}).items()
        if data.get("score") is not None
    ]
    if len(items) < RESULTS_TOP_N:
        # Thin templates (one or two categories) still owe the UI three talking points.
        items += [
            {"label": r["name"], "score": r["normalized"], "weight": None,
             "source": "metric", "category": r.get("category")}
            for r in metric_rows if r.get("normalized") is not None
        ]
    items.sort(key=lambda i: (-i["score"], i["label"] or ""))
    return items


@router.get("/evaluations/{evaluation_id}/results")
async def evaluation_results(evaluation_id: str, user=Depends(require_roles(*STAFF_ROLES))):
    """Visual-summary-first payload for the evaluation results page: the scores and
    charts lead, the written write-up sits behind 'View Full Evaluation'."""
    org = user["organization_id"]
    ev = await db.evaluations.find_one({"id": evaluation_id, "organization_id": org}, {"_id": 0})
    if not ev:
        raise HTTPException(status_code=404, detail="Evaluation not found.")
    if user["role"] == "evaluator" and ev["evaluator_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="You can only view your own evaluations.")
    if ev.get("status") not in ("submitted", "approved"):
        raise HTTPException(status_code=409, detail="Results are available once the evaluation has been submitted.")

    template = await db.evaluation_templates.find_one(
        {"id": ev.get("template_id"), "organization_id": org}, {"_id": 0}) or {"metrics": [], "categories": []}
    athlete = await db.athletes.find_one({"id": ev["athlete_id"], "organization_id": org}, {"_id": 0})
    if athlete:
        athlete = restrict_guardian(athlete, user["role"])
    athlete = athlete or {}
    station = await db.stations.find_one(
        {"id": ev.get("station_id"), "organization_id": org}, {"_id": 0, "name": 1}) or {}

    # Same master-weighted aggregation the player profile uses, so the number on the
    # results page matches the number on the profile.
    current = aggregate_player_scores([ev])
    overall = current["overall_score"]
    metric_rows = _metric_rows(template, ev.get("computed") or {})

    cat_order = {c["name"]: int(c.get("display_order") or 0)
                 for c in (template.get("categories") or []) if c.get("name")}
    category_scores = [
        {"category": name, "score": data.get("score"), "weight": data.get("weight")}
        for name, data in sorted(
            current["category_scores"].items(),
            key=lambda kv: (cat_order.get(kv[0], len(cat_order)), kv[0]))
    ]

    ranked = _rank_scored_items(current["category_scores"], metric_rows)
    top_strengths = ranked[:RESULTS_TOP_N]
    used = {(i["source"], i["label"]) for i in top_strengths}
    # A category named a top strength must never also be listed as a need.
    top_improvements = [i for i in reversed(ranked) if (i["source"], i["label"]) not in used][:RESULTS_TOP_N]

    history = await db.evaluations.find({
        "athlete_id": ev["athlete_id"], "organization_id": org,
        "status": {"$in": ["submitted", "approved"]},
    }, {"_id": 0}).sort("submitted_at", 1).to_list(500)
    event_ids = sorted({h["event_id"] for h in history if h.get("event_id")})
    events = await db.events.find(
        {"id": {"$in": event_ids}, "organization_id": org},
        {"_id": 0, "id": 1, "name": 1, "date": 1}).to_list(500)
    emap = {e["id"]: e for e in events}

    progress_series = []
    for h in history:
        agg = aggregate_player_scores([h])
        if agg["overall_score"] is None:
            continue
        event = emap.get(h.get("event_id")) or {}
        progress_series.append({
            "evaluation_id": h["id"],
            "date": event.get("date") or (h.get("submitted_at") or "")[:10],
            "event_id": h.get("event_id"),
            "event_name": event.get("name"),
            "overall_score": agg["overall_score"],
        })

    idx = next((i for i, p in enumerate(progress_series) if p["evaluation_id"] == evaluation_id), None)
    previous = progress_series[idx - 1] if idx else None
    previous_overall = previous["overall_score"] if previous else None
    score_change = round(overall - previous_overall, 2) if overall is not None and previous_overall is not None else None

    anchor = _to_date((emap.get(ev.get("event_id")) or {}).get("date")) or _to_date(ev.get("submitted_at"))
    verified = await db.verified_metrics.find(
        {"athlete_id": ev["athlete_id"], "organization_id": org}, {"_id": 0}
    ).sort("measured_at", -1).to_list(200)
    in_window = []
    if anchor:
        lo, hi = anchor - timedelta(days=MEASUREMENT_WINDOW_DAYS), anchor + timedelta(days=MEASUREMENT_WINDOW_DAYS)
        in_window = [m for m in verified
                     if (d := _to_date(m.get("measured_at"))) is not None and lo <= d <= hi]
    window_ids = {m["id"] for m in in_window}
    selected = list(in_window)
    if not selected:
        # No measurement session around this evaluation: fall back to each tool's
        # most recent verified value so the results page still shows the athlete.
        seen = set()
        for m in verified:
            if m.get("metric_key") in seen:
                continue
            seen.add(m.get("metric_key"))
            selected.append(m)
    measurements = []
    for m in selected:
        meta = METRIC_CATALOG.get(m.get("metric_key")) or {}
        measurements.append({
            "metric_key": m.get("metric_key"),
            "label": meta.get("label") or m.get("metric_key"),
            "value": m.get("value"),
            "unit": m.get("unit") or meta.get("unit"),
            "lower_is_better": meta.get("lower_better"),
            "measured_at": m.get("measured_at"),
            "verified_by_name": m.get("verified_by_name"),
            "source": m.get("source"),
            "in_evaluation_window": m["id"] in window_ids,
        })

    comments = ev.get("comments") or {}
    return {
        "evaluation_id": ev["id"],
        "status": ev.get("status"),
        "submitted_at": ev.get("submitted_at"),
        "evaluator_name": ev.get("evaluator_name"),
        "event_id": ev.get("event_id"),
        "event_name": (emap.get(ev.get("event_id")) or {}).get("name"),
        "station_name": station.get("name"),
        "evaluated_as_position": ev.get("evaluated_as_position"),
        "athlete": {
            "id": athlete.get("id"),
            "first_name": athlete.get("first_name"),
            "last_name": athlete.get("last_name"),
            "preferred_name": athlete.get("preferred_name"),
            "photo_url": athlete.get("photo_url"),
            "age_group": athlete.get("age_group"),
            "primary_position": athlete.get("primary_position"),
        },
        "overall_score": overall,
        "previous_overall_score": previous_overall,
        "score_change": score_change,
        "previous_evaluation_id": (previous or {}).get("evaluation_id"),
        "previous_evaluation_date": (previous or {}).get("date"),
        "top_strengths": top_strengths,
        "top_improvements": top_improvements,
        "category_scores": category_scores,
        "progress_series": progress_series,
        "verified_measurements": measurements,
        "recommendation": ev.get("recommendation"),
        "next_evaluation_date": ev.get("next_evaluation_date"),
        "full_evaluation": {
            "strengths": comments.get("strengths") or "",
            "development_needs": comments.get("development_needs") or "",
            "general": comments.get("general") or "",
            "quick_tags": comments.get("quick_tags") or [],
            "review_note": ev.get("review_note"),
            "reviewed_by_name": ev.get("reviewed_by_name"),
            "reviewed_at": ev.get("reviewed_at"),
            "template_id": template.get("id"),
            "template_name": template.get("name"),
            "template_version": ev.get("template_version"),
            "metric_results": metric_rows,
        },
    }


@router.get("/my-evaluations")
async def my_evaluations(user=Depends(require_roles(*STAFF_ROLES))):
    org = user["organization_id"]
    evals = await db.evaluations.find(
        {"evaluator_id": user["id"], "organization_id": org}, {"_id": 0}).sort("updated_at", -1).to_list(200)
    out = []
    for ev in evals:
        athlete = await db.athletes.find_one(
            {"id": ev["athlete_id"], "organization_id": org},
            {"_id": 0, "first_name": 1, "last_name": 1, "age_group": 1, "photo_url": 1, "primary_position": 1})
        station = await db.stations.find_one(
            {"id": ev["station_id"], "organization_id": org}, {"_id": 0, "name": 1})
        out.append({**ev, "athlete": athlete, "station_name": (station or {}).get("name"),
                    "recommendation": ev.get("recommendation"),
                    "next_evaluation_date": ev.get("next_evaluation_date")})
    return out


# ---------------- Head Scout review ----------------

@router.get("/review/queue")
async def review_queue(event_id: str | None = None, user=Depends(require_roles(*REVIEW_ROLES))):
    org = user["organization_id"]
    q = {"organization_id": org, "status": {"$in": ["submitted", "approved", "returned"]}}
    if event_id:
        q["event_id"] = event_id
    evals = await db.evaluations.find(q, {"_id": 0}).sort("submitted_at", -1).to_list(500)
    out = []
    for ev in evals:
        athlete = await db.athletes.find_one(
            {"id": ev["athlete_id"], "organization_id": org},
            {"_id": 0, "first_name": 1, "last_name": 1, "age_group": 1, "primary_position": 1, "photo_url": 1})
        station = await db.stations.find_one(
            {"id": ev["station_id"], "organization_id": org}, {"_id": 0, "name": 1})
        event = await db.events.find_one(
            {"id": ev["event_id"], "organization_id": org}, {"_id": 0, "name": 1})
        out.append({**ev, "athlete": athlete, "station_name": (station or {}).get("name"),
                    "event_name": (event or {}).get("name"),
                    "recommendation": ev.get("recommendation"),
                    "next_evaluation_date": ev.get("next_evaluation_date")})
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
    await db.evaluations.update_one(
        {"id": evaluation_id, "organization_id": user["organization_id"]},
        {"$set": {
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
    await db.evaluations.update_one(
        {"id": evaluation_id, "organization_id": user["organization_id"]},
        {"$set": {
            "status": "draft", "returned": True, "review_note": body.note,
            "reviewed_by": user["id"], "reviewed_by_name": user.get("full_name"),
            "reviewed_at": now_iso(), "updated_at": now_iso()}})
    await log_audit(user["organization_id"], user, "evaluation_returned", "evaluation", evaluation_id, {"note": body.note})
    return {"message": "Evaluation returned to the evaluator for revision."}


@router.post("/evaluations/{evaluation_id}/unlock")
async def unlock_evaluation(evaluation_id: str, body: ReviewBody, user=Depends(require_roles(*ADMIN_ROLES, "head_scout"))):
    ev = await db.evaluations.find_one({"id": evaluation_id, "organization_id": user["organization_id"]})
    if not ev:
        raise HTTPException(status_code=404, detail="Evaluation not found.")
    await db.evaluations.update_one(
        {"id": evaluation_id, "organization_id": user["organization_id"]},
        {"$set": {"status": "draft", "updated_at": now_iso()}})
    await log_audit(user["organization_id"], user, "evaluation_unlocked", "evaluation", evaluation_id, {"reason": body.note or "authorized revision"})
    return {"message": "Evaluation unlocked for authorized revision. This action was recorded in the audit log."}
