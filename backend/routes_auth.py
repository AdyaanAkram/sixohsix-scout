import os
import re
import secrets

from fastapi import (APIRouter, Depends, File, HTTPException, Request,
                     UploadFile)
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel, EmailStr, Field

from auth import (ADMIN_ROLES, create_token, get_current_user, hash_password,
                  rate_limit, require_roles, resolve_membership, verify_password)
from config import settings
from db import clean, db, log_audit, new_id, now_iso
from mailer import safe_send, send_template
from storage import media_object_key, storage

router = APIRouter()

ROLES = ["owner", "admin", "head_scout", "coach", "evaluator", "athlete", "parent"]
ACTIVE_ROLES = ["owner", "admin", "head_scout", "coach", "evaluator"]


class LoginBody(BaseModel):
    email: EmailStr
    password: str
    organization_id: str | None = None


class SwitchOrgBody(BaseModel):
    organization_id: str


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


async def _user_payload(user_doc: dict, membership: dict) -> dict:
    org = await db.organizations.find_one({"id": membership["organization_id"]}, {"_id": 0})
    memberships = await db.memberships.find(
        {"user_id": user_doc["id"], "active": True}, {"_id": 0}
    ).to_list(100)
    org_ids = [m["organization_id"] for m in memberships]
    orgs = await db.organizations.find(
        {"id": {"$in": org_ids}},
        {"_id": 0, "id": 1, "name": 1, "tagline": 1, "logo_url": 1},
    ).to_list(100)
    omap = {o["id"]: o for o in orgs}
    return {
        "id": user_doc["id"],
        "email": user_doc["email"],
        "full_name": user_doc.get("full_name"),
        "role": membership["role"],
        "organization_id": membership["organization_id"],
        "organization_name": (org or {}).get("name"),
        "organization_tagline": (org or {}).get("tagline"),
        # The app shell (OrgMark) reads these straight off the auth payload, so the
        # branding renders on first paint without a second /organization round-trip.
        "organization_logo_url": (org or {}).get("logo_url"),
        "organization_cover_url": (org or {}).get("cover_url"),
        "organization_primary_color": (org or {}).get("primary_color"),
        "memberships": [
            {
                "organization_id": m["organization_id"],
                "organization_name": (omap.get(m["organization_id"]) or {}).get("name"),
                "logo_url": (omap.get(m["organization_id"]) or {}).get("logo_url"),
                "role": m["role"],
                "active": m.get("organization_id") == membership["organization_id"],
            }
            for m in memberships
        ],
    }


@router.post("/auth/login")
async def login(body: LoginBody, request: Request):
    rate_limit(f"login:{request.client.host if request.client else 'x'}", 15, 60)
    user = await db.users.find_one({"email": body.email.lower()})
    if not user or not verify_password(body.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    if not user.get("active", True):
        raise HTTPException(status_code=403, detail="This account has been deactivated.")
    membership = await resolve_membership(user["id"], body.organization_id)
    if not membership:
        raise HTTPException(status_code=403, detail="No active organization membership.")
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"active_organization_id": membership["organization_id"], "updated_at": now_iso()}},
    )
    token = create_token(user["id"], membership["organization_id"])
    await log_audit(
        membership["organization_id"],
        {"id": user["id"], "full_name": user.get("full_name"), "role": membership["role"]},
        "login", "user", user["id"],
    )
    return {"token": token, "user": await _user_payload(user, membership)}


@router.get("/auth/me")
async def me(user=Depends(get_current_user)):
    membership = await db.memberships.find_one({
        "user_id": user["id"], "organization_id": user["organization_id"], "active": True,
    }, {"_id": 0})
    if not membership:
        raise HTTPException(status_code=403, detail="No active organization membership.")
    full = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    return await _user_payload(full or user, membership)


@router.get("/auth/memberships")
async def list_memberships(user=Depends(get_current_user)):
    """Organizations this user can enter — each with own athletes, staff, programs, events."""
    memberships = await db.memberships.find(
        {"user_id": user["id"], "active": True}, {"_id": 0}
    ).sort("created_at", 1).to_list(100)
    org_ids = [m["organization_id"] for m in memberships]
    orgs = await db.organizations.find({"id": {"$in": org_ids}}, {"_id": 0}).to_list(100)
    omap = {o["id"]: o for o in orgs}
    out = []
    for m in memberships:
        o = omap.get(m["organization_id"]) or {}
        n_athletes = await db.athletes.count_documents({"organization_id": m["organization_id"], "status": "active"})
        n_events = await db.events.count_documents({"organization_id": m["organization_id"]})
        n_programs = await db.programs.count_documents({"organization_id": m["organization_id"]})
        out.append({
            "organization_id": m["organization_id"],
            "organization_name": o.get("name"),
            "tagline": o.get("tagline"),
            "logo_url": o.get("logo_url"),
            "role": m["role"],
            "is_current": m["organization_id"] == user["organization_id"],
            "athlete_count": n_athletes,
            "event_count": n_events,
            "program_count": n_programs,
        })
    return out


@router.post("/auth/switch-organization")
async def switch_organization(body: SwitchOrgBody, user=Depends(get_current_user)):
    membership = await db.memberships.find_one({
        "user_id": user["id"],
        "organization_id": body.organization_id,
        "active": True,
    }, {"_id": 0})
    if not membership:
        raise HTTPException(status_code=403, detail="You are not a member of that organization.")
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"active_organization_id": body.organization_id, "updated_at": now_iso()}},
    )
    token = create_token(user["id"], body.organization_id)
    full = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    await log_audit(
        body.organization_id,
        {"id": user["id"], "full_name": user.get("full_name"), "role": membership["role"]},
        "switch_organization", "organization", body.organization_id,
    )
    return {"token": token, "user": await _user_payload(full or user, membership)}


@router.post("/auth/forgot-password")
async def forgot_password(body: ForgotBody, request: Request):
    rate_limit(f"forgot:{request.client.host if request.client else 'x'}", 5, 60)
    generic = {"message": "If that email exists, a reset link has been sent."}
    user = await db.users.find_one({"email": body.email.lower()})
    if not user:
        return generic
    token = secrets.token_urlsafe(32)
    await db.password_resets.insert_one({
        "id": new_id(), "user_id": user["id"], "token": token,
        "created_at": now_iso(), "used": False,
    })
    membership = await db.memberships.find_one({"user_id": user["id"]}, {"_id": 0})
    org_id = (membership or {}).get("organization_id")
    if org_id:
        # Never put the raw token in the audit log
        await log_audit(org_id, None, "password_reset_requested", "user", user["id"], {})
    link = f"{settings.app_public_url}/forgot-password?token={token}"
    try:
        send_template(user["email"], "password_reset", {
            "name": user.get("full_name") or "there",
            "link": link,
        })
    except Exception as e:
        # Don't leak whether the account exists; log server-side
        print(f"[auth] password reset mail failed: {e}")
        if settings.app_env == "production":
            raise HTTPException(status_code=503, detail="Unable to send reset email. Try again shortly.")
    # Dev convenience only — never return tokens in production
    if settings.app_env != "production" and settings.mail_provider == "stdout":
        return {**generic, "reset_token": token}
    return generic


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
    if body.role not in ROLES or body.role in ("athlete", "parent"):
        raise HTTPException(status_code=400, detail="Invalid role. Use athlete invite endpoint for athletes.")
    existing = await db.users.find_one({"email": body.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="A user with this email already exists.")
    from datetime import datetime, timedelta, timezone
    token = secrets.token_urlsafe(24)
    expires_at = (datetime.now(timezone.utc) + timedelta(days=14)).isoformat()
    inv = {
        "id": new_id(),
        "organization_id": user["organization_id"],
        "email": body.email.lower(),
        "full_name": body.full_name,
        "role": body.role,
        "token": token,
        "status": "pending",
        "expires_at": expires_at,
        "created_by": user["id"],
        "created_at": now_iso(),
    }
    await db.invitations.insert_one(inv)
    await log_audit(user["organization_id"], user, "invite_sent", "invitation", inv["id"], {"email": body.email, "role": body.role})
    # Do not return raw token — email it (dev: stdout / prod: Resend).
    # safe_send never raises: a mail outage must not orphan the invitation row.
    link = f"{settings.app_public_url}/accept-invitation?token={token}"
    result = safe_send(body.email.lower(), "staff_invitation", {
        "name": body.full_name, "org": user.get("organization_name") or "60'6\"", "link": link,
    })
    local, _, domain = body.email.lower().partition("@")
    masked = f"{local[0]}***@{domain}" if local else f"***@{domain}"
    return {"sent": bool(result.get("sent")), "email": masked,
            "invitation_id": inv["id"], "expires_at": expires_at}


@router.get("/invitations")
async def list_invitations(user=Depends(require_roles(*ADMIN_ROLES))):
    invs = await db.invitations.find({"organization_id": user["organization_id"]}, {"_id": 0, "token": 0}).sort("created_at", -1).to_list(200)
    return invs


def _invitation_expired(inv) -> bool:
    exp = inv.get("expires_at")
    if not exp:
        return False
    try:
        from datetime import datetime, timezone
        dt = datetime.fromisoformat(str(exp).replace("Z", "+00:00"))
        return dt < datetime.now(timezone.utc)
    except Exception:
        return False


@router.get("/invitations/lookup/{token}")
async def lookup_invitation(token: str):
    inv = await db.invitations.find_one({"token": token, "status": "pending"}, {"_id": 0, "created_by": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invitation not found or already used.")
    if _invitation_expired(inv):
        await db.invitations.update_one({"id": inv["id"]}, {"$set": {"status": "expired"}})
        raise HTTPException(status_code=400, detail="This invitation has expired. Ask your coach to send a new one.")
    org = await db.organizations.find_one({"id": inv["organization_id"]}, {"_id": 0})
    # Never echo the token back
    return {
        "email": inv["email"], "full_name": inv["full_name"], "role": inv["role"],
        "athlete_id": inv.get("athlete_id"),
        "organization_name": org.get("name") if org else "",
        "expires_at": inv.get("expires_at"),
    }


@router.post("/auth/accept-invitation")
async def accept_invitation(body: AcceptInviteBody):
    inv = await db.invitations.find_one({"token": body.token, "status": "pending"})
    if not inv:
        raise HTTPException(status_code=400, detail="Invitation not found or already used.")
    if _invitation_expired(inv):
        await db.invitations.update_one({"id": inv["id"]}, {"$set": {"status": "expired"}})
        raise HTTPException(status_code=400, detail="This invitation has expired.")
    # One email = one account, ALWAYS. A guardian invited for a second child (or
    # anyone re-invited) must land on their existing account, never a duplicate —
    # duplicate user rows make email login pick one of them at random.
    existing = await db.users.find_one({"email": inv["email"]})
    if existing:
        if not verify_password(body.password, existing.get("password_hash") or ""):
            raise HTTPException(
                status_code=409,
                detail="An account with this email already exists. Enter that account's "
                       "current password to claim this invitation (or reset it first).")
        uid = existing["id"]
        if not await db.memberships.find_one({"user_id": uid, "organization_id": inv["organization_id"]}):
            await db.memberships.insert_one({
                "id": new_id(), "user_id": uid, "organization_id": inv["organization_id"],
                "role": inv["role"], "active": True, "created_at": now_iso(),
            })
    else:
        uid = new_id()
        await db.users.insert_one({
            "id": uid, "email": inv["email"], "full_name": inv["full_name"],
            "password_hash": hash_password(body.password), "active": True,
            "active_organization_id": inv["organization_id"],
            "created_at": now_iso(), "updated_at": now_iso(),
        })
        await db.memberships.insert_one({
            "id": new_id(), "user_id": uid, "organization_id": inv["organization_id"],
            "role": inv["role"], "active": True, "created_at": now_iso(),
        })
    # Link athlete record when invitation is for athlete/parent
    if inv.get("athlete_id"):
        link = {"user_id": uid, "self_service_enabled": True, "updated_at": now_iso()}
        if inv["role"] == "athlete":
            await db.athletes.update_one(
                {"id": inv["athlete_id"], "organization_id": inv["organization_id"]},
                {"$set": link})
        elif inv["role"] == "parent":
            await db.athletes.update_one(
                {"id": inv["athlete_id"], "organization_id": inv["organization_id"]},
                {"$set": {"guardian_user_id": uid, "self_service_enabled": True, "updated_at": now_iso()}})
    await db.invitations.update_one({"id": inv["id"]}, {"$set": {"status": "accepted", "accepted_at": now_iso()}})
    await log_audit(inv["organization_id"], None, "invite_accepted", "user", uid, {"email": inv["email"], "role": inv["role"]})
    token = create_token(uid, inv["organization_id"])
    org = await db.organizations.find_one({"id": inv["organization_id"]}, {"_id": 0})
    return {
        "token": token,
        "user": {
            "id": uid, "email": inv["email"], "full_name": inv["full_name"],
            "role": inv["role"], "organization_id": inv["organization_id"],
            "organization_name": org.get("name") if org else None,
            "athlete_id": inv.get("athlete_id"),
            "memberships": [{
                "organization_id": inv["organization_id"],
                "organization_name": org.get("name") if org else None,
                "role": inv["role"],
                "active": True,
            }],
        },
    }

@router.delete("/staff/{user_id}")
async def remove_staff(user_id: str, user=Depends(require_roles("owner"))):
    """Remove a staff member from THIS organization entirely (owner only).
    Their membership is deleted and any evaluator assignments here are revoked;
    the login itself is deactivated only when no other org membership remains."""
    if user_id == user["id"]:
        raise HTTPException(status_code=400, detail="You can't remove your own account.")
    membership = await db.memberships.find_one({"user_id": user_id, "organization_id": user["organization_id"]})
    if not membership:
        raise HTTPException(status_code=404, detail="Staff member not found.")
    if membership["role"] == "owner":
        raise HTTPException(status_code=403, detail="The owner account can't be removed.")
    await db.memberships.delete_one({"id": membership["id"]})
    await db.evaluator_assignments.update_many(
        {"evaluator_id": user_id, "organization_id": user["organization_id"]},
        {"$set": {"active": False, "updated_at": now_iso()}})
    remaining = await db.memberships.count_documents({"user_id": user_id, "active": True})
    removed_user = await db.users.find_one({"id": user_id}, {"_id": 0, "email": 1})
    if remaining == 0:
        await db.users.update_one({"id": user_id}, {"$set": {"active": False, "updated_at": now_iso()}})
    await log_audit(user["organization_id"], user, "staff_removed", "user", user_id,
                    {"email": (removed_user or {}).get("email"), "role": membership["role"],
                     "login_deactivated": remaining == 0})
    return {"message": "Staff member removed from the organization."}


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

# Profile keys the org payload always carries, so the frontend can render a stable
# shape even for organizations created before these fields existed.
ORG_PROFILE_FIELDS = (
    "name", "full_name", "tagline", "contact_email", "contact_phone",
    "website_url", "city", "state", "country", "about", "primary_color",
    "logo_url", "cover_url",
)

# Free-text profile fields and their max lengths (validated after trimming).
ORG_TEXT_LIMITS = {
    "name": 120,
    "full_name": 200,
    "tagline": 200,
    "contact_email": 254,
    "contact_phone": 40,
    "website_url": 2048,
    "city": 120,
    "state": 120,
    "country": 120,
    "about": 1000,
}

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")
_HEX_COLOR_RE = re.compile(r"^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$")


def _norm(value) -> str | None:
    """Trim a string; whitespace-only becomes null so we never store empty strings."""
    if value is None:
        return None
    trimmed = str(value).strip()
    return trimmed or None


async def _org_payload(organization_id: str) -> dict:
    """The org document with every profile key present (missing ones as null)."""
    org = await db.organizations.find_one({"id": organization_id}, {"_id": 0})
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found.")
    # Internal object keys are an implementation detail of the upload endpoints.
    org = {k: v for k, v in org.items() if k not in ("logo_storage_key", "cover_storage_key")}
    return clean({**{k: None for k in ORG_PROFILE_FIELDS}, **org})


@router.get("/organization")
async def get_org(user=Depends(get_current_user)):
    return await _org_payload(user["organization_id"])


class OrgUpdateBody(BaseModel):
    """Every field is tri-state: absent = leave alone, value = set, null/blank = clear."""
    name: str | None = None
    full_name: str | None = None
    tagline: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    website_url: str | None = None
    city: str | None = None
    state: str | None = None
    country: str | None = None
    about: str | None = None
    primary_color: str | None = None
    # logo_url is tri-state: absent = leave alone, string = set, null = clear.
    logo_url: str | None = None


@router.patch("/organization")
async def update_org(body: OrgUpdateBody, user=Depends(require_roles("owner"))):
    sent = body.model_fields_set
    updates: dict = {}
    for field, limit in ORG_TEXT_LIMITS.items():
        if field not in sent:
            continue
        value = _norm(getattr(body, field))
        if value is not None and len(value) > limit:
            raise HTTPException(status_code=422,
                                detail=f"{field} must be {limit} characters or fewer.")
        if field == "name" and value is None:
            raise HTTPException(status_code=422, detail="Organization name cannot be empty.")
        if field == "contact_email" and value is not None:
            value = value.lower()
            if not _EMAIL_RE.match(value):
                raise HTTPException(status_code=422,
                                    detail="contact_email must be a valid email address.")
        if field == "website_url" and value is not None and not value.lower().startswith(
                ("http://", "https://")):
            raise HTTPException(status_code=422,
                                detail="website_url must start with http:// or https://.")
        updates[field] = value
    if "primary_color" in sent:
        color = _norm(body.primary_color)
        if color is not None and not _HEX_COLOR_RE.match(color):
            raise HTTPException(status_code=422,
                                detail="primary_color must be a hex color like #DC2626.")
        updates["primary_color"] = color.upper() if color else None
    if "logo_url" in sent:
        logo = body.logo_url.strip() if isinstance(body.logo_url, str) else None
        if body.logo_url is not None and (
                not logo or not logo.lower().startswith("https://") or len(logo) > 2048):
            raise HTTPException(status_code=422,
                                detail="logo_url must be an https:// URL, or null to remove the logo.")
        updates["logo_url"] = logo
    if updates:
        updates["updated_at"] = now_iso()
        await db.organizations.update_one({"id": user["organization_id"]}, {"$set": updates})
        await log_audit(user["organization_id"], user, "organization_updated", "organization", user["organization_id"], updates)
    return {"message": "Organization updated."}


# ---------------- Organization logo & cover photo ----------------
# Org branding is not athlete media: no consent workflow, no athlete_media rows.
# The image lives in the tenant-scoped bucket prefix and is served back through
# an authenticated endpoint so the stored URL never expires.

ALLOWED_IMAGE = {".jpg", ".jpeg", ".png", ".webp", ".heic"}
MAX_ORG_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB
# Content type is derived from the validated extension, never from the client's
# declared type — an attacker-chosen type could otherwise be served back inline.
_IMAGE_CONTENT_TYPES = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".webp": "image/webp", ".heic": "image/heic",
}
# kind -> (public url field, internal storage key field)
ORG_IMAGE_KINDS = {
    "logo": ("logo_url", "logo_storage_key"),
    "cover": ("cover_url", "cover_storage_key"),
}


def _forget_object(key: str | None, keep: str | None = None) -> None:
    """Best-effort orphan cleanup — a storage hiccup must never fail the request."""
    if not key or key == keep:
        return
    try:
        storage.delete(key)
    except Exception as e:  # pragma: no cover - depends on backend availability
        print(f"[org-media] could not delete {key}: {e}")


async def _store_org_image(kind: str, file: UploadFile, user: dict) -> dict:
    url_field, key_field = ORG_IMAGE_KINDS[kind]
    org_id = user["organization_id"]
    # The client filename is used only to read an extension — the stored object
    # name is server-generated, so a hostile filename can't shape the key.
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_IMAGE:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {ext or '(none)'}. Use JPG, PNG, WEBP or HEIC.")
    declared = getattr(file, "size", None)
    if isinstance(declared, int) and declared > MAX_ORG_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image is too large (max 5 MB).")
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    if len(contents) > MAX_ORG_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image is too large (max 5 MB).")

    org = await db.organizations.find_one({"id": org_id}, {"_id": 0})
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found.")

    token = new_id()
    key = media_object_key(org_id, f"org-{kind}-{token}{ext}")
    content_type = _IMAGE_CONTENT_TYPES.get(ext, "application/octet-stream")
    storage.put(key, contents, content_type=content_type)
    # Stored as our own served path (never a presigned URL — those expire, and the
    # logo is on screen constantly). The version tag busts the browser cache when
    # the image is replaced behind a stable path.
    served_url = f"/api/organization/{kind}?v={token.replace('-', '')[:8]}"
    await db.organizations.update_one(
        {"id": org_id},
        {"$set": {url_field: served_url, key_field: key, "updated_at": now_iso()}},
    )
    _forget_object(org.get(key_field), keep=key)
    await log_audit(org_id, user, f"organization_{kind}_uploaded", "organization", org_id,
                    {"field": url_field, "url": served_url,
                     "size_bytes": len(contents), "content_type": content_type})
    return await _org_payload(org_id)


async def _clear_org_image(kind: str, user: dict) -> dict:
    url_field, key_field = ORG_IMAGE_KINDS[kind]
    org_id = user["organization_id"]
    org = await db.organizations.find_one({"id": org_id}, {"_id": 0})
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found.")
    await db.organizations.update_one(
        {"id": org_id},
        {"$set": {url_field: None, key_field: None, "updated_at": now_iso()}},
    )
    _forget_object(org.get(key_field))
    await log_audit(org_id, user, f"organization_{kind}_deleted", "organization", org_id,
                    {"field": url_field})
    return await _org_payload(org_id)


async def _serve_org_image(kind: str, user: dict):
    _, key_field = ORG_IMAGE_KINDS[kind]
    org = await db.organizations.find_one({"id": user["organization_id"]}, {"_id": 0})
    key = (org or {}).get(key_field)
    if not key:
        raise HTTPException(status_code=404, detail=f"No {kind} image set for this organization.")
    url = storage.presigned_get_url(key)
    if url:
        return RedirectResponse(url, status_code=302)
    path = storage.local_path(key)
    if not path:
        raise HTTPException(status_code=404, detail=f"Organization {kind} is missing from storage.")
    ext = os.path.splitext(key)[1].lower()
    return FileResponse(str(path), media_type=_IMAGE_CONTENT_TYPES.get(ext, "application/octet-stream"))


@router.post("/organization/logo")
async def upload_org_logo(file: UploadFile = File(...), user=Depends(require_roles("owner"))):
    return await _store_org_image("logo", file, user)


@router.post("/organization/cover")
async def upload_org_cover(file: UploadFile = File(...), user=Depends(require_roles("owner"))):
    return await _store_org_image("cover", file, user)


@router.delete("/organization/logo")
async def delete_org_logo(user=Depends(require_roles("owner"))):
    return await _clear_org_image("logo", user)


@router.delete("/organization/cover")
async def delete_org_cover(user=Depends(require_roles("owner"))):
    return await _clear_org_image("cover", user)


# Readable by ANY authenticated member of the org — staff, athletes and parents
# all see the org mark in the app shell, so this is deliberately not owner-only.
@router.get("/organization/logo")
async def get_org_logo(user=Depends(get_current_user)):
    return await _serve_org_image("logo", user)


@router.get("/organization/cover")
async def get_org_cover(user=Depends(get_current_user)):
    return await _serve_org_image("cover", user)


@router.get("/audit-logs")
async def audit_logs(limit: int = 100, user=Depends(require_roles("owner", "admin"))):
    logs = await db.audit_logs.find({"organization_id": user["organization_id"]}, {"_id": 0}).sort("created_at", -1).to_list(min(limit, 500))
    return logs
