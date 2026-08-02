import os
import time
from collections import defaultdict

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


async def resolve_membership(user_id: str, preferred_org_id: str | None = None):
    """Pick active membership: preferred → user.active_organization_id → first by created_at."""
    memberships = await db.memberships.find(
        {"user_id": user_id, "active": True}, {"_id": 0}
    ).sort("created_at", 1).to_list(100)
    if not memberships:
        return None
    if preferred_org_id:
        hit = next((m for m in memberships if m["organization_id"] == preferred_org_id), None)
        if hit:
            return hit
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "active_organization_id": 1})
    preferred = (user or {}).get("active_organization_id")
    if preferred:
        hit = next((m for m in memberships if m["organization_id"] == preferred), None)
        if hit:
            return hit
    return memberships[0]


async def _load_user(user_id: str, organization_id: str | None = None):
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not user or not user.get("active", True):
        raise HTTPException(status_code=401, detail="Account not found or deactivated.")
    membership = await resolve_membership(user_id, organization_id)
    if not membership:
        raise HTTPException(status_code=403, detail="No active organization membership.")
    user["role"] = membership["role"]
    user["organization_id"] = membership["organization_id"]
    user["membership_id"] = membership.get("id")
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
