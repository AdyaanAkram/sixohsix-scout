"""Open registration + player registry + org join codes + Google sign-in.

Model: self-signups live in a holding organization — the 60'6" Player Registry
(fixed id ORG_REGISTRY). They never touch a club's roster until either
  (a) a coach/admin searches the registry and adds them, or
  (b) the family enters the club's join code (lands as status "pending" for
      admin approval).
Both paths run permanent-ID matching first: if the club already has this
athlete (name + DOB), the family's account is LINKED to the existing record —
never a duplicate profile.

Google sign-in verifies the Google ID token server-side against
GOOGLE_CLIENT_ID; Google-created accounts have no password (password login
fails safely, Google login always works).
"""
from __future__ import annotations

import re
import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import (ADMIN_ROLES, COACH_ROLES, create_token, get_current_user,
                  hash_password, rate_limit, require_roles)
from config import settings
from db import clean, db, log_audit, new_id, now_iso
from notifications import notify

router = APIRouter(tags=["signup"])

from athlete_identity import find_duplicate

ORG_REGISTRY = "org-606-registry"
JOIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O/1/I/L lookalikes


async def _ensure_registry_org():
    if not await db.organizations.find_one({"id": ORG_REGISTRY}):
        await db.organizations.insert_one({
            "id": ORG_REGISTRY, "name": "60'6\" Player Registry",
            "created_at": now_iso(), "is_registry": True,
        })


def _new_join_code() -> str:
    return "606-" + "".join(secrets.choice(JOIN_CODE_ALPHABET) for _ in range(6))


async def _org_join_code(org_id: str) -> str:
    org = await db.organizations.find_one({"id": org_id}, {"_id": 0, "join_code": 1})
    code = (org or {}).get("join_code")
    if not code:
        code = _new_join_code()
        await db.organizations.update_one({"id": org_id}, {"$set": {"join_code": code}})
    return code


def _verify_google_credential(credential: str) -> dict:
    """Verify a Google ID token → {email, name}. 503 when not configured."""
    client_id = settings.google_client_id
    if not client_id:
        raise HTTPException(status_code=503,
                            detail="Google sign-in is not configured yet (GOOGLE_CLIENT_ID missing).")
    try:
        from google.auth.transport import requests as grequests
        from google.oauth2 import id_token
        info = id_token.verify_oauth2_token(credential, grequests.Request(), client_id)
    except Exception:
        raise HTTPException(status_code=401, detail="Google sign-in could not be verified. Try again.")
    email = (info.get("email") or "").lower().strip()
    if not email or not info.get("email_verified", True):
        raise HTTPException(status_code=401, detail="Google account has no verified email.")
    return {"email": email, "name": info.get("name") or email.split("@")[0]}


# ---------------- Public signup ----------------

class SignupAthlete(BaseModel):
    first_name: str = Field(min_length=1, max_length=60)
    last_name: str = Field(min_length=1, max_length=60)
    date_of_birth: str | None = None
    graduation_year: int | None = None
    primary_position: str | None = None
    city: str | None = None
    state: str | None = None


class SignupBody(BaseModel):
    kind: str  # "parent" | "athlete"
    full_name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=200)
    password: str | None = Field(default=None, min_length=8)
    google_credential: str | None = None
    athlete: SignupAthlete
    join_code: str | None = None


@router.post("/auth/signup")
async def signup(body: SignupBody):
    """Create a family account + registry player profile. Public endpoint."""
    rate_limit("signup:global", 30, 60)
    if body.kind not in ("parent", "athlete"):
        raise HTTPException(status_code=422, detail="kind must be parent or athlete.")
    if body.google_credential:
        g = _verify_google_credential(body.google_credential)
        email, password_hash = g["email"], None
    elif body.password:
        email, password_hash = body.email.lower().strip(), hash_password(body.password)
    else:
        raise HTTPException(status_code=422, detail="A password (or Google sign-in) is required.")
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise HTTPException(status_code=422, detail="Enter a valid email address.")
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="An account with this email already exists — sign in instead.")

    # Age gate: an athlete-run account requires being 13+ (COPPA-style rule the
    # invite flow already enforces). Under 13 or unknown DOB → parent account.
    from routes_athlete import athlete_age_years
    age = athlete_age_years({"date_of_birth": body.athlete.date_of_birth})
    if body.kind == "athlete" and (age is None or age < 13):
        raise HTTPException(
            status_code=422,
            detail="Athletes under 13 (or without a birth date) need a parent/guardian account.")

    await _ensure_registry_org()

    # Two parents signing their own child up separately is the single biggest
    # source of duplicate athletes — the evaluations then land on whichever
    # profile the club happened to score, and the other parent sees an empty
    # one. Check before creating anything, so a rejection leaves no orphan user.
    dup, verdict = await find_duplicate(
        db, ORG_REGISTRY, body.athlete.first_name.strip(),
        body.athlete.last_name.strip(), body.athlete.date_of_birth)
    if dup:
        who = f"{body.athlete.first_name.strip()} {body.athlete.last_name.strip()}".strip()
        # Deliberately says nothing about WHOSE account holds them.
        raise HTTPException(
            status_code=409,
            # Deliberately does NOT say "ask your club to add you": an athlete
            # carries a single guardian_user_id, so there is no second-parent
            # slot for staff to fill. Promising that would strand the family.
            detail=(
                f"{who} already has a 60'6\" ID. If this is your child, sign in with the "
                "email your family used to register them — try 'Forgot password' if you are "
                "not sure of the password. A second ID would start an empty profile and "
                "split their evaluations, so please use the original account or contact "
                "your club for help."
            ),
        )

    ts = now_iso()
    uid = new_id()
    await db.users.insert_one({
        "id": uid, "email": email, "full_name": body.full_name.strip(),
        "password_hash": password_hash, "active": True,
        "active_organization_id": ORG_REGISTRY,
        "created_at": ts, "updated_at": ts,
    })
    await db.memberships.insert_one({
        "id": new_id(), "user_id": uid, "organization_id": ORG_REGISTRY,
        "role": body.kind, "active": True, "created_at": ts,
    })
    from routes_players import AthleteBody, athlete_doc
    ath = AthleteBody(
        first_name=body.athlete.first_name.strip(),
        last_name=body.athlete.last_name.strip(),
        date_of_birth=body.athlete.date_of_birth,
        graduation_year=body.athlete.graduation_year,
        primary_position=body.athlete.primary_position,
        city=body.athlete.city, state=body.athlete.state,
        email=email if body.kind == "athlete" else None,
        guardian_name=body.full_name.strip() if body.kind == "parent" else None,
        guardian_email=email if body.kind == "parent" else None,
    )
    doc = athlete_doc(ath, ORG_REGISTRY, uid)
    doc["source"] = "self_signup"
    doc["self_service_enabled"] = True
    if body.kind == "athlete":
        doc["user_id"] = uid
    else:
        doc["guardian_user_id"] = uid
    await db.athletes.insert_one({**doc})
    await log_audit(ORG_REGISTRY, None, "self_signup", "athlete", doc["id"],
                    {"kind": body.kind, "email": email})

    active_org = ORG_REGISTRY
    joined = None
    if body.join_code:
        joined = await _join_org_by_code(uid, body.join_code)
        active_org = joined["organization_id"]
        await db.users.update_one({"id": uid}, {"$set": {"active_organization_id": active_org}})

    org = await db.organizations.find_one({"id": active_org}, {"_id": 0})
    return {
        "token": create_token(uid, active_org),
        "user": {"id": uid, "email": email, "full_name": body.full_name.strip(),
                 "role": body.kind, "organization_id": active_org,
                 "organization_name": (org or {}).get("name"),
                 "athlete_id": doc["id"]},
        "joined": joined,
    }


class GoogleBody(BaseModel):
    credential: str


@router.post("/auth/google")
async def google_signin(body: GoogleBody):
    """Google sign-in for EXISTING accounts. New Google users get needs_signup
    so the app can prefill the signup form."""
    rate_limit("google:global", 60, 60)
    g = _verify_google_credential(body.credential)
    user = await db.users.find_one({"email": g["email"]})
    if not user:
        return {"needs_signup": True, "email": g["email"], "name": g["name"]}
    if not user.get("active", True):
        raise HTTPException(status_code=403, detail="This account has been deactivated.")
    org_id = user.get("active_organization_id")
    m = await db.memberships.find_one({"user_id": user["id"], "organization_id": org_id, "active": True}) \
        or await db.memberships.find_one({"user_id": user["id"], "active": True})
    if not m:
        raise HTTPException(status_code=403, detail="No active organization membership for this account.")
    org = await db.organizations.find_one({"id": m["organization_id"]}, {"_id": 0})
    await log_audit(m["organization_id"], None, "google_signin", "user", user["id"], {"email": g["email"]})
    return {
        "token": create_token(user["id"], m["organization_id"]),
        "user": {"id": user["id"], "email": user["email"], "full_name": user.get("full_name"),
                 "role": m["role"], "organization_id": m["organization_id"],
                 "organization_name": (org or {}).get("name")},
    }


# ---------------- Joining an organization ----------------

async def _link_or_copy_athlete(target_org: str, reg_athlete: dict, *,
                                status: str) -> tuple[dict, bool]:
    """Match the registry athlete against the target org (name+DOB permanent-ID
    rule). Match → link the family's user ids onto the EXISTING athlete.
    No match → copy the profile in with the given status. Returns (athlete, linked)."""
    first, last = reg_athlete.get("first_name") or "", reg_athlete.get("last_name") or ""
    cand = None
    if first and last:
        q = {"organization_id": target_org, "status": {"$ne": "merged"},
             "first_name": {"$regex": f"^{re.escape(first)}$", "$options": "i"},
             "last_name": {"$regex": f"^{re.escape(last)}$", "$options": "i"}}
        for c in await db.athletes.find(q, {"_id": 0}).to_list(20):
            if reg_athlete.get("date_of_birth") and c.get("date_of_birth") == reg_athlete["date_of_birth"]:
                cand = c
                break
    link = {"self_service_enabled": True, "updated_at": now_iso()}
    if reg_athlete.get("user_id"):
        link["user_id"] = reg_athlete["user_id"]
    if reg_athlete.get("guardian_user_id"):
        link["guardian_user_id"] = reg_athlete["guardian_user_id"]
        if reg_athlete.get("guardian_name") and not (cand or {}).get("guardian_name"):
            link["guardian_name"] = reg_athlete.get("guardian_name")
        if reg_athlete.get("guardian_email") and not (cand or {}).get("guardian_email"):
            link["guardian_email"] = reg_athlete.get("guardian_email")
    if cand:
        await db.athletes.update_one({"id": cand["id"], "organization_id": target_org}, {"$set": link})
        return {**cand, **link}, True
    copy = {k: v for k, v in reg_athlete.items() if k not in ("_id",)}
    copy.update({"id": new_id(), "organization_id": target_org, "status": status,
                 "created_at": now_iso(), "updated_at": now_iso(), **link})
    await db.athletes.insert_one({**copy})
    return copy, False


async def _family_membership(uid: str, target_org: str):
    m = await db.memberships.find_one({"user_id": uid, "organization_id": ORG_REGISTRY})
    role = (m or {}).get("role") or "parent"
    if not await db.memberships.find_one({"user_id": uid, "organization_id": target_org}):
        await db.memberships.insert_one({
            "id": new_id(), "user_id": uid, "organization_id": target_org,
            "role": role, "active": True, "created_at": now_iso(),
        })


async def _join_org_by_code(uid: str, code: str) -> dict:
    org = await db.organizations.find_one(
        {"join_code": code.strip().upper(), "id": {"$ne": ORG_REGISTRY}}, {"_id": 0})
    if not org:
        raise HTTPException(status_code=404, detail="That join code doesn't match any organization. Double-check it with your coach.")
    reg_athletes = await db.athletes.find(
        {"organization_id": ORG_REGISTRY, "status": {"$ne": "merged"},
         "$or": [{"user_id": uid}, {"guardian_user_id": uid}]}, {"_id": 0}).to_list(20)
    if not reg_athletes:
        raise HTTPException(status_code=404, detail="No player profile on this account yet.")
    results = []
    for ra in reg_athletes:
        athlete, linked = await _link_or_copy_athlete(org["id"], ra, status="pending")
        results.append({"athlete_id": athlete["id"],
                        "name": f"{athlete.get('first_name','')} {athlete.get('last_name','')}".strip(),
                        "linked_existing": linked})
    await _family_membership(uid, org["id"])
    # tell the org's admins there's a signup to review
    admin_ids = [m["user_id"] for m in await db.memberships.find(
        {"organization_id": org["id"], "role": {"$in": list(ADMIN_ROLES)}, "active": True},
        {"_id": 0, "user_id": 1}).to_list(20)]
    names = ", ".join(r["name"] for r in results)
    for aid_ in admin_ids:
        await notify(aid_, "signup_pending", "New player signup to review",
                     f"{names} joined with your code — review under Players → Pending.",
                     {"athlete_ids": [r["athlete_id"] for r in results]})
    await log_audit(org["id"], None, "joined_by_code", "athlete", None,
                    {"user_id": uid, "athletes": [r["athlete_id"] for r in results]})
    return {"organization_id": org["id"], "organization_name": org.get("name"), "athletes": results}


class JoinBody(BaseModel):
    join_code: str


@router.post("/auth/join")
async def join_org(body: JoinBody, user=Depends(get_current_user)):
    if user.get("role") not in ("parent", "athlete"):
        raise HTTPException(status_code=403, detail="Join codes are for athlete and parent accounts.")
    joined = await _join_org_by_code(user["id"], body.join_code)
    await db.users.update_one({"id": user["id"]},
                              {"$set": {"active_organization_id": joined["organization_id"]}})
    return {**joined, "token": create_token(user["id"], joined["organization_id"])}


# ---------------- Org side: join code, registry search, add ----------------

@router.get("/organization/join-code")
async def get_join_code(user=Depends(require_roles(*ADMIN_ROLES))):
    return {"join_code": await _org_join_code(user["organization_id"])}


@router.post("/organization/join-code/regenerate")
async def regenerate_join_code(user=Depends(require_roles(*ADMIN_ROLES))):
    code = _new_join_code()
    await db.organizations.update_one({"id": user["organization_id"]}, {"$set": {"join_code": code}})
    await log_audit(user["organization_id"], user, "join_code_regenerated", "organization",
                    user["organization_id"], None)
    return {"join_code": code}


def _mask(email: str | None) -> str | None:
    if not email or "@" not in email:
        return None
    local, _, domain = email.partition("@")
    return f"{local[0]}***@{domain}"


@router.get("/registry/search")
async def registry_search(q: str, user=Depends(require_roles(*COACH_ROLES))):
    """Search self-registered players (name, min 2 chars). Contact emails are
    masked until the player is actually added to the org."""
    q = (q or "").strip()
    if len(q) < 2:
        return []
    await _ensure_registry_org()
    rx = {"$regex": re.escape(q), "$options": "i"}
    docs = await db.athletes.find(
        {"organization_id": ORG_REGISTRY, "status": {"$nin": ["merged", "archived"]},
         "$or": [{"first_name": rx}, {"last_name": rx}]},
        {"_id": 0}).to_list(25)
    out = []
    for a in docs:
        out.append({
            "registry_athlete_id": a["id"],
            "first_name": a.get("first_name"), "last_name": a.get("last_name"),
            "graduation_year": a.get("graduation_year"), "age_group": a.get("age_group"),
            "primary_position": a.get("primary_position"),
            "city": a.get("city"), "state": a.get("state"),
            "athlete_email_masked": _mask(a.get("email")),
            "guardian_email_masked": _mask(a.get("guardian_email")),
            "registered_at": a.get("created_at"),
        })
    return out


class RegistryAddBody(BaseModel):
    registry_athlete_id: str


@router.post("/registry/add")
async def registry_add(body: RegistryAddBody, user=Depends(require_roles(*COACH_ROLES))):
    """Coach/admin adds a registered player to their org. Links to an existing
    matching athlete when one exists; otherwise the profile joins as active."""
    org = user["organization_id"]
    if org == ORG_REGISTRY:
        raise HTTPException(status_code=400, detail="Switch to your organization first.")
    ra = await db.athletes.find_one(
        {"id": body.registry_athlete_id, "organization_id": ORG_REGISTRY}, {"_id": 0})
    if not ra:
        raise HTTPException(status_code=404, detail="Registered player not found.")
    athlete, linked = await _link_or_copy_athlete(org, ra, status="active")
    for uid in {ra.get("user_id"), ra.get("guardian_user_id")}:
        if uid:
            await _family_membership(uid, org)
            await notify(uid, "org_added",
                         f"Added to {user.get('organization_name') or 'an organization'}",
                         f"{athlete.get('first_name','')} {athlete.get('last_name','')} was added to "
                         f"{user.get('organization_name') or 'the organization'} — switch organizations to see it.",
                         {"athlete_id": athlete["id"]})
    await log_audit(org, user, "registry_player_added", "athlete", athlete["id"],
                    {"linked_existing": linked, "registry_athlete_id": ra["id"]})
    return {"athlete": clean(athlete), "linked_existing": linked}
