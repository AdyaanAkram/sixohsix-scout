import uuid
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient

from config import settings

try:
    import certifi
    _tls_ca = certifi.where()
except Exception:
    _tls_ca = None

# tlsCAFile implies tls=True in PyMongo, so only set it for URLs that actually use
# TLS (Atlas/SRV, or an explicit tls/ssl flag). Setting it unconditionally breaks
# plain mongodb:// connections — local dev and `docker compose --profile local-db`.
_url = (settings.mongo_url or "").lower()
_uses_tls = _url.startswith("mongodb+srv://") or "tls=true" in _url or "ssl=true" in _url

_client_kwargs = {"serverSelectionTimeoutMS": 15000}
if _tls_ca and _uses_tls:
    _client_kwargs["tlsCAFile"] = _tls_ca

client = AsyncIOMotorClient(settings.mongo_url, **_client_kwargs)
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
