"""AI-generated player development assessments — Rev5, client memo 15 Aug 2026.

The non-negotiable rule, enforced server-side in every path:
NO incomplete, unsubmitted, unapproved, or draft evaluation ever generates a
player-facing assessment. Generation requires at least one APPROVED evaluation
for the athlete at the event; publication is a second, explicit admin action.

Chain (evaluation statuses already exist upstream):
  Evaluation In Progress → Submitted → Under Review → Approved
  → [generate] AI Assessment Generated → (admin Review/Edit/Regenerate/Comment)
  → [publish] Published → visible to athlete/parent, immutable forever.

Published assessments are permanent history: one per (athlete, event), never
overwritten. A future event's evaluations create a NEW assessment.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import ADMIN_ROLES, COACH_ROLES, get_current_user, require_roles
from config import settings
from db import clean, db, log_audit, new_id, now_iso
from mailer import safe_send
from notifications import notify_athlete_users

router = APIRouter(tags=["assessments"])

ASSESSMENT_MODEL_DEFAULT = "gpt-4o-mini"


# ---------------- OpenAI call ----------------

_SYSTEM_PROMPT = (
    "You are a youth baseball player-development analyst writing for 60'6\" Athletics. "
    "You turn verified evaluation data into a development assessment read by the athlete "
    "and their parents. Rules: be encouraging and specific; ground every statement in the "
    "provided data — never invent scores or events; scores use an 8-12 developmental scale "
    "(8 = emerging, 9 = developing, 10 = solid for age group, 11 = strong, 12 = advanced); "
    "a metric state of not_observed/na/dnp/retest means NO conclusion may be drawn from it; "
    "no medical, injury, or nutrition advice; no comparisons to named other athletes; "
    "age-appropriate tone. Respond ONLY with JSON matching exactly: "
    '{"summary": str (3-5 sentences), '
    '"strengths": [{"area": str, "detail": str}] (2-4 items), '
    '"development_priorities": [{"area": str, "why": str, "focus": str}] (2-4 items, '
    "why = what the data showed, focus = concrete practice guidance), "
    '"next_steps": [str] (2-4 short actionable items)}'
)


def _call_openai(payload_data: dict) -> dict:
    """One chat completion → parsed assessment JSON. Raises HTTPException with an
    actionable message on any provider failure — callers never see a bare 500."""
    import httpx

    api_key = settings.openai_api_key
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="AI assessments are not configured yet — add OPENAI_API_KEY to the server environment.")
    try:
        r = httpx.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": settings.openai_model or ASSESSMENT_MODEL_DEFAULT,
                "response_format": {"type": "json_object"},
                "temperature": 0.4,
                "messages": [
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": json.dumps(payload_data, ensure_ascii=False)},
                ],
            },
            timeout=90,
        )
        r.raise_for_status()
        content = r.json()["choices"][0]["message"]["content"]
        out = json.loads(content)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 — provider/network/parse failure
        raise HTTPException(
            status_code=502,
            detail=f"The AI provider could not generate the assessment ({type(e).__name__}). Try again.")
    # minimal shape guard so the UI can rely on the sections existing
    for key, kind in (("summary", str), ("strengths", list),
                      ("development_priorities", list), ("next_steps", list)):
        if not isinstance(out.get(key), kind):
            raise HTTPException(status_code=502, detail="The AI response was malformed. Regenerate to try again.")
    return out


# ---------------- Data gathering (approved evaluations ONLY) ----------------

async def _approved_evaluations(org: str, athlete_id: str, event_id: str) -> list[dict]:
    return await db.evaluations.find(
        {"organization_id": org, "athlete_id": athlete_id, "event_id": event_id,
         "status": "approved"},  # the non-negotiable gate
        {"_id": 0}).to_list(50)


async def _build_model_input(org: str, athlete: dict, event: dict, evals: list[dict]) -> dict:
    """Compact, minimum-necessary data for the model. No contact info, no
    guardian details, no medical/financial fields — first name + baseball data only."""
    template_ids = list({e.get("template_id") for e in evals if e.get("template_id")})
    templates = await db.evaluation_templates.find(
        {"id": {"$in": template_ids}, "organization_id": org}, {"_id": 0}).to_list(50)
    metric_names = {}
    for t in templates:
        for m in t.get("metrics", []):
            metric_names[m["id"]] = m.get("name") or m["id"]

    eval_blocks = []
    for e in evals:
        computed = e.get("computed") or {}
        metrics = []
        for mid, row in (computed.get("metric_results") or {}).items():
            entry = {"metric": metric_names.get(mid, mid)}
            if row.get("state"):
                entry["state"] = row["state"]
            else:
                if row.get("raw") is not None:
                    entry["raw"] = row["raw"]
                if row.get("normalized") is not None:
                    entry["score_8_12"] = row["normalized"]
            if row.get("tags"):
                entry["observation_tags"] = row["tags"]
            metrics.append(entry)
        eval_blocks.append({
            "station": e.get("station_name") or e.get("template_name") or "Evaluation",
            "overall_score": computed.get("overall_score") or computed.get("overall"),
            "category_scores": computed.get("category_scores"),
            "metrics": metrics,
            "evaluator_recommendation": e.get("recommendation"),
        })

    return {
        "athlete": {
            "first_name": athlete.get("first_name"),
            "age_group": athlete.get("age_group"),
            "graduation_year": athlete.get("graduation_year"),
            "primary_position": athlete.get("primary_position"),
            "secondary_positions": athlete.get("secondary_positions") or [],
            "bats": athlete.get("bats"), "throws": athlete.get("throws"),
        },
        "event": {"name": event.get("name"), "date": event.get("date")},
        "approved_evaluations": eval_blocks,
    }


# ---------------- Status derivation for the UI ----------------

def _chain_status(assessment: dict | None, approved_count: int, pending_count: int) -> str:
    """One label matching the client's published status chain."""
    if assessment and assessment.get("status") == "published":
        return "Published"
    if assessment:
        return "Awaiting Final Approval"
    if approved_count > 0:
        return "Approved"  # ready to generate
    if pending_count > 0:
        return "Under Review"
    return "Evaluation In Progress"


# ---------------- Endpoints ----------------

class GenerateBody(BaseModel):
    event_id: str


@router.post("/athletes/{athlete_id}/assessments/generate")
async def generate_assessment(athlete_id: str, body: GenerateBody,
                              user=Depends(require_roles(*ADMIN_ROLES))):
    """Generate (or regenerate, while unpublished) the AI assessment for one
    athlete at one event. Admin/owner only — evaluators and coaches never
    control generation or publication."""
    org = user["organization_id"]
    athlete = await db.athletes.find_one({"id": athlete_id, "organization_id": org}, {"_id": 0})
    if not athlete:
        raise HTTPException(status_code=404, detail="Player not found.")
    event = await db.events.find_one({"id": body.event_id, "organization_id": org}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found.")

    evals = await _approved_evaluations(org, athlete_id, body.event_id)
    if not evals:
        raise HTTPException(
            status_code=409,
            detail="No approved evaluation for this athlete at this event yet. "
                   "Evaluations must be submitted AND approved in the Review Queue "
                   "before an assessment can be generated.")

    existing = await db.assessments.find_one(
        {"organization_id": org, "athlete_id": athlete_id, "event_id": body.event_id},
        {"_id": 0}, sort=[("created_at", -1)])
    if existing and existing.get("status") == "published":
        raise HTTPException(
            status_code=409,
            detail="This event's assessment is already published and is part of the athlete's "
                   "permanent record. A future evaluation event creates a new assessment.")

    content = _call_openai(await _build_model_input(org, athlete, event, evals))
    ts = now_iso()
    if existing:  # regenerate in place, still unpublished
        await db.assessments.update_one(
            {"id": existing["id"], "organization_id": org},
            {"$set": {"content": content, "evaluation_ids": [e["id"] for e in evals],
                      "model": settings.openai_model or ASSESSMENT_MODEL_DEFAULT,
                      "generated_at": ts, "generated_by": user["id"],
                      "edited_at": None, "edited_by": None, "updated_at": ts}})
        doc = {**existing, "content": content, "generated_at": ts, "updated_at": ts}
        action = "assessment_regenerated"
    else:
        doc = {
            "id": new_id(), "organization_id": org, "athlete_id": athlete_id,
            "event_id": body.event_id, "evaluation_ids": [e["id"] for e in evals],
            "status": "generated", "content": content, "final_comment": None,
            "model": settings.openai_model or ASSESSMENT_MODEL_DEFAULT,
            "generated_at": ts, "generated_by": user["id"],
            "edited_at": None, "edited_by": None,
            "published_at": None, "published_by": None,
            "created_at": ts, "updated_at": ts,
        }
        await db.assessments.insert_one({**doc})
        action = "assessment_generated"
    await log_audit(org, user, action, "assessment", doc["id"],
                    {"athlete_id": athlete_id, "event_id": body.event_id,
                     "evaluations": len(evals)})
    return clean(doc)


class AssessmentEditBody(BaseModel):
    content: dict | None = None
    final_comment: str | None = None


@router.patch("/assessments/{assessment_id}")
async def edit_assessment(assessment_id: str, body: AssessmentEditBody,
                          user=Depends(require_roles(*ADMIN_ROLES))):
    org = user["organization_id"]
    a = await db.assessments.find_one({"id": assessment_id, "organization_id": org}, {"_id": 0})
    if not a:
        raise HTTPException(status_code=404, detail="Assessment not found.")
    if a.get("status") == "published":
        raise HTTPException(status_code=409, detail="A published assessment is permanent and cannot be edited.")
    updates = {"updated_at": now_iso()}
    if body.content is not None:
        for key, kind in (("summary", str), ("strengths", list),
                          ("development_priorities", list), ("next_steps", list)):
            if not isinstance(body.content.get(key), kind):
                raise HTTPException(status_code=422, detail=f"content.{key} is missing or has the wrong type.")
        updates["content"] = body.content
        updates["edited_at"] = updates["updated_at"]
        updates["edited_by"] = user["id"]
    if body.final_comment is not None:
        updates["final_comment"] = body.final_comment.strip() or None
    await db.assessments.update_one({"id": assessment_id, "organization_id": org}, {"$set": updates})
    await log_audit(org, user, "assessment_edited", "assessment", assessment_id, None)
    return clean({**a, **updates})


@router.post("/assessments/{assessment_id}/publish")
async def publish_assessment(assessment_id: str, user=Depends(require_roles(*ADMIN_ROLES))):
    """Final admin approval → released to athlete/parent. Irreversible: the
    published assessment joins the athlete's permanent history."""
    org = user["organization_id"]
    a = await db.assessments.find_one({"id": assessment_id, "organization_id": org}, {"_id": 0})
    if not a:
        raise HTTPException(status_code=404, detail="Assessment not found.")
    if a.get("status") == "published":
        raise HTTPException(status_code=409, detail="This assessment is already published.")
    ts = now_iso()
    await db.assessments.update_one(
        {"id": assessment_id, "organization_id": org},
        {"$set": {"status": "published", "published_at": ts, "published_by": user["id"],
                  "updated_at": ts}})
    athlete = await db.athletes.find_one({"id": a["athlete_id"], "organization_id": org}, {"_id": 0})
    event = await db.events.find_one({"id": a["event_id"], "organization_id": org}, {"_id": 0, "name": 1})
    event_name = (event or {}).get("name") or "your evaluation event"
    if athlete:
        await notify_athlete_users(
            athlete, "assessment_published", "Your 60'6\" assessment is ready",
            f"Your development assessment from {event_name} has been released.",
            {"assessment_id": assessment_id})
        # Best-effort email to the family — in-app notification is the source of truth.
        link = f"{settings.app_public_url}/my-id"
        for to in {athlete.get("guardian_email"), athlete.get("email")}:
            if to and "@" in to:
                safe_send(to, "assessment_published", {
                    "name": athlete.get("guardian_name") or athlete.get("first_name") or "there",
                    "athlete_name": f"{athlete.get('first_name', '')} {athlete.get('last_name', '')}".strip(),
                    "org": user.get("organization_name") or "60'6\" Athletics",
                    "event": event_name, "link": link,
                })
    await log_audit(org, user, "assessment_published", "assessment", assessment_id,
                    {"athlete_id": a["athlete_id"], "event_id": a["event_id"]})
    return {"status": "published", "published_at": ts}


@router.delete("/assessments/{assessment_id}")
async def discard_assessment(assessment_id: str, user=Depends(require_roles(*ADMIN_ROLES))):
    """Discard an UNPUBLISHED draft. Published assessments are permanent."""
    org = user["organization_id"]
    a = await db.assessments.find_one({"id": assessment_id, "organization_id": org}, {"_id": 0})
    if not a:
        raise HTTPException(status_code=404, detail="Assessment not found.")
    if a.get("status") == "published":
        raise HTTPException(status_code=409, detail="A published assessment is permanent and cannot be deleted.")
    await db.assessments.delete_one({"id": assessment_id, "organization_id": org})
    await log_audit(org, user, "assessment_discarded", "assessment", assessment_id,
                    {"athlete_id": a["athlete_id"], "event_id": a["event_id"]})
    return {"message": "Draft assessment discarded."}


@router.get("/athletes/{athlete_id}/assessments")
async def list_assessments(athlete_id: str, user=Depends(require_roles(*COACH_ROLES))):
    """Staff view: every event the athlete has evaluations at, with the chain
    status and the assessment (if any). Coaches see; only admins act."""
    org = user["organization_id"]
    if not await db.athletes.find_one({"id": athlete_id, "organization_id": org}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=404, detail="Player not found.")
    evals = await db.evaluations.find(
        {"organization_id": org, "athlete_id": athlete_id, "event_id": {"$ne": None}},
        {"_id": 0, "id": 1, "event_id": 1, "status": 1}).to_list(500)
    assessments = await db.assessments.find(
        {"organization_id": org, "athlete_id": athlete_id}, {"_id": 0}).to_list(100)
    by_event: dict[str, dict] = {}
    for e in evals:
        b = by_event.setdefault(e["event_id"], {"approved": 0, "pending": 0})
        if e.get("status") == "approved":
            b["approved"] += 1
        elif e.get("status") in ("submitted", "draft", "returned"):
            b["pending"] += 1
    amap = {a["event_id"]: a for a in assessments}
    event_ids = sorted(set(by_event) | set(amap))
    events = await db.events.find(
        {"id": {"$in": event_ids}, "organization_id": org},
        {"_id": 0, "id": 1, "name": 1, "date": 1}).to_list(100)
    emap = {e["id"]: e for e in events}
    out = []
    for eid in event_ids:
        counts = by_event.get(eid, {"approved": 0, "pending": 0})
        a = amap.get(eid)
        out.append({
            "event_id": eid,
            "event_name": (emap.get(eid) or {}).get("name") or "Event",
            "event_date": (emap.get(eid) or {}).get("date"),
            "approved_evaluations": counts["approved"],
            "pending_evaluations": counts["pending"],
            "chain_status": _chain_status(a, counts["approved"], counts["pending"]),
            "assessment": clean(a) if a else None,
        })
    out.sort(key=lambda r: r.get("event_date") or "", reverse=True)
    return out


@router.get("/me/assessments")
async def my_assessments(user=Depends(get_current_user)):
    """Athlete/parent view: PUBLISHED assessments only, for their own athlete."""
    org = user["organization_id"]
    role = user.get("role")
    if role == "athlete":
        athlete = await db.athletes.find_one({"user_id": user["id"], "organization_id": org}, {"_id": 0, "id": 1})
    elif role in ("parent", "guardian"):
        athlete = await db.athletes.find_one({"guardian_user_id": user["id"], "organization_id": org}, {"_id": 0, "id": 1})
    else:
        raise HTTPException(status_code=403, detail="Athlete or guardian role required.")
    if not athlete:
        raise HTTPException(status_code=404, detail="No athlete profile linked to this account.")
    docs = await db.assessments.find(
        {"organization_id": org, "athlete_id": athlete["id"], "status": "published"},
        {"_id": 0}).to_list(100)
    event_ids = [d["event_id"] for d in docs]
    events = await db.events.find({"id": {"$in": event_ids}, "organization_id": org},
                                  {"_id": 0, "id": 1, "name": 1, "date": 1}).to_list(100)
    emap = {e["id"]: e for e in events}
    for d in docs:
        d["event_name"] = (emap.get(d["event_id"]) or {}).get("name")
        d["event_date"] = (emap.get(d["event_id"]) or {}).get("date")
    docs.sort(key=lambda d: d.get("published_at") or "", reverse=True)
    return [clean(d) for d in docs]
