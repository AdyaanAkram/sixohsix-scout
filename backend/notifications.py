"""In-app notifications helper."""
from __future__ import annotations

from db import db, new_id, now_iso


async def notify(user_id: str | None, kind: str, title: str, body: str, payload: dict | None = None) -> None:
    if not user_id:
        return
    await db.notifications.insert_one({
        "id": new_id(),
        "user_id": user_id,
        "kind": kind,
        "title": title,
        "body": body,
        "payload": payload or {},
        "read": False,
        "created_at": now_iso(),
    })


async def notify_athlete_users(athlete: dict, kind: str, title: str, body: str, payload: dict | None = None) -> None:
    """Notify linked athlete and/or guardian accounts."""
    await notify(athlete.get("user_id"), kind, title, body, payload)
    await notify(athlete.get("guardian_user_id"), kind, title, body, payload)
