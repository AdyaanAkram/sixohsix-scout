import os
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from auth import COACH_ROLES, STAFF_ROLES, get_current_user, require_roles
from db import clean, db, log_audit, new_id, now_iso

router = APIRouter()

UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

ALLOWED_IMAGE = {".jpg", ".jpeg", ".png", ".webp", ".heic"}
ALLOWED_VIDEO = {".mp4", ".mov", ".webm", ".m4v"}
MAX_SIZE = 50 * 1024 * 1024  # 50 MB


@router.post("/media/upload")
async def upload_media(
    file: UploadFile = File(...),
    athlete_id: str = Form(...),
    event_id: str = Form(None),
    evaluation_id: str = Form(None),
    description: str = Form(""),
    consent_verified: bool = Form(False),
    is_profile_photo: bool = Form(False),
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
    with open(UPLOAD_DIR / stored_name, "wb") as f:
        f.write(contents)
    doc = {
        "id": media_id, "organization_id": user["organization_id"],
        "athlete_id": athlete_id, "event_id": event_id, "evaluation_id": evaluation_id,
        "uploaded_by": user["id"], "uploaded_by_name": user.get("full_name"),
        "file_type": file_type, "file_name": file.filename, "stored_name": stored_name,
        "size_bytes": len(contents), "description": description,
        "consent_verified": consent_verified, "visibility": "staff",
        "capture_date": now_iso()[:10], "created_at": now_iso(),
    }
    await db.athlete_media.insert_one(doc)
    if is_profile_photo and file_type == "photo":
        await db.athletes.update_one({"id": athlete_id}, {"$set": {"photo_media_id": media_id, "photo_url": f"/api/media/{media_id}/file", "updated_at": now_iso()}})
    await log_audit(user["organization_id"], user, "media_uploaded", "athlete_media", media_id, {"athlete_id": athlete_id, "file_type": file_type})
    return clean(doc)


@router.get("/media/{media_id}/file")
async def get_media_file(media_id: str, user=Depends(get_current_user)):
    m = await db.athlete_media.find_one({"id": media_id, "organization_id": user["organization_id"]})
    if not m:
        raise HTTPException(status_code=404, detail="Media not found.")
    path = UPLOAD_DIR / m["stored_name"]
    if not path.exists():
        raise HTTPException(status_code=404, detail="File missing from storage.")
    return FileResponse(str(path), filename=m.get("file_name"))


@router.get("/athletes/{athlete_id}/media")
async def list_media(athlete_id: str, user=Depends(require_roles(*STAFF_ROLES))):
    a = await db.athletes.find_one({"id": athlete_id, "organization_id": user["organization_id"]})
    if not a:
        raise HTTPException(status_code=404, detail="Player not found.")
    return await db.athlete_media.find({"athlete_id": athlete_id, "organization_id": user["organization_id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)


@router.delete("/media/{media_id}")
async def delete_media(media_id: str, user=Depends(require_roles(*COACH_ROLES))):
    m = await db.athlete_media.find_one({"id": media_id, "organization_id": user["organization_id"]})
    if not m:
        raise HTTPException(status_code=404, detail="Media not found.")
    path = UPLOAD_DIR / m["stored_name"]
    if path.exists():
        path.unlink()
    await db.athlete_media.delete_one({"id": media_id})
    await log_audit(user["organization_id"], user, "media_deleted", "athlete_media", media_id)
    return {"message": "Media deleted."}
