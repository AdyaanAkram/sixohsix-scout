"""Athlete self-service: My ID endpoints + age-gated invitations."""
from __future__ import annotations

import os
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from auth import (ADMIN_ROLES, COACH_ROLES, get_current_user, rate_limit,
                  require_roles)
from config import settings
from db import clean, db, log_audit, new_id, now_iso
from mailer import send_template
from routes_media import ALLOWED_IMAGE
from routes_players import restrict_guardian
from scoring import aggregate_player_scores
from storage import media_object_key, storage

router = APIRouter()

ATHLETE_PATCH_WHITELIST = {"bio", "public_enabled"}
INVITE_TTL_DAYS = 14
APP_PUBLIC_URL = settings.app_public_url


def _ensure_public_slug(athlete: dict) -> str:
    if athlete.get("public_slug"):
        return athlete["public_slug"]
    return secrets.token_urlsafe(9).replace("-", "").replace("_", "")[:12]


def _parse_dob(dob: str | None):
    if not dob:
        return None
    try:
        return datetime.strptime(dob[:10], "%Y-%m-%d").date()
    except Exception:
        return None


def athlete_age_years(athlete: dict) -> int | None:
    if athlete.get("age") is not None:
        try:
            return int(athlete["age"])
        except Exception:
            pass
    dob = _parse_dob(athlete.get("date_of_birth"))
    if not dob:
        return None
    today = datetime.now(timezone.utc).date()
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


def resolve_invite_recipient(athlete: dict) -> tuple[str, str, str]:
    """Return (email, template_name, display_name) based on age gating.

    Under 13 → guardian only. Missing DOB → most restrictive (guardian).
    13–17 → athlete email, guardian CC handled by caller.
    18+ → athlete email.
    """
    age = athlete_age_years(athlete)
    guardian = (athlete.get("guardian_email") or "").strip().lower() or None
    athlete_email = (athlete.get("email") or "").strip().lower() or None
    name = f"{athlete.get('first_name', '')} {athlete.get('last_name', '')}".strip() or "Athlete"

    if age is None or age < 13:
        if not guardian:
            raise HTTPException(
                status_code=422,
                detail="Guardian email is required to invite athletes under 13 (or with unknown DOB).",
            )
        return guardian, "guardian_invitation", athlete.get("guardian_name") or "Guardian"

    if age < 18:
        if not athlete_email:
            raise HTTPException(status_code=422, detail="Athlete email is required for ages 13–17.")
        return athlete_email, "athlete_invitation", name

    if not athlete_email:
        raise HTTPException(status_code=422, detail="Athlete email is required.")
    return athlete_email, "athlete_invitation", name


async def _own_athlete(user) -> dict:
    role = user.get("role")
    org = user["organization_id"]
    if role == "athlete":
        a = await db.athletes.find_one(
            {"user_id": user["id"], "organization_id": org}, {"_id": 0})
    elif role == "parent":
        a = await db.athletes.find_one(
            {"guardian_user_id": user["id"], "organization_id": org}, {"_id": 0})
    else:
        raise HTTPException(status_code=403, detail="Athlete or guardian role required.")
    if not a:
        raise HTTPException(status_code=404, detail="No athlete profile linked to this account.")
    return a


# ---------- Staff: invite athlete ----------

@router.post("/athletes/{athlete_id}/invite")
async def invite_athlete(athlete_id: str, user=Depends(require_roles(*ADMIN_ROLES, *COACH_ROLES))):
    rate_limit(f"athlete_invite:{user['organization_id']}", 20, 60)

    athlete = await db.athletes.find_one(
        {"id": athlete_id, "organization_id": user["organization_id"]}, {"_id": 0})
    if not athlete:
        raise HTTPException(status_code=404, detail="Player not found.")
    if athlete.get("user_id"):
        raise HTTPException(status_code=400, detail="This athlete already has a linked account.")

    to_email, template, display_name = resolve_invite_recipient(athlete)
    age = athlete_age_years(athlete)
    role = "parent" if (age is None or age < 13) else "athlete"

    # expire any prior pending invites for this athlete
    await db.invitations.update_many(
        {"athlete_id": athlete_id, "status": "pending", "organization_id": user["organization_id"]},
        {"$set": {"status": "expired"}},
    )

    token = secrets.token_urlsafe(24)
    expires_at = (datetime.now(timezone.utc) + timedelta(days=INVITE_TTL_DAYS)).isoformat()
    inv = {
        "id": new_id(),
        "organization_id": user["organization_id"],
        "email": to_email,
        "full_name": display_name,
        "role": role,
        "athlete_id": athlete_id,
        "token": token,
        "status": "pending",
        "expires_at": expires_at,
        "created_by": user["id"],
        "created_at": now_iso(),
    }
    await db.invitations.insert_one(inv)

    link = f"{APP_PUBLIC_URL}/accept-invitation?token={token}"
    ctx = {
        "name": display_name,
        "org": user.get("organization_name") or "60'6\" Athletics",
        "link": link,
        "athlete_name": f"{athlete.get('first_name', '')} {athlete.get('last_name', '')}".strip(),
    }
    # CC guardian for 13–17
    send_result = send_template(to_email, template, ctx)
    if age is not None and 13 <= age < 18 and athlete.get("guardian_email"):
        g = athlete["guardian_email"].strip().lower()
        if g and g != to_email:
            send_template(g, "guardian_invitation", {**ctx, "name": athlete.get("guardian_name") or "Guardian"})

    await log_audit(
        user["organization_id"], user, "athlete_invite_sent", "invitation", inv["id"],
        {"athlete_id": athlete_id, "role": role, "email": send_result.get("email")})

    # Never return the raw token
    return {
        "sent": True,
        "email": send_result.get("email"),
        "role": role,
        "expires_at": expires_at,
        "invitation_id": inv["id"],
    }


@router.get("/athletes/{athlete_id}/invite-status")
async def athlete_invite_status(athlete_id: str, user=Depends(require_roles(*ADMIN_ROLES, *COACH_ROLES))):
    # Always project a field that exists (id). Mongo can return {} when only
    # optional fields are projected and absent — and `if not {}` is True in Python.
    athlete = await db.athletes.find_one(
        {"id": athlete_id, "organization_id": user["organization_id"]},
        {"_id": 0, "id": 1, "user_id": 1, "self_service_enabled": 1})
    if athlete is None:
        raise HTTPException(status_code=404, detail="Player not found.")
    if athlete.get("user_id"):
        return {"status": "accepted", "user_id": athlete["user_id"]}
    inv = await db.invitations.find_one(
        {"athlete_id": athlete_id, "organization_id": user["organization_id"]},
        {"_id": 0, "token": 0}, sort=[("created_at", -1)])
    if inv is None:
        return {"status": "not_sent"}
    if inv.get("status") == "pending" and inv.get("expires_at"):
        try:
            exp = datetime.fromisoformat(inv["expires_at"].replace("Z", "+00:00"))
            if exp < datetime.now(timezone.utc):
                return {"status": "expired", "expires_at": inv["expires_at"]}
        except Exception:
            pass
    return {"status": inv.get("status", "pending"), "expires_at": inv.get("expires_at"), "email": inv.get("email")}


# ---------- Athlete self-service ----------

@router.get("/me/athlete")
async def me_athlete(user=Depends(get_current_user)):
    a = await _own_athlete(user)
    return restrict_guardian(a, "athlete")


class MeAthletePatch(BaseModel):
    bio: str | None = Field(default=None, max_length=500)
    public_enabled: bool | None = None

    class Config:
        extra = "forbid"


@router.patch("/me/athlete")
async def patch_me_athlete(body: MeAthletePatch, user=Depends(get_current_user)):
    a = await _own_athlete(user)
    raw = body.model_dump(exclude_unset=True)
    unknown = set(raw) - ATHLETE_PATCH_WHITELIST
    # pydantic extra=forbid already rejects unknowns; double-check
    if unknown:
        raise HTTPException(status_code=422, detail=f"Fields not allowed: {', '.join(sorted(unknown))}")
    updates = {k: v for k, v in raw.items() if k in ATHLETE_PATCH_WHITELIST}
    if not updates:
        return clean(a)
    updates["updated_at"] = now_iso()
    if "bio" in updates and updates["bio"] is not None:
        updates["bio"] = str(updates["bio"])[:500]
    if updates.get("public_enabled") is True and not a.get("public_slug"):
        updates["public_slug"] = _ensure_public_slug(a)
    if not a.get("profile_completed_at") and updates.get("bio"):
        updates["profile_completed_at"] = now_iso()
    await db.athletes.update_one(
        {"id": a["id"], "organization_id": user["organization_id"]}, {"$set": updates})
    a.update(updates)
    return clean(a)


@router.post("/me/athlete/photo")
async def me_athlete_photo(
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    a = await _own_athlete(user)
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_IMAGE:
        raise HTTPException(status_code=400, detail="Profile photo must be JPG, PNG, WEBP or HEIC.")
    contents = await file.read()
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Photo must be 5 MB or smaller.")
    # Basic magic-byte check
    if not (contents.startswith(b"\xff\xd8") or contents.startswith(b"\x89PNG") or contents[:4] == b"RIFF" or b"ftyp" in contents[:32]):
        # allow heic loosely; reject obvious non-images
        if ext not in {".heic", ".webp"} and not contents.startswith(b"\xff\xd8") and not contents.startswith(b"\x89PNG"):
            raise HTTPException(status_code=400, detail="File does not look like a valid image.")

    media_id = new_id()
    stored = f"{media_id}{ext}"
    key = media_object_key(user["organization_id"], stored)
    storage.put(key, contents, content_type=file.content_type)

    age = athlete_age_years(a)
    consent_status = "approved"
    if age is None or age < 18:
        consent_status = "pending_consent"

    doc = {
        "id": media_id, "organization_id": user["organization_id"],
        "athlete_id": a["id"], "uploaded_by": user["id"],
        "uploaded_by_name": user.get("full_name"),
        "file_type": "photo", "file_name": file.filename, "stored_name": stored,
        "storage_key": key,
        "size_bytes": len(contents), "description": "Profile photo",
        "consent_verified": consent_status == "approved",
        "consent_status": consent_status,
        "visibility": "staff" if consent_status != "approved" else "profile",
        "is_profile_photo": True,
        "created_at": now_iso(),
    }
    await db.athlete_media.insert_one(doc)

    photo_url = f"/api/media/{media_id}/file"
    if consent_status == "approved":
        await db.athletes.update_one(
            {"id": a["id"], "organization_id": user["organization_id"]},
            {"$set": {"photo_url": photo_url, "photo_media_id": media_id, "updated_at": now_iso()}})
    await log_audit(user["organization_id"], user, "athlete_photo_uploaded", "athlete_media", media_id,
                    {"athlete_id": a["id"], "consent_status": consent_status})
    return {"media_id": media_id, "photo_url": photo_url if consent_status == "approved" else None,
            "consent_status": consent_status,
            "message": "Photo uploaded." + (" Pending guardian/admin consent." if consent_status == "pending_consent" else "")}


@router.get("/me/evaluations")
async def me_evaluations(user=Depends(get_current_user)):
    a = await _own_athlete(user)
    evals = await db.evaluations.find({
        "athlete_id": a["id"], "organization_id": user["organization_id"],
        "status": {"$in": ["submitted", "approved"]},
    }, {"_id": 0}).sort("submitted_at", -1).to_list(200)
    out = []
    for ev in evals:
        station = await db.stations.find_one(
            {"id": ev.get("station_id"), "organization_id": user["organization_id"]},
            {"_id": 0, "name": 1})
        event = await db.events.find_one(
            {"id": ev.get("event_id"), "organization_id": user["organization_id"]},
            {"_id": 0, "name": 1, "date": 1})
        out.append({
            **{k: ev.get(k) for k in ("id", "status", "submitted_at", "computed", "resolved_position", "template_id")},
            "station_name": (station or {}).get("name"),
            "event_name": (event or {}).get("name"),
            "event_date": (event or {}).get("date"),
        })
    return out


@router.get("/me/id-card")
async def me_id_card(user=Depends(get_current_user)):
    a = await _own_athlete(user)
    org = user["organization_id"]
    evals = await db.evaluations.find({
        "athlete_id": a["id"], "organization_id": org,
        "status": {"$in": ["submitted", "approved"]},
    }, {"_id": 0}).sort("submitted_at", -1).to_list(50)
    overall = None
    if evals:
        scores = [e.get("computed", {}).get("overall_score") for e in evals if e.get("computed")]
        scores = [s for s in scores if s is not None]
        overall = round(sum(scores) / len(scores), 2) if scores else None
    # Latest verified metrics as card highlights
    metrics = await db.verified_metrics.find(
        {"athlete_id": a["id"], "organization_id": org}, {"_id": 0}
    ).sort("measured_at", -1).to_list(50)
    seen = set()
    highlights = []
    for m in metrics:
        if m["metric_key"] in seen:
            continue
        seen.add(m["metric_key"])
        highlights.append({
            "key": m["metric_key"],
            "value": m["value"],
            "unit": m.get("unit"),
            "label": m["metric_key"].replace("_", " ").title(),
        })
        if len(highlights) >= 4:
            break
    public = bool(a.get("public_enabled") and a.get("public_slug"))
    slug = a.get("public_slug")
    qr = f"{APP_PUBLIC_URL}/story/{slug}" if public else f"{APP_PUBLIC_URL}/my-id"
    return {
        "athlete_id": a["id"],
        "name": f"{a.get('first_name', '')} {a.get('last_name', '')}".strip(),
        "primary_position": a.get("primary_position"),
        "age_group": a.get("age_group"),
        "graduation_year": a.get("graduation_year"),
        "bats": a.get("bats"),
        "throws": a.get("throws"),
        "photo_url": a.get("photo_url"),
        "bio": a.get("bio"),
        "headline_overall": overall,
        "highlight_metrics": highlights,
        "public": public,
        "public_slug": slug,
        "public_enabled": bool(a.get("public_enabled")),
        "qr_payload": qr,
        "story_url": qr if public else None,
    }


@router.get("/public/story/{slug}")
async def public_story(slug: str):
    """Unauthenticated chronological ID Story for opt-in public athletes."""
    a = await db.athletes.find_one(
        {"public_slug": slug, "public_enabled": True, "status": "active"}, {"_id": 0})
    if not a:
        raise HTTPException(status_code=404, detail="Story not found or not public.")
    org = a["organization_id"]
    aid = a["id"]
    entries = []
    evals = await db.evaluations.find({
        "athlete_id": aid, "organization_id": org, "status": {"$in": ["submitted", "approved"]},
    }, {"_id": 0}).sort("submitted_at", -1).to_list(50)
    for ev in evals:
        event = await db.events.find_one({"id": ev.get("event_id")}, {"_id": 0, "name": 1, "date": 1})
        entries.append({
            "kind": "evaluation",
            "date": ev.get("submitted_at") or (event or {}).get("date"),
            "title": (event or {}).get("name") or "Evaluation",
            "subtitle": f"Overall {ev.get('computed', {}).get('overall_score', '—')}",
            "detail": ev.get("resolved_position"),
        })
    metrics = await db.verified_metrics.find(
        {"athlete_id": aid, "organization_id": org}, {"_id": 0}).sort("measured_at", -1).to_list(50)
    for m in metrics:
        entries.append({
            "kind": "metric",
            "date": m.get("measured_at") or m.get("created_at"),
            "title": m["metric_key"].replace("_", " ").title(),
            "subtitle": f"{m['value']} {m.get('unit') or ''}".strip(),
            "verified": True,
        })
    milestones = await db.milestones.find(
        {"athlete_id": aid, "organization_id": org}, {"_id": 0}).sort("created_at", -1).to_list(50)
    for ms in milestones:
        entries.append({
            "kind": "milestone",
            "date": ms.get("created_at"),
            "title": ms.get("label") or "Milestone",
            "subtitle": ms.get("detail"),
        })
    media = await db.athlete_media.find({
        "athlete_id": aid, "organization_id": org,
        "consent_status": {"$in": ["approved", None]},
        "visibility": {"$in": ["profile", "public", "staff"]},
    }, {"_id": 0}).sort("created_at", -1).to_list(30)
    for m in media:
        if m.get("consent_status") == "pending_consent":
            continue
        entries.append({
            "kind": "media",
            "date": m.get("created_at"),
            "title": m.get("description") or ("Photo" if m.get("file_type") == "photo" else "Video"),
            "subtitle": m.get("file_type"),
            "thumbnail_url": None,
        })
    entries.sort(key=lambda e: e.get("date") or "", reverse=True)
    org_doc = await db.organizations.find_one({"id": org}, {"_id": 0, "name": 1})
    return {
        "athlete_id": aid,
        "player_name": f"{a.get('first_name', '')} {a.get('last_name', '')}".strip(),
        "primary_position": a.get("primary_position"),
        "age_group": a.get("age_group"),
        "photo_url": a.get("photo_url"),
        "bio": a.get("bio"),
        "organization_name": (org_doc or {}).get("name"),
        "entries": entries[:100],
    }


@router.get("/me/summary")
async def me_summary(user=Depends(get_current_user)):
    """Own-athlete skill summary for My ID radar / growth (no staff fields)."""
    a = await _own_athlete(user)
    evals = await db.evaluations.find({
        "athlete_id": a["id"], "organization_id": user["organization_id"],
        "status": {"$in": ["submitted", "approved"]},
    }, {"_id": 0}).sort("submitted_at", 1).to_list(500)
    agg_all = aggregate_player_scores(evals)
    metric_series = {}
    by_event = {}
    for ev in evals:
        by_event.setdefault(ev["event_id"], []).append(ev)
    for event_id, evs in by_event.items():
        event = await db.events.find_one(
            {"id": event_id, "organization_id": user["organization_id"]},
            {"_id": 0, "name": 1, "date": 1})
        event_name = (event or {}).get("name") or "Event"
        event_date = (event or {}).get("date")
        for ev in evs:
            template = await db.evaluation_templates.find_one(
                {"id": ev.get("template_id"), "organization_id": user["organization_id"]},
                {"_id": 0, "metrics": 1})
            metrics_by_id = {m["id"]: m for m in (template or {}).get("metrics", [])}
            computed = (ev.get("computed") or {}).get("metrics") or {}
            for mid, entry in (ev.get("scores") or {}).items():
                if not isinstance(entry, dict) or entry.get("not_observed"):
                    continue
                raw = entry.get("value")
                if raw is None or raw == "":
                    continue
                meta = metrics_by_id.get(mid) or {}
                mtype = meta.get("metric_type") or ""
                if mtype in ("comment", "observation", "yes_no", "multiple_choice"):
                    continue
                key = meta.get("key") or mid
                series = metric_series.setdefault(key, {
                    "name": meta.get("name") or key, "unit": meta.get("unit") or "",
                    "metric_type": mtype, "higher_is_better": meta.get("higher_is_better", True),
                    "points": [],
                })
                a2 = entry.get("attempt_2")
                best = raw
                if isinstance(raw, (int, float)) and isinstance(a2, (int, float)):
                    best = max(raw, a2) if meta.get("higher_is_better", True) else min(raw, a2)
                series["points"].append({
                    "event_id": event_id, "event_name": event_name, "event_date": event_date,
                    "raw": best, "normalized": (computed.get(mid) or {}).get("normalized"),
                })
    metric_history = []
    for key, series in metric_series.items():
        pts = sorted(series["points"], key=lambda p: p.get("event_date") or "")
        if not pts:
            continue
        first, last = pts[0], pts[-1]
        change = None
        try:
            if isinstance(first["raw"], (int, float)) and isinstance(last["raw"], (int, float)) and len(pts) > 1:
                change = round(last["raw"] - first["raw"], 2)
        except Exception:
            change = None
        improved = None
        if change is not None:
            improved = (change > 0) if series["higher_is_better"] else (change < 0)
            if change == 0:
                improved = False
        metric_history.append({
            "key": key, "name": series["name"], "unit": series["unit"],
            "metric_type": series["metric_type"], "higher_is_better": series["higher_is_better"],
            "latest": last["raw"], "first": first["raw"], "change": change, "improved": improved,
            "points": pts,
        })
    return {
        "category_scores": agg_all["category_scores"],
        "metric_history": metric_history,
        "evaluation_count": len(evals),
        "latest_overall": agg_all.get("overall_score"),
    }
