import os
import time
from collections import defaultdict

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from db import db

JWT_SECRET = os.environ.get('JWT_SECRET', 'pbg-scout-dev-secret-change-in-prod')
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


def create_token(user_id: str) -> str:
    payload = {"sub": user_id, "exp": int(time.time()) + TOKEN_TTL_SECONDS, "iat": int(time.time())}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def decode_token(token: str) -> str:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
        return payload["sub"]
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid authentication token.")


async def _load_user(user_id: str):
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not user or not user.get("active", True):
        raise HTTPException(status_code=401, detail="Account not found or deactivated.")
    membership = await db.memberships.find_one({"user_id": user_id, "active": True}, {"_id": 0})
    if not membership:
        raise HTTPException(status_code=403, detail="No active organization membership.")
    user["role"] = membership["role"]
    user["organization_id"] = membership["organization_id"]
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
    user_id = decode_token(token)
    return await _load_user(user_id)


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
