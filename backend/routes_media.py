import os

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel

from auth import ADMIN_ROLES, COACH_ROLES, STAFF_ROLES, get_current_user, require_roles
from db import clean, db, log_audit, new_id, now_iso
from notifications import notify, notify_athlete_users
from routes_players import (compute_age, resolve_record_season_id,
                            season_for_date, _athlete_seasons)
from storage import media_object_key, storage

router = APIRouter()

ALLOWED_IMAGE = {".jpg", ".jpeg", ".png", ".webp", ".heic"}
ALLOWED_VIDEO = {".mp4", ".mov", ".webm", ".m4v"}
MAX_SIZE = 50 * 1024 * 1024  # 50 MB


def _resolve_key(m: dict) -> str:
    stored = m.get("stored_name") or ""
    org = m.get("organization_id") or ""
    key = m.get("storage_key") or media_object_key(org, stored)
    if storage.local_path(key) is None and storage.local_path(stored) is not None:
        return stored
    return key


@router.post("/media/upload")
async def upload_media(
    file: UploadFile = File(...),
    athlete_id: str = Form(...),
    event_id: str = Form(None),
    evaluation_id: str = Form(None),
    description: str = Form(""),
    consent_verified: bool = Form(False),
    is_profile_photo: bool = Form(False),
    is_private: bool = Form(False),
    season_id: str = Form(None),
    user=Depends(require_roles(*STAFF_ROLES)),
):
    athlete = await db.athletes.find_one({"id": athlete_id, "organization_id": user["organization_id"]})
    if not athlete:
        raise HTTPException(status_code=404, detail="Player not found.")
    if not consent_verified:
        raise HTTPException(status_code=400, detail="Media consent must be confirmed before uploading.")
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext in ALLOWED_IMAGE:
        file_type = "photo"
    elif ext in ALLOWED_VIDEO:
        file_type = "video"
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}. Use JPG, PNG, WEBP, MP4, MOV or WEBM.")
    contents = await file.read()
    if len(contents) > MAX_SIZE:
        raise HTTPException(status_code=400, detail="File is too large (max 50 MB).")
    media_id = new_id()
    stored_name = f"{media_id}{ext}"
    key = media_object_key(user["organization_id"], stored_name)
    storage.put(key, contents, content_type=file.content_type)

    age = athlete.get("age")
    if age is None:
        age = compute_age(athlete.get("date_of_birth"))
    # Under-13 always needs guardian/admin consent before profile visibility
    if age is not None and age < 13:
        consent_status = "pending_consent"
        visibility = "pending"
    elif is_private:
        # Spec §11: "mark private" is an enforced ACL, independent of consent.
        # A private item is staff-only and never reaches a public/parent surface,
        # so it never gets "profile"/"public" visibility even once consent is OK.
        consent_status = "approved"
        visibility = "private"
    else:
        consent_status = "approved"
        visibility = "staff"

    # A private file must never become the athlete's public profile photo.
    is_profile_photo = bool(is_profile_photo and file_type == "photo" and not is_private)

    capture_date = now_iso()[:10]
    # Optional season link (spec §6): validate an explicit id, else best-effort
    # resolve from the capture date. Null when nothing matches — never created.
    org = user["organization_id"]
    seasons = await _athlete_seasons(athlete_id, org)
    if season_id:
        if not any(s["id"] == season_id for s in seasons):
            raise HTTPException(status_code=422, detail="Season not found for this athlete.")
        resolved_season_id = season_id
    else:
        matched = season_for_date(seasons, capture_date)
        resolved_season_id = matched["id"] if matched else None

    doc = {
        "id": media_id, "organization_id": user["organization_id"],
        "athlete_id": athlete_id, "event_id": event_id, "evaluation_id": evaluation_id,
        "uploaded_by": user["id"], "uploaded_by_name": user.get("full_name"),
        "file_type": file_type, "file_name": file.filename, "stored_name": stored_name,
        "storage_key": key,
        "size_bytes": len(contents), "description": description,
        "consent_verified": consent_verified,
        "consent_status": consent_status,
        "visibility": visibility,
        # Independent, persisted ACL flag (survives consent transitions). The
        # file-serving route and the consent-approval path both honor it.
        "is_private": bool(is_private),
        "is_profile_photo": is_profile_photo,
        "season_id": resolved_season_id,
        "capture_date": capture_date, "created_at": now_iso(),
    }
    await db.athlete_media.insert_one(doc)
    if is_profile_photo and file_type == "photo" and consent_status == "approved":
        await db.athletes.update_one(
            {"id": athlete_id, "organization_id": user["organization_id"]},
            {"$set": {"photo_media_id": media_id, "photo_url": f"/api/media/{media_id}/file", "updated_at": now_iso()}})
    if consent_status == "pending_consent":
        await notify_athlete_users(
            athlete, "consent_needed", "Media consent needed",
            f"New {file_type} uploaded for {athlete.get('first_name')} — approve to publish.",
            {"media_id": media_id, "athlete_id": athlete_id})
    await log_audit(user["organization_id"], user, "media_uploaded", "athlete_media", media_id,
                    {"athlete_id": athlete_id, "file_type": file_type,
                     "consent_status": consent_status, "is_private": bool(is_private)})
    return clean(doc)


@router.get("/media/{media_id}/file")
async def get_media_file(media_id: str, user=Depends(get_current_user)):
    m = await db.athlete_media.find_one({"id": media_id, "organization_id": user["organization_id"]})
    if not m:
        raise HTTPException(status_code=404, detail="Media not found.")
    # Spec §11: a "mark private" item is staff-only. Athletes/parents (and any
    # non-staff role) are refused the bytes — 404 so the item isn't even
    # disclosed to exist. This is independent of the consent gate.
    if (m.get("is_private") or m.get("visibility") == "private") and user["role"] not in STAFF_ROLES:
        raise HTTPException(status_code=404, detail="Media not found.")
    key = _resolve_key(m)
    url = storage.presigned_get_url(key, filename=m.get("file_name"))
    if url:
        return RedirectResponse(url, status_code=302)
    path = storage.local_path(key)
    if not path:
        raise HTTPException(status_code=404, detail="File missing from storage.")
    return FileResponse(str(path), filename=m.get("file_name"))


@router.get("/athletes/{athlete_id}/media")
async def list_media(athlete_id: str, season_id: str | None = None,
                     user=Depends(require_roles(*STAFF_ROLES))):
    a = await db.athletes.find_one({"id": athlete_id, "organization_id": user["organization_id"]})
    if not a:
        raise HTTPException(status_code=404, detail="Player not found.")
    org = user["organization_id"]
    rows = await db.athlete_media.find(
        {"athlete_id": athlete_id, "organization_id": org}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    if season_id:
        seasons = await _athlete_seasons(athlete_id, org)
        if not any(s["id"] == season_id for s in seasons):
            raise HTTPException(status_code=422, detail="Season not found for this athlete.")
        rows = [m for m in rows
                if resolve_record_season_id(m, seasons, ("capture_date", "created_at")) == season_id]
    return rows


@router.get("/media/pending-consent")
async def pending_consent(user=Depends(require_roles(*COACH_ROLES, "parent"))):
    org = user["organization_id"]
    if user["role"] == "parent":
        athletes = await db.athletes.find(
            {"guardian_user_id": user["id"], "organization_id": org}, {"_id": 0, "id": 1}).to_list(50)
        aids = [a["id"] for a in athletes]
        if not aids:
            return []
        return await db.athlete_media.find(
            {"organization_id": org, "athlete_id": {"$in": aids}, "consent_status": "pending_consent"},
            {"_id": 0}).sort("created_at", -1).to_list(100)
    return await db.athlete_media.find(
        {"organization_id": org, "consent_status": "pending_consent"}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)


class ConsentBody(BaseModel):
    approve: bool


@router.post("/media/{media_id}/consent")
async def resolve_consent(media_id: str, body: ConsentBody, user=Depends(require_roles(*COACH_ROLES, "parent"))):
    m = await db.athlete_media.find_one({"id": media_id, "organization_id": user["organization_id"]})
    if not m:
        raise HTTPException(status_code=404, detail="Media not found.")
    if m.get("consent_status") != "pending_consent":
        raise HTTPException(status_code=400, detail="This media is not awaiting consent.")
    athlete = await db.athletes.find_one({"id": m["athlete_id"], "organization_id": user["organization_id"]}, {"_id": 0})
    if user["role"] == "parent":
        if not athlete or athlete.get("guardian_user_id") != user["id"]:
            raise HTTPException(status_code=403, detail="Not the guardian for this athlete.")
    if body.approve:
        # A private item stays staff-only even after consent is granted — the two
        # controls are independent (spec §11). It never becomes a profile photo.
        is_priv = bool(m.get("is_private")) or m.get("visibility") == "private"
        as_profile = (not is_priv) and (
            bool(m.get("is_profile_photo"))
            or (m.get("description") or "").strip().lower() == "profile photo"
        )
        updates = {
            "consent_status": "approved",
            "visibility": "private" if is_priv else ("profile" if as_profile else "staff"),
            "is_profile_photo": as_profile,
            "guardian_consent_by": user["id"],
            "guardian_consent_at": now_iso(),
        }
        await db.athlete_media.update_one({"id": media_id}, {"$set": updates})
        if as_profile:
            await db.athletes.update_one(
                {"id": m["athlete_id"], "organization_id": user["organization_id"]},
                {"$set": {
                    "photo_url": f"/api/media/{media_id}/file",
                    "photo_media_id": media_id,
                    "updated_at": now_iso(),
                }})
        await notify(m.get("uploaded_by"), "moment_approved", "Media approved",
                     "Your upload was approved and is now visible.",
                     {"media_id": media_id, "athlete_id": m["athlete_id"]})
        return {"message": "Media approved.", "status": "approved", "is_profile_photo": as_profile}
    await db.athlete_media.update_one({"id": media_id}, {"$set": {
        "consent_status": "rejected",
        "visibility": "rejected",
        "guardian_consent_by": user["id"],
        "guardian_consent_at": now_iso(),
    }})
    await notify(m.get("uploaded_by"), "moment_rejected", "Media not approved",
                 "Consent was declined for this upload.",
                 {"media_id": media_id, "athlete_id": m["athlete_id"]})
    return {"message": "Media rejected.", "status": "rejected"}


@router.delete("/media/{media_id}")
async def delete_media(media_id: str, user=Depends(require_roles(*COACH_ROLES))):
    m = await db.athlete_media.find_one({"id": media_id, "organization_id": user["organization_id"]})
    if not m:
        raise HTTPException(status_code=404, detail="Media not found.")
    key = _resolve_key(m)
    storage.delete(key)
    if m.get("stored_name"):
        storage.delete(m["stored_name"])
    await db.athlete_media.delete_one({"id": media_id, "organization_id": user["organization_id"]})
    await log_audit(user["organization_id"], user, "media_deleted", "athlete_media", media_id)
    return {"message": "Media deleted."}
