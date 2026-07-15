import secrets

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from auth import (ADMIN_ROLES, create_token, get_current_user, hash_password,
                  rate_limit, require_roles, verify_password)
from db import clean, db, log_audit, new_id, now_iso

router = APIRouter()

ROLES = ["owner", "admin", "head_scout", "coach", "evaluator", "athlete", "parent"]
ACTIVE_ROLES = ["owner", "admin", "head_scout", "coach", "evaluator"]


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class ForgotBody(BaseModel):
    email: EmailStr


class ResetBody(BaseModel):
    token: str
    password: str = Field(min_length=8)


class InviteBody(BaseModel):
    email: EmailStr
    full_name: str
    role: str


class AcceptInviteBody(BaseModel):
    token: str
    password: str = Field(min_length=8)


class UpdateStaffBody(BaseModel):
    role: str | None = None
    active: bool | None = None
    full_name: str | None = None


@router.post("/auth/login")
async def login(body: LoginBody, request: Request):
    rate_limit(f"login:{request.client.host if request.client else 'x'}", 15, 60)
    user = await db.users.find_one({"email": body.email.lower()})
    if not user or not verify_password(body.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    if not user.get("active", True):
        raise HTTPException(status_code=403, detail="This account has been deactivated.")
    membership = await db.memberships.find_one({"user_id": user["id"], "active": True}, {"_id": 0})
    if not membership:
        raise HTTPException(status_code=403, detail="No active organization membership.")
    if membership["role"] in ("athlete", "parent"):
        raise HTTPException(status_code=403, detail="Athlete and Parent portals are coming soon.")
    token = create_token(user["id"])
    org = await db.organizations.find_one({"id": membership["organization_id"]}, {"_id": 0})
    await log_audit(membership["organization_id"], {"id": user["id"], "full_name": user.get("full_name"), "role": membership["role"]}, "login", "user", user["id"])
    return {
        "token": token,
        "user": {
            "id": user["id"],
            "email": user["email"],
            "full_name": user.get("full_name"),
            "role": membership["role"],
            "organization_id": membership["organization_id"],
            "organization_name": org.get("name") if org else None,
        },
    }


@router.get("/auth/me")
async def me(user=Depends(get_current_user)):
    org = await db.organizations.find_one({"id": user["organization_id"]}, {"_id": 0})
    user["organization_name"] = org.get("name") if org else None
    return clean(user)


@router.post("/auth/forgot-password")
async def forgot_password(body: ForgotBody, request: Request):
    rate_limit(f"forgot:{request.client.host if request.client else 'x'}", 5, 60)
    user = await db.users.find_one({"email": body.email.lower()})
    if user:
        token = secrets.token_urlsafe(32)
        await db.password_resets.insert_one({
            "id": new_id(), "user_id": user["id"], "token": token,
            "created_at": now_iso(), "used": False,
        })
        # No email service configured for MVP: reset link surfaced to org admins via audit log
        membership = await db.memberships.find_one({"user_id": user["id"]}, {"_id": 0})
        if membership:
            await log_audit(membership["organization_id"], None, "password_reset_requested", "user", user["id"], {"reset_token": token})
        return {"message": "If that email exists, a reset link has been generated. Ask your administrator to retrieve it from the audit log.", "reset_token": token}
    return {"message": "If that email exists, a reset link has been generated. Ask your administrator to retrieve it from the audit log."}


@router.post("/auth/reset-password")
async def reset_password(body: ResetBody):
    reset = await db.password_resets.find_one({"token": body.token, "used": False})
    if not reset:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token.")
    await db.users.update_one({"id": reset["user_id"]}, {"$set": {"password_hash": hash_password(body.password), "updated_at": now_iso()}})
    await db.password_resets.update_one({"id": reset["id"]}, {"$set": {"used": True}})
    return {"message": "Password updated. You can now sign in."}


# ---------------- Staff management ----------------

@router.get("/staff")
async def list_staff(user=Depends(require_roles(*ADMIN_ROLES, "head_scout"))):
    memberships = await db.memberships.find({"organization_id": user["organization_id"]}, {"_id": 0}).to_list(500)
    user_ids = [m["user_id"] for m in memberships]
    users = await db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "password_hash": 0}).to_list(500)
    umap = {u["id"]: u for u in users}
    out = []
    for m in memberships:
        u = umap.get(m["user_id"])
        if not u:
            continue
        out.append({**u, "role": m["role"], "membership_active": m.get("active", True)})
    return out


@router.post("/staff/invite")
async def invite_staff(body: InviteBody, user=Depends(require_roles(*ADMIN_ROLES))):
    if body.role not in ROLES:
        raise HTTPException(status_code=400, detail="Invalid role.")
    existing = await db.users.find_one({"email": body.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="A user with this email already exists.")
    token = secrets.token_urlsafe(24)
    inv = {
        "id": new_id(),
        "organization_id": user["organization_id"],
        "email": body.email.lower(),
        "full_name": body.full_name,
        "role": body.role,
        "token": token,
        "status": "pending",
        "created_by": user["id"],
        "created_at": now_iso(),
    }
    await db.invitations.insert_one(inv)
    await log_audit(user["organization_id"], user, "invite_sent", "invitation", inv["id"], {"email": body.email, "role": body.role})
    return {"invitation": clean({k: v for k, v in inv.items() if k != '_id'}), "invite_token": token}


@router.get("/invitations")
async def list_invitations(user=Depends(require_roles(*ADMIN_ROLES))):
    invs = await db.invitations.find({"organization_id": user["organization_id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return invs


@router.get("/invitations/lookup/{token}")
async def lookup_invitation(token: str):
    inv = await db.invitations.find_one({"token": token, "status": "pending"}, {"_id": 0, "created_by": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invitation not found or already used.")
    org = await db.organizations.find_one({"id": inv["organization_id"]}, {"_id": 0})
    return {"email": inv["email"], "full_name": inv["full_name"], "role": inv["role"], "organization_name": org.get("name") if org else ""}


@router.post("/auth/accept-invitation")
async def accept_invitation(body: AcceptInviteBody):
    inv = await db.invitations.find_one({"token": body.token, "status": "pending"})
    if not inv:
        raise HTTPException(status_code=400, detail="Invitation not found or already used.")
    uid = new_id()
    await db.users.insert_one({
        "id": uid, "email": inv["email"], "full_name": inv["full_name"],
        "password_hash": hash_password(body.password), "active": True,
        "created_at": now_iso(), "updated_at": now_iso(),
    })
    await db.memberships.insert_one({
        "id": new_id(), "user_id": uid, "organization_id": inv["organization_id"],
        "role": inv["role"], "active": True, "created_at": now_iso(),
    })
    await db.invitations.update_one({"id": inv["id"]}, {"$set": {"status": "accepted", "accepted_at": now_iso()}})
    await log_audit(inv["organization_id"], None, "invite_accepted", "user", uid, {"email": inv["email"]})
    token = create_token(uid)
    org = await db.organizations.find_one({"id": inv["organization_id"]}, {"_id": 0})
    return {"token": token, "user": {"id": uid, "email": inv["email"], "full_name": inv["full_name"], "role": inv["role"], "organization_id": inv["organization_id"], "organization_name": org.get("name") if org else None}}


@router.patch("/staff/{user_id}")
async def update_staff(user_id: str, body: UpdateStaffBody, user=Depends(require_roles("owner", "admin"))):
    membership = await db.memberships.find_one({"user_id": user_id, "organization_id": user["organization_id"]})
    if not membership:
        raise HTTPException(status_code=404, detail="Staff member not found.")
    if membership["role"] == "owner" and user["role"] != "owner":
        raise HTTPException(status_code=403, detail="Only the owner can modify the owner account.")
    updates = {}
    if body.role is not None:
        if body.role not in ROLES:
            raise HTTPException(status_code=400, detail="Invalid role.")
        if user["role"] != "owner" and body.role == "owner":
            raise HTTPException(status_code=403, detail="Only the owner can assign the owner role.")
        await db.memberships.update_one({"id": membership["id"]}, {"$set": {"role": body.role}})
        updates["role"] = body.role
    if body.active is not None:
        await db.memberships.update_one({"id": membership["id"]}, {"$set": {"active": body.active}})
        await db.users.update_one({"id": user_id}, {"$set": {"active": body.active}})
        updates["active"] = body.active
    if body.full_name is not None:
        await db.users.update_one({"id": user_id}, {"$set": {"full_name": body.full_name, "updated_at": now_iso()}})
        updates["full_name"] = body.full_name
    await log_audit(user["organization_id"], user, "staff_updated", "user", user_id, updates)
    return {"message": "Staff member updated.", "updates": updates}


# ---------------- Organization settings & audit ----------------

@router.get("/organization")
async def get_org(user=Depends(get_current_user)):
    org = await db.organizations.find_one({"id": user["organization_id"]}, {"_id": 0})
    return org


class OrgUpdateBody(BaseModel):
    name: str | None = None
    tagline: str | None = None
    contact_email: str | None = None


@router.patch("/organization")
async def update_org(body: OrgUpdateBody, user=Depends(require_roles("owner"))):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if updates:
        updates["updated_at"] = now_iso()
        await db.organizations.update_one({"id": user["organization_id"]}, {"$set": updates})
        await log_audit(user["organization_id"], user, "organization_updated", "organization", user["organization_id"], updates)
    return {"message": "Organization updated."}


@router.get("/audit-logs")
async def audit_logs(limit: int = 100, user=Depends(require_roles("owner", "admin"))):
    logs = await db.audit_logs.find({"organization_id": user["organization_id"]}, {"_id": 0}).sort("created_at", -1).to_list(min(limit, 500))
    return logs
