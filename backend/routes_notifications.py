from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user
from db import db

router = APIRouter()


@router.get("/notifications")
async def list_notifications(unread_only: bool = False, user=Depends(get_current_user)):
    q = {"user_id": user["id"]}
    if unread_only:
        q["read"] = False
    return await db.notifications.find(q, {"_id": 0}).sort("created_at", -1).to_list(100)


@router.get("/notifications/unread-count")
async def unread_count(user=Depends(get_current_user)):
    n = await db.notifications.count_documents({"user_id": user["id"], "read": False})
    return {"count": n}


class ReadBody(BaseModel):
    ids: list[str] | None = None  # None = mark all


@router.post("/notifications/read")
async def mark_read(body: ReadBody, user=Depends(get_current_user)):
    q = {"user_id": user["id"], "read": False}
    if body.ids:
        q["id"] = {"$in": body.ids}
    res = await db.notifications.update_many(q, {"$set": {"read": True}})
    return {"updated": res.modified_count}


@router.post("/notifications/{nid}/read")
async def mark_one_read(nid: str, user=Depends(get_current_user)):
    res = await db.notifications.update_one(
        {"id": nid, "user_id": user["id"]}, {"$set": {"read": True}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found.")
    return {"message": "Marked read."}
