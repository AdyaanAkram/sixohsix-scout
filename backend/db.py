import uuid
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient

from config import settings

client = AsyncIOMotorClient(settings.mongo_url, serverSelectionTimeoutMS=5000)
db = client[settings.db_name]


def new_id() -> str:
    return str(uuid.uuid4())


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def clean(doc):
    """Remove Mongo _id recursively for JSON responses."""
    if doc is None:
        return None
    if isinstance(doc, list):
        return [clean(d) for d in doc]
    if isinstance(doc, dict):
        return {k: clean(v) for k, v in doc.items() if k != '_id'}
    if isinstance(doc, datetime):
        return doc.isoformat()
    return doc


async def log_audit(org_id, user, action, entity_type, entity_id, details=None):
    await db.audit_logs.insert_one({
        "id": new_id(),
        "organization_id": org_id,
        "actor_id": user.get("id") if user else None,
        "actor_name": user.get("full_name") if user else "system",
        "actor_role": user.get("role") if user else None,
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "details": details or {},
        "created_at": now_iso(),
    })
