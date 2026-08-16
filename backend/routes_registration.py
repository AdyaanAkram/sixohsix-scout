"""Parent-first event registration + versioned consent records.

The registration link is the org-sanctioned entry point: a parent (or a
pre-authenticated returning family) registers an athlete DIRECTLY into the
event's organization, enrolls them on the event roster, and signs a set of
individually versioned consents — one consent document per consent type,
never a single generic boolean.

Consent versioning: bumping a version constant here means new registrations
record the new version while the audit trail keeps every athlete's actual
signed version forever.
"""
from __future__ import annotations

import re
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from auth import (ADMIN_ROLES, _load_user, create_token, decode_token,
                  get_current_user, hash_password, rate_limit, require_roles,
                  verify_password)
from db import clean, db, log_audit, new_id, now_iso

router = APIRouter(tags=["registration"])

WAIVER_VERSION = "2026-08-16.1"
PRIVACY_VERSION = "2026-08-16.1"
TERMS_VERSION = "2026-08-16.1"

PARTICIPATION_WAIVER_TEXT = (
    "I understand that participation in baseball evaluations, training, camps, "
    "clinics, athletic testing, running, throwing, hitting, fielding and related "
    "physical activities involves inherent risks, including the possibility of "
    "injury. I voluntarily permit the athlete identified in this registration to "
    "participate in the selected event, acknowledge these inherent risks, and "
    "understand that the athlete should not participate in an activity that "
    "cannot be performed safely. To the extent permitted by applicable law, I "
    "acknowledge and accept the risks inherent in participation and agree to the "
    "event's applicable participation terms and waiver."
)

REGISTRATION_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "UTIL"]

# Event statuses under which the public registration link no longer accepts entries.
CLOSED_EVENT_STATUSES = ("Closed", "Published", "Evaluation Complete", "Cancelled")

# Version each consent type is recorded under. One doc per type — NEVER a
# single generic "agreed to everything" boolean.
CONSENT_VERSION_FOR = {
    "participation_waiver": WAIVER_VERSION,
    "emergency_authorization": WAIVER_VERSION,
    "evaluation_media": WAIVER_VERSION,
    "promotional_media": WAIVER_VERSION,
    "public_profile": WAIVER_VERSION,
    "privacy_policy": PRIVACY_VERSION,
    "terms": TERMS_VERSION,
}


async def record_consents(org, athlete_id, event_id, user_id, consents: dict,
                          signature_name):
    """Write one consent document per consent type present in `consents`."""
    ts = now_iso()
    docs = []
    for ctype, version in CONSENT_VERSION_FOR.items():
        if ctype not in consents:
            continue
        docs.append({
            "id": new_id(),
            "organization_id": org,
            "athlete_id": athlete_id,
            "event_id": event_id,
            "user_id": user_id,
            "type": ctype,
            "granted": bool(consents[ctype]),
            "version": version,
            "signature_name": signature_name,
            "created_at": ts,
        })
    if docs:
        await db.consents.insert_many([dict(d) for d in docs])
    return docs


def validate_required_consents(consents: "RegConsents"):
    """422 unless the four participation-required consents are all granted.
    promotional_media / public_profile are optional — they never block."""
    if not (consents.participation_waiver and consents.emergency_authorization
            and consents.privacy_policy and consents.terms):
        raise HTTPException(
            status_code=422,
            detail="The participation waiver, emergency authorization, privacy "
                   "policy, and terms must all be accepted to register.")


def effective_public_profile(age: int | None, requested: bool, acting_role: str) -> bool:
    """Minors (or unknown age) default to NO public profile; only a
    parent/guardian account may explicitly grant it. Adults choose freely."""
    if age is None or age < 18:
        # Any adult account doing the registering (parent, or staff registering
        # their own child) may grant; an athlete-run account may not.
        return bool(requested) and acting_role != "athlete"
    return bool(requested)


# ---------------- Public: consent versions + event registration info ----------------

@router.get("/public/consent-versions")
async def consent_versions():
    """Current consent document versions + the canonical waiver acknowledgment
    text the registration form must display. Public — no auth."""
    return {
        "waiver_version": WAIVER_VERSION,
        "privacy_version": PRIVACY_VERSION,
        "terms_version": TERMS_VERSION,
        "participation_waiver_text": PARTICIPATION_WAIVER_TEXT,
    }


@router.get("/public/events/{event_id}/registration-info")
async def event_registration_info(event_id: str):
    """What a registration link needs to render its landing page. Public — no
    auth, and deliberately no roster or PII in the response."""
    event = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found.")
    org = await db.organizations.find_one(
        {"id": event.get("organization_id")}, {"_id": 0})
    return {
        "event": {
            "id": event["id"],
            "name": event.get("name"),
            "event_type": event.get("event_type"),
            "date": event.get("date"),
            "location": event.get("location"),
        },
        "organization": {
            "id": (org or {}).get("id"),
            "name": (org or {}).get("name"),
            "logo_url": (org or {}).get("logo_url"),
        },
        "positions": REGISTRATION_POSITIONS,
        "registration_open": event.get("status") not in CLOSED_EVENT_STATUSES,
    }


# ---------------- Registration body ----------------

class RegParent(BaseModel):
    first_name: str = Field(min_length=1, max_length=60)
    last_name: str = Field(min_length=1, max_length=60)
    relationship: str = Field(min_length=1, max_length=60)
    email: str = Field(min_length=3, max_length=200)
    phone: str = Field(min_length=1, max_length=40)
    preferred_communication: Literal["email", "sms", "both"] = "email"
    password: str | None = Field(default=None, min_length=8)
    google_credential: str | None = None


class RegAthlete(BaseModel):
    first_name: str = Field(min_length=1, max_length=60)
    last_name: str = Field(min_length=1, max_length=60)
    middle_name: str | None = None
    date_of_birth: str = Field(min_length=8, max_length=10)
    graduation_year: int
    current_grade: str | None = None
    email: str | None = None
    phone: str | None = None
    gender: str | None = None
    primary_position: str = Field(min_length=1)
    secondary_positions: list[str] = []
    bats: Literal["R", "L", "S"]
    throws: Literal["R", "L"]
    current_team: str | None = None
    school: str | None = None
    city: str | None = None
    state: str | None = None
    years_playing: int | None = None


class RegEmergencyContact(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    relationship: str = Field(min_length=1, max_length=60)
    phone: str = Field(min_length=1, max_length=40)


class RegConsents(BaseModel):
    participation_waiver: bool
    emergency_authorization: bool
    evaluation_media: bool
    promotional_media: bool
    privacy_policy: bool
    terms: bool
    public_profile: bool


class RegSignature(BaseModel):
    full_legal_name: str = Field(min_length=1, max_length=160)


class RegistrationBody(BaseModel):
    parent: RegParent | None = None
    athlete_id: str | None = None
    athlete: RegAthlete | None = None
    positions_evaluated: list[str]
    emergency_contact: RegEmergencyContact
    participation_notes: str | None = None
    consents: RegConsents
    signature: RegSignature


# ---------------- Helpers ----------------

async def _optional_family_user(request: Request) -> dict | None:
    """Resolve an OPTIONAL Authorization bearer token the way get_current_user
    does (decode_token → _load_user). No header → None (anonymous). A present
    but invalid token raises 401 rather than silently creating a new account."""
    header = (request.headers.get("authorization") or "").strip()
    if not header.lower().startswith("bearer "):
        return None
    token = header[7:].strip()
    if not token:
        return None
    payload = decode_token(token)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid authentication token.")
    user = await _load_user(user_id, payload.get("org"))
    # Any signed-in account may register kids it will guard — coaches and other
    # staff are parents too; the athlete links to THEIR user id as guardian.
    return user


async def _resolve_registering_user(body: RegistrationBody,
                                    pre_authed: dict | None) -> tuple[str, str, bool]:
    """Return (user_id, acting_role, created). Pre-authed caller wins; otherwise
    the parent block signs in (password / Google) or creates a new parent
    account — email dedupe mirrors routes_signup."""
    if pre_authed:
        return pre_authed["id"], pre_authed["role"], False
    if not body.parent:
        raise HTTPException(
            status_code=422,
            detail="Parent/guardian information is required (or sign in first).")
    p = body.parent
    if p.google_credential:
        from routes_signup import _verify_google_credential
        g = _verify_google_credential(p.google_credential)
        email, password_hash = g["email"], None
    else:
        email, password_hash = p.email.lower().strip(), None
        if p.password:
            password_hash = hash_password(p.password)
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise HTTPException(status_code=422, detail="Enter a valid email address.")
    existing = await db.users.find_one({"email": email})
    if existing:
        if not existing.get("active", True):
            raise HTTPException(status_code=403, detail="This account has been deactivated.")
        if p.google_credential:
            return existing["id"], "parent", False
        if p.password and verify_password(p.password, existing.get("password_hash") or ""):
            return existing["id"], "parent", False
        raise HTTPException(
            status_code=409,
            detail="An account with this email already exists. Sign in to the app first "
                   "and then open this registration link, or enter that account's "
                   "current password here.")
    if not password_hash:
        raise HTTPException(
            status_code=422,
            detail="A password (or Google sign-in) is required to create an account.")
    ts = now_iso()
    uid = new_id()
    await db.users.insert_one({
        "id": uid, "email": email,
        "full_name": f"{p.first_name.strip()} {p.last_name.strip()}",
        "password_hash": password_hash, "active": True,
        "phone": p.phone,
        "preferred_communication": p.preferred_communication,
        "created_at": ts, "updated_at": ts,
    })
    return uid, "parent", True


async def _ensure_membership(uid: str, org: str, role: str):
    if not await db.memberships.find_one({"user_id": uid, "organization_id": org}):
        await db.memberships.insert_one({
            "id": new_id(), "user_id": uid, "organization_id": org,
            "role": role, "active": True, "created_at": now_iso(),
        })


async def _age_group_for_event(org: str, event_id: str, age: int | None) -> str | None:
    """Match an athlete's age against event groups named like 'Ages 8-12' /
    'Ages 13-18', so registration drops them straight into the right group."""
    if age is None:
        return None
    groups = await db.event_groups.find(
        {"event_id": event_id, "organization_id": org}, {"_id": 0, "id": 1, "name": 1}).to_list(100)
    parsed = []
    for g in groups:
        m = re.match(r"^\s*ages?\s+(\d{1,2})\s*[-–]\s*(\d{1,2})\s*$", g.get("name") or "", re.I)
        if m:
            parsed.append((int(m.group(1)), int(m.group(2)), g["id"]))
    # Overlapping brackets ("8-10", "10-12"): the YOUNGER bracket wins the
    # boundary age, so sorting by lower bound and taking the first match is
    # deterministic (a 10-year-old lands in 8-10, a 14-year-old in 13-14).
    for lo, hi, gid in sorted(parsed):
        if lo <= age <= hi:
            return gid
    return None


async def _match_org_athlete(org: str, first: str, last: str, dob: str | None) -> dict | None:
    """The permanent-ID rule routes_signup._link_or_copy_athlete uses: exact
    name (case-insensitive) + exact DOB inside the target org."""
    if not (first and last and dob):
        return None
    q = {"organization_id": org, "status": {"$ne": "merged"},
         "first_name": {"$regex": f"^{re.escape(first)}$", "$options": "i"},
         "last_name": {"$regex": f"^{re.escape(last)}$", "$options": "i"}}
    for c in await db.athletes.find(q, {"_id": 0}).to_list(20):
        if c.get("date_of_birth") == dob:
            return c
    return None


# ---------------- Public: event registration ----------------

@router.post("/public/events/{event_id}/register")
async def register_for_event(event_id: str, body: RegistrationBody, request: Request):
    """Registration-link entry point: parent-first account, athlete profile
    directly in the event's org, roster enrollment, versioned consents."""
    rate_limit(f"event_register:{event_id}", 60, 60)

    event = await db.events.find_one({"id": event_id}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found.")
    org = event["organization_id"]
    if event.get("status") in CLOSED_EVENT_STATUSES:
        raise HTTPException(status_code=400, detail="Registration is closed for this event.")

    # Required consents + signature — checked before any write.
    validate_required_consents(body.consents)
    signature_name = body.signature.full_legal_name.strip()
    if not signature_name:
        raise HTTPException(status_code=422, detail="A full legal name signature is required.")

    # Positions to be evaluated at — validated, de-duped, order kept.
    positions = list(dict.fromkeys(p for p in body.positions_evaluated if p))
    bad = [p for p in positions if p not in REGISTRATION_POSITIONS]
    if not positions or bad:
        raise HTTPException(
            status_code=422,
            detail=f"positions_evaluated must be a non-empty subset of: "
                   f"{', '.join(REGISTRATION_POSITIONS)}")

    pre_authed = await _optional_family_user(request)
    uid, acting_role, created_account = await _resolve_registering_user(body, pre_authed)

    from routes_players import AthleteBody, athlete_doc, compute_age

    # ---- Resolve the athlete ----
    linked_existing = False
    if body.athlete_id:
        # Returning family reusing an athlete THEY own — any org, never recreated.
        owned = await db.athletes.find_one(
            {"id": body.athlete_id, "status": {"$ne": "merged"},
             "$or": [{"user_id": uid}, {"guardian_user_id": uid}]}, {"_id": 0})
        if not owned:
            raise HTTPException(status_code=404, detail="No athlete with that id on your account.")
        if owned["organization_id"] == org:
            athlete = owned
        else:
            from routes_signup import _link_or_copy_athlete
            athlete, linked_existing = await _link_or_copy_athlete(org, owned, status="active")
    else:
        if not body.athlete:
            raise HTTPException(status_code=422, detail="Athlete information is required.")
        a = body.athlete
        if compute_age(a.date_of_birth) is None:
            raise HTTPException(status_code=422, detail="Enter the birth date as YYYY-MM-DD.")
        if len(a.secondary_positions) > 2:
            raise HTTPException(status_code=422, detail="Choose at most two secondary positions.")
        athlete = await _match_org_athlete(org, a.first_name.strip(), a.last_name.strip(),
                                           a.date_of_birth)
        if athlete:
            linked_existing = True

    # Age is ALWAYS computed server-side from the DOB on record — never taken
    # from the client. Unknown DOB is treated as a minor (most restrictive).
    age = compute_age(athlete.get("date_of_birth") if athlete
                      else body.athlete.date_of_birth)
    public_profile = effective_public_profile(
        age, body.consents.public_profile, acting_role)

    parent_name = None
    parent_email = None
    parent_phone = None
    if body.parent:
        parent_name = f"{body.parent.first_name.strip()} {body.parent.last_name.strip()}"
        parent_email = body.parent.email.lower().strip()
        parent_phone = body.parent.phone
    elif pre_authed and acting_role == "parent":
        parent_name = pre_authed.get("full_name")
        parent_email = pre_authed.get("email")

    # Registration-day facts always refresh on the athlete record; guardian
    # linkage fills only when empty (never steal an existing guardian link).
    registration_fields = {
        "emergency_contact_name": body.emergency_contact.name,
        "emergency_contact_relationship": body.emergency_contact.relationship,
        "emergency_contact_phone": body.emergency_contact.phone,
        "participation_notes": body.participation_notes,
        "public_profile_enabled": public_profile,
    }

    if athlete:
        link = {**registration_fields, "self_service_enabled": True, "updated_at": now_iso()}
        if acting_role == "athlete" and not athlete.get("user_id"):
            link["user_id"] = uid
        if acting_role == "parent" and not athlete.get("guardian_user_id"):
            link["guardian_user_id"] = uid
        if parent_name and not athlete.get("guardian_name"):
            link["guardian_name"] = parent_name
        if parent_email and not athlete.get("guardian_email"):
            link["guardian_email"] = parent_email
        if parent_phone and not athlete.get("guardian_phone"):
            link["guardian_phone"] = parent_phone
        await db.athletes.update_one(
            {"id": athlete["id"], "organization_id": org}, {"$set": link})
        athlete = {**athlete, **link}
    else:
        a = body.athlete
        ath = AthleteBody(
            first_name=a.first_name.strip(), last_name=a.last_name.strip(),
            middle_name=a.middle_name,
            date_of_birth=a.date_of_birth, graduation_year=a.graduation_year,
            current_grade=a.current_grade, gender=a.gender,
            email=a.email, phone=a.phone,
            primary_position=a.primary_position,
            secondary_positions=a.secondary_positions,
            bats=a.bats, throws=a.throws,
            current_team=a.current_team, school=a.school,
            city=a.city, state=a.state,
            years_playing=a.years_playing,
            guardian_name=parent_name, guardian_email=parent_email,
            guardian_phone=parent_phone,
            emergency_contact_name=body.emergency_contact.name,
            emergency_contact_relationship=body.emergency_contact.relationship,
            emergency_contact_phone=body.emergency_contact.phone,
            participation_notes=body.participation_notes,
            public_profile_enabled=public_profile,
            status="active",
        )
        doc = athlete_doc(ath, org, uid)
        doc["source"] = "event_registration"
        doc["self_service_enabled"] = True
        if acting_role == "athlete":
            doc["user_id"] = uid
        else:
            doc["guardian_user_id"] = uid
        await db.athletes.insert_one({**doc})
        athlete = doc

    # 13-18 (Performance track): evaluated at 1-2 positions max, per the spec.
    athlete_age = compute_age(athlete.get("date_of_birth"))
    if athlete_age is not None and athlete_age >= 13 and len(positions) > 2:
        raise HTTPException(
            status_code=422,
            detail="Athletes 13 and older are evaluated at up to 2 positions — "
                   "pick their best one or two.")

    # Auto-place into the event's age group ("Ages 8-12" / "Ages 13-18" style
    # names) so a registered 14-year-old is grouped and evaluation-ready with
    # zero admin steps. No matching group -> unassigned, exactly as before.
    auto_group_id = await _age_group_for_event(org, event_id, athlete_age)

    # ---- Enroll on the event roster (same doc shape the CSV import writes) ----
    rostered = await db.event_athletes.find_one(
        {"event_id": event_id, "athlete_id": athlete["id"], "organization_id": org})
    if rostered:
        patch = {}
        if not rostered.get("positions_evaluated"):
            patch["positions_evaluated"] = positions
        if not rostered.get("group_id") and auto_group_id:
            patch["group_id"] = auto_group_id
        if patch:
            patch["updated_at"] = now_iso()
            await db.event_athletes.update_one({"id": rostered["id"]}, {"$set": patch})
    else:
        await db.event_athletes.insert_one({
            "id": new_id(), "organization_id": org,
            "event_id": event_id, "athlete_id": athlete["id"], "status": "registered",
            "bib_number": None, "group_id": auto_group_id, "late_arrival": False,
            "flagged_incomplete": False, "walk_up": False,
            "positions_evaluated": positions,
            "created_at": now_iso(), "updated_at": now_iso(),
        })

    # ---- Consents (public_profile records the EFFECTIVE grant) ----
    consents_effective = {**body.consents.model_dump(), "public_profile": public_profile}
    await record_consents(org, athlete["id"], event_id, uid, consents_effective,
                         signature_name)

    await _ensure_membership(uid, org, acting_role if acting_role in ("parent", "athlete") else "parent")

    await log_audit(org, None, "event_registration", "athlete", athlete["id"], {
        "event_id": event_id, "user_id": uid,
        "linked_existing": linked_existing, "created_account": created_account,
        "positions_evaluated": positions,
    })

    out = {
        "athlete_id": athlete["id"],
        "event": {"id": event["id"], "name": event.get("name"),
                  "date": event.get("date"), "location": event.get("location")},
        "positions_evaluated": positions,
        "summary": {
            "athlete_name": f"{athlete.get('first_name', '')} {athlete.get('last_name', '')}".strip(),
            "dob": athlete.get("date_of_birth"),
            "graduation_year": athlete.get("graduation_year"),
            "bats": athlete.get("bats"),
            "throws": athlete.get("throws"),
            "primary_position": athlete.get("primary_position"),
            "secondary_positions": athlete.get("secondary_positions") or [],
        },
    }
    if not pre_authed:
        out["token"] = create_token(uid, org)
    return out


# ---------------- Returning families: my athletes across orgs ----------------

@router.get("/me/athletes")
async def my_athletes(event_id: str | None = None, user=Depends(get_current_user)):
    """Every athlete (in ANY org) owned by the caller — lets a returning family
    pick an existing athlete instead of re-entering the profile. Pass event_id
    to learn which of them are already registered for that event."""

    rows = await db.athletes.find(
        {"status": {"$ne": "merged"},
         "$or": [{"user_id": user["id"]}, {"guardian_user_id": user["id"]}]},
        {"_id": 0}).to_list(100)
    on_event_ids = set()
    if event_id and rows:
        entries = await db.event_athletes.find(
            {"event_id": event_id, "athlete_id": {"$in": [r["id"] for r in rows]}},
            {"_id": 0, "athlete_id": 1}).to_list(200)
        on_event_ids = {e["athlete_id"] for e in entries}
    org_ids = sorted({r.get("organization_id") for r in rows if r.get("organization_id")})
    org_names = {}
    if org_ids:
        orgs = await db.organizations.find(
            {"id": {"$in": org_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(len(org_ids))
        org_names = {o["id"]: o.get("name") for o in orgs}
    return [{
        "id": r["id"],
        "organization_id": r.get("organization_id"),
        "organization_name": org_names.get(r.get("organization_id")),
        "first_name": r.get("first_name"),
        "last_name": r.get("last_name"),
        "date_of_birth": r.get("date_of_birth"),
        "graduation_year": r.get("graduation_year"),
        "primary_position": r.get("primary_position"),
        "secondary_positions": r.get("secondary_positions") or [],
        "bats": r.get("bats"),
        "throws": r.get("throws"),
        "on_event": r["id"] in on_event_ids,
    } for r in rows]


# ---------------- Admin: consent audit trail ----------------

@router.get("/athletes/{athlete_id}/consents")
async def athlete_consents(athlete_id: str, user=Depends(require_roles(*ADMIN_ROLES))):
    """One athlete's full consent audit trail — org-scoped, newest first."""
    org = user["organization_id"]
    if not await db.athletes.find_one({"id": athlete_id, "organization_id": org},
                                      {"_id": 0, "id": 1}):
        raise HTTPException(status_code=404, detail="Player not found.")
    rows = await db.consents.find(
        {"athlete_id": athlete_id, "organization_id": org},
        {"_id": 0}).sort("created_at", -1).to_list(500)
    return clean(rows)
