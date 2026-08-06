import os
import time
from collections import defaultdict
from datetime import datetime, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from db import db

from config import settings

JWT_SECRET = settings.jwt_secret
JWT_ALGO = 'HS256'
TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7  # 7 days

security = HTTPBearer(auto_error=False)

# --- simple in-memory rate limiter for auth endpoints ---
_attempts = defaultdict(list)


def rate_limit(key: str, max_attempts: int = 10, window_seconds: int = 60):
    now = time.time()
    _attempts[key] = [t for t in _attempts[key] if now - t < window_seconds]
    if len(_attempts[key]) >= max_attempts:
        raise HTTPException(status_code=429, detail="Too many attempts. Please wait a minute and try again.")
    _attempts[key].append(now)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except Exception:
        return False


def create_token(user_id: str, organization_id: str | None = None) -> str:
    payload = {"sub": user_id, "exp": int(time.time()) + TOKEN_TTL_SECONDS, "iat": int(time.time())}
    if organization_id:
        payload["org"] = organization_id
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def decode_token(token: str) -> dict:
    """Return JWT payload with at least `sub`. Raises 401 on failure."""
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid authentication token.")


def membership_expired(membership: dict | None) -> bool:
    """True when temporary membership expires_at is in the past."""
    if not membership:
        return False
    exp = membership.get("expires_at")
    if not exp:
        return False
    try:
        exp_dt = datetime.fromisoformat(str(exp).replace("Z", "+00:00"))
        if exp_dt.tzinfo is None:
            exp_dt = exp_dt.replace(tzinfo=timezone.utc)
        return exp_dt < datetime.now(timezone.utc)
    except Exception:
        return False


def active_assignment_filter() -> dict:
    """Mongo fragment for evaluator_assignments: not revoked, not past expiry.

    Mirrors membership expiry so temporary event access ends on both paths.
    Callers that already use $or must merge this with $and instead of spreading.
    """
    now = datetime.now(timezone.utc).isoformat()
    return {
        "active": {"$ne": False},
        "$or": [
            {"expires_at": None},
            {"expires_at": {"$exists": False}},
            {"expires_at": {"$gt": now}},
        ],
    }


async def resolve_membership(user_id: str, preferred_org_id: str | None = None):
    """Pick active membership: preferred → user.active_organization_id → first by created_at.
    Skips expired temporary access and deactivates those memberships."""
    memberships = await db.memberships.find(
        {"user_id": user_id, "active": True}, {"_id": 0}
    ).sort("created_at", 1).to_list(100)
    valid = []
    for m in memberships:
        if membership_expired(m):
            await db.memberships.update_one(
                {"id": m["id"]},
                {"$set": {"active": False, "expired_at": datetime.now(timezone.utc).isoformat()}},
            )
            continue
        valid.append(m)
    if not valid:
        return None
    if preferred_org_id:
        hit = next((m for m in valid if m["organization_id"] == preferred_org_id), None)
        if hit:
            return hit
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "active_organization_id": 1})
    preferred = (user or {}).get("active_organization_id")
    if preferred:
        hit = next((m for m in valid if m["organization_id"] == preferred), None)
        if hit:
            return hit
    return valid[0]


async def _load_user(user_id: str, organization_id: str | None = None):
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not user or not user.get("active", True):
        raise HTTPException(status_code=401, detail="Account not found or deactivated.")
    membership = await resolve_membership(user_id, organization_id)
    if not membership:
        raise HTTPException(
            status_code=403,
            detail="No active organization membership. Temporary event access may have expired.",
        )
    user["role"] = membership["role"]
    user["organization_id"] = membership["organization_id"]
    user["membership_id"] = membership.get("id")
    user["membership_expires_at"] = membership.get("expires_at")
    user["temporary_access"] = bool(membership.get("temporary") or membership.get("expires_at"))
    return user


async def get_current_user(request: Request, credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = None
    if credentials:
        token = credentials.credentials
    elif request.query_params.get("token"):
        # signed URL access (e.g., media files, PDF downloads opened in new tab)
        token = request.query_params.get("token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    payload = decode_token(token)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid authentication token.")
    org_id = payload.get("org")
    return await _load_user(user_id, org_id)


def require_roles(*roles):
    async def checker(user=Depends(get_current_user)):
        if user["role"] not in roles:
            raise HTTPException(status_code=403, detail="You do not have permission to perform this action.")
        return user
    return checker


# convenience dependency groups
ADMIN_ROLES = ("owner", "admin")
STAFF_ROLES = ("owner", "admin", "head_scout", "coach", "evaluator")
REVIEW_ROLES = ("owner", "admin", "head_scout")
COACH_ROLES = ("owner", "admin", "head_scout", "coach")
