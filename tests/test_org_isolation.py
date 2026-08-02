"""Org isolation regression suite.

Seeds two organisations and asserts every cross-org read returns 403 or 404 —
never 200 with the other tenant's data. List endpoints must return only own-org rows.

Run (against a live backend with MONGO on localhost):
  cd backend && source .venv/bin/activate
  pytest ../tests/test_org_isolation.py -n 0 -q

Or as a script:
  python ../tests/test_org_isolation.py
"""
from __future__ import annotations

import os
import sys
import uuid

import pytest
import requests

BASE = os.environ.get("PBG_API_BASE", "http://127.0.0.1:8000/api")
PASSWORD = "IsoTest2026!"


def _uid(prefix=""):
    return f"{prefix}{uuid.uuid4().hex[:10]}"


@pytest.fixture(scope="module")
def tenants():
    """Create two orgs with admin + athlete each via direct Mongo seed, then login."""
    # Prefer motor against local Mongo so we don't depend on public signup APIs
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "pbg_scout_local")

    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient
    from auth import hash_password, create_token
    from db import now_iso

    async def seed():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        suffix = uuid.uuid4().hex[:6]
        orgs = []
        for label in ("A", "B"):
            org_id = f"org-iso-{label.lower()}-{suffix}"
            admin_id = f"user-iso-admin-{label.lower()}-{suffix}"
            athlete_id = f"ath-iso-{label.lower()}-{suffix}"
            event_id = f"evt-iso-{label.lower()}-{suffix}"
            tmpl_id = f"tmpl-iso-{label.lower()}-{suffix}"
            email = f"iso.admin.{label.lower()}.{suffix}@example.com"

            await db.organizations.delete_many({"id": org_id})
            await db.users.delete_many({"id": admin_id})
            await db.memberships.delete_many({"organization_id": org_id})
            await db.athletes.delete_many({"organization_id": org_id})
            await db.events.delete_many({"organization_id": org_id})
            await db.evaluation_templates.delete_many({"organization_id": org_id})
            await db.evaluations.delete_many({"organization_id": org_id})
            await db.athlete_media.delete_many({"organization_id": org_id})
            await db.verified_metrics.delete_many({"organization_id": org_id})
            await db.milestones.delete_many({"organization_id": org_id})
            await db.awards.delete_many({"organization_id": org_id})
            await db.drills.delete_many({"organization_id": org_id})
            await db.development_plans.delete_many({"organization_id": org_id})
            await db.event_invites.delete_many({"organization_id": org_id})
            await db.notifications.delete_many({"user_id": admin_id})

            await db.organizations.insert_one({
                "id": org_id, "name": f"Iso League {label}", "tagline": "isolation",
                "created_at": now_iso(),
            })
            await db.users.insert_one({
                "id": admin_id, "email": email, "full_name": f"Admin {label}",
                "password_hash": hash_password(PASSWORD), "active": True,
                "created_at": now_iso(), "updated_at": now_iso(),
            })
            await db.memberships.insert_one({
                "id": f"mem-{admin_id}", "user_id": admin_id, "organization_id": org_id,
                "role": "admin", "active": True, "created_at": now_iso(),
            })
            await db.athletes.insert_one({
                "id": athlete_id, "organization_id": org_id,
                "first_name": f"Athlete{label}", "last_name": "Iso",
                "primary_position": "SS" if label == "A" else "C",
                "shared_with_organizations": [], "status": "active",
                "created_at": now_iso(), "updated_at": now_iso(),
            })
            await db.events.insert_one({
                "id": event_id, "organization_id": org_id, "name": f"Event {label}",
                "event_type": "Evaluation", "date": "2026-08-16", "status": "Evaluation Active",
                "created_at": now_iso(), "updated_at": now_iso(),
            })
            await db.evaluation_templates.insert_one({
                "id": tmpl_id, "organization_id": org_id, "name": f"Template {label}",
                "applies_to_positions": [], "is_default": True, "template_version": 1,
                "categories": [], "metrics": [],
                "created_at": now_iso(), "updated_at": now_iso(),
            })
            station_id = f"stn-iso-{label.lower()}-{suffix}"
            await db.stations.insert_one({
                "id": station_id, "organization_id": org_id, "event_id": event_id,
                "name": f"Station {label}", "template_id": tmpl_id,
                "created_at": now_iso(), "updated_at": now_iso(),
            })
            eval_id = f"eval-iso-{label.lower()}-{suffix}"
            await db.evaluations.insert_one({
                "id": eval_id, "organization_id": org_id, "event_id": event_id,
                "station_id": station_id,
                "athlete_id": athlete_id, "template_id": tmpl_id, "template_version": 1,
                "evaluator_id": admin_id, "status": "draft", "scores": {},
                "comments": {"strengths": "", "development_needs": "", "general": "", "quick_tags": []},
                "created_at": now_iso(), "updated_at": now_iso(),
            })
            media_id = f"media-iso-{label.lower()}-{suffix}"
            await db.athlete_media.insert_one({
                "id": media_id, "organization_id": org_id, "athlete_id": athlete_id,
                "file_type": "photo", "stored_name": "missing.jpg", "file_name": "x.jpg",
                "consent_verified": True, "created_at": now_iso(),
            })
            program_id = f"prog-iso-{label.lower()}-{suffix}"
            await db.programs.insert_one({
                "id": program_id, "organization_id": org_id, "name": f"Camp {label}",
                "type": "camp", "status": "open", "created_at": now_iso(), "updated_at": now_iso(),
            })
            metric_id = f"met-iso-{label.lower()}-{suffix}"
            await db.verified_metrics.insert_one({
                "id": metric_id, "organization_id": org_id, "athlete_id": athlete_id,
                "metric_key": "exit_velo", "value": 70.0 if label == "A" else 71.0, "unit": "mph",
                "verified_by": admin_id, "measured_at": "2026-07-01", "created_at": now_iso(),
            })
            award_id = f"awd-iso-{label.lower()}-{suffix}"
            await db.awards.insert_one({
                "id": award_id, "organization_id": org_id, "athlete_id": athlete_id,
                "title": f"Award {label}", "category": "overall", "status": "pending",
                "submitted_by": admin_id, "created_at": now_iso(),
            })
            invite_id = f"einv-iso-{label.lower()}-{suffix}"
            await db.event_invites.insert_one({
                "id": invite_id, "organization_id": org_id, "event_id": event_id,
                "code": f"ISO{label}{suffix[:3]}".upper()[:6], "role": "evaluator",
                "revoked": False, "invited_at": now_iso(), "expires_at": "2099-01-01T00:00:00+00:00",
            })
            orgs.append({
                "label": label, "org_id": org_id, "email": email, "admin_id": admin_id,
                "athlete_id": athlete_id, "event_id": event_id, "tmpl_id": tmpl_id,
                "eval_id": eval_id, "media_id": media_id, "station_id": station_id,
                "program_id": program_id, "metric_id": metric_id, "award_id": award_id,
                "invite_id": invite_id,
            })
        return orgs

    data = asyncio.run(seed())
    # login
    for o in data:
        r = requests.post(f"{BASE}/auth/login", json={"email": o["email"], "password": PASSWORD}, timeout=10)
        assert r.status_code == 200, r.text
        o["headers"] = {"Authorization": f"Bearer {r.json()['token']}"}
    return {"A": data[0], "B": data[1]}


def _assert_denied(resp, name):
    assert resp.status_code in (403, 404), f"{name}: expected 403/404, got {resp.status_code} body={resp.text[:200]}"


# Parameterised cross-org read endpoints: (name, method, path_builder using other tenant)
CROSS_ORG_READS = [
    ("get_athlete", "GET", lambda o: f"/athletes/{o['athlete_id']}"),
    ("get_event", "GET", lambda o: f"/events/{o['event_id']}"),
    ("get_template", "GET", lambda o: f"/templates/{o['tmpl_id']}"),
    ("get_evaluation", "GET", lambda o: f"/evaluations/{o['eval_id']}"),
    ("get_media_file", "GET", lambda o: f"/media/{o['media_id']}/file"),
    ("athlete_summary", "GET", lambda o: f"/athletes/{o['athlete_id']}/summary"),
    ("athlete_timeline", "GET", lambda o: f"/athletes/{o['athlete_id']}/timeline"),
    ("athlete_media_list", "GET", lambda o: f"/athletes/{o['athlete_id']}/media"),
    ("player_pdf", "GET", lambda o: f"/reports/player/{o['athlete_id']}/pdf"),
    ("event_roster", "GET", lambda o: f"/events/{o['event_id']}/roster"),
    ("event_completion", "GET", lambda o: f"/reports/event-completion/{o['event_id']}"),
    ("get_program", "GET", lambda o: f"/programs/{o['program_id']}"),
    ("athlete_metrics", "GET", lambda o: f"/metrics/athlete/{o['athlete_id']}"),
    ("athlete_milestones", "GET", lambda o: f"/milestones/athlete/{o['athlete_id']}"),
    ("athlete_awards", "GET", lambda o: f"/awards/athlete/{o['athlete_id']}"),
    ("event_invites", "GET", lambda o: f"/events/{o['event_id']}/invites"),
    ("dev_plan_latest", "GET", lambda o: f"/athletes/{o['athlete_id']}/development-plan/latest"),
]


@pytest.mark.parametrize("name,method,path_fn", CROSS_ORG_READS, ids=[c[0] for c in CROSS_ORG_READS])
def test_cross_org_reads_denied(tenants, name, method, path_fn):
    a, b = tenants["A"], tenants["B"]
    # A requesting B's resource
    url = BASE + path_fn(b)
    resp = requests.request(method, url, headers=a["headers"], timeout=10)
    _assert_denied(resp, f"A→B {name}")
    # B requesting A's resource
    url = BASE + path_fn(a)
    resp = requests.request(method, url, headers=b["headers"], timeout=10)
    _assert_denied(resp, f"B→A {name}")


def test_list_athletes_scoped(tenants):
    a, b = tenants["A"], tenants["B"]
    ra = requests.get(f"{BASE}/athletes", headers=a["headers"], timeout=10)
    rb = requests.get(f"{BASE}/athletes", headers=b["headers"], timeout=10)
    assert ra.status_code == 200 and rb.status_code == 200
    ids_a = {x["id"] for x in ra.json()}
    ids_b = {x["id"] for x in rb.json()}
    assert a["athlete_id"] in ids_a
    assert b["athlete_id"] not in ids_a
    assert b["athlete_id"] in ids_b
    assert a["athlete_id"] not in ids_b


def test_list_events_scoped(tenants):
    a, b = tenants["A"], tenants["B"]
    ra = requests.get(f"{BASE}/events", headers=a["headers"], timeout=10)
    rb = requests.get(f"{BASE}/events", headers=b["headers"], timeout=10)
    assert ra.status_code == 200 and rb.status_code == 200
    ids_a = {x["id"] for x in ra.json()}
    ids_b = {x["id"] for x in rb.json()}
    assert a["event_id"] in ids_a and b["event_id"] not in ids_a
    assert b["event_id"] in ids_b and a["event_id"] not in ids_b


def test_list_templates_scoped(tenants):
    a, b = tenants["A"], tenants["B"]
    ra = requests.get(f"{BASE}/templates", headers=a["headers"], timeout=10)
    rb = requests.get(f"{BASE}/templates", headers=b["headers"], timeout=10)
    assert ra.status_code == 200 and rb.status_code == 200
    ids_a = {x["id"] for x in ra.json()}
    ids_b = {x["id"] for x in rb.json()}
    assert a["tmpl_id"] in ids_a and b["tmpl_id"] not in ids_a
    assert b["tmpl_id"] in ids_b and a["tmpl_id"] not in ids_b


def test_list_programs_scoped(tenants):
    a, b = tenants["A"], tenants["B"]
    ra = requests.get(f"{BASE}/programs", headers=a["headers"], timeout=10)
    rb = requests.get(f"{BASE}/programs", headers=b["headers"], timeout=10)
    assert ra.status_code == 200 and rb.status_code == 200
    ids_a = {x["id"] for x in ra.json()}
    ids_b = {x["id"] for x in rb.json()}
    assert a["program_id"] in ids_a and b["program_id"] not in ids_a
    assert b["program_id"] in ids_b and a["program_id"] not in ids_b


def test_program_enroll_and_session(tenants):
    a = tenants["A"]
    # add session
    s = requests.post(
        f"{BASE}/programs/{a['program_id']}/sessions",
        headers=a["headers"],
        json={"date": "2026-09-01", "focus": "Velo"},
        timeout=10,
    )
    assert s.status_code == 200, s.text
    # enroll own athlete
    e = requests.post(
        f"{BASE}/programs/{a['program_id']}/enrollments",
        headers=a["headers"],
        json={"athlete_id": a["athlete_id"]},
        timeout=10,
    )
    assert e.status_code == 200, e.text
    # cannot enroll other org athlete into own program
    b = tenants["B"]
    cross = requests.post(
        f"{BASE}/programs/{a['program_id']}/enrollments",
        headers=a["headers"],
        json={"athlete_id": b["athlete_id"]},
        timeout=10,
    )
    assert cross.status_code in (403, 404)


def test_own_reads_ok(tenants):
    a = tenants["A"]
    for name, method, path_fn in CROSS_ORG_READS:
        if name in ("get_media_file", "player_pdf", "dev_plan_latest"):
            # media/pdf may 404 if file missing; plan 404 until generated — not a cross-tenant leak
            continue
        resp = requests.request(method, BASE + path_fn(a), headers=a["headers"], timeout=10)
        assert resp.status_code == 200, f"own {name} failed: {resp.status_code} {resp.text[:200]}"


def test_metrics_and_drills_scoped(tenants):
    a, b = tenants["A"], tenants["B"]
    ra = requests.get(f"{BASE}/metrics/athlete/{a['athlete_id']}", headers=a["headers"], timeout=10)
    assert ra.status_code == 200
    assert all(m["athlete_id"] == a["athlete_id"] for m in ra.json())
    cross = requests.get(f"{BASE}/metrics/athlete/{b['athlete_id']}", headers=a["headers"], timeout=10)
    _assert_denied(cross, "metrics cross-org")

    da = requests.get(f"{BASE}/drills", headers=a["headers"], timeout=10)
    db_ = requests.get(f"{BASE}/drills", headers=b["headers"], timeout=10)
    assert da.status_code == 200 and db_.status_code == 200
    ids_a = {d["id"] for d in da.json()}
    ids_b = {d["id"] for d in db_.json()}
    assert ids_a.isdisjoint(ids_b)
    # ensure org A cannot approve B award
    deny = requests.post(f"{BASE}/awards/{b['award_id']}/approve", headers=a["headers"], timeout=10)
    _assert_denied(deny, "approve award cross-org")
    # ensure invite list is scoped
    inv_a = requests.get(f"{BASE}/events/{a['event_id']}/invites", headers=a["headers"], timeout=10)
    assert inv_a.status_code == 200
    assert all(i["event_id"] == a["event_id"] for i in inv_a.json())
    deny_inv = requests.get(f"{BASE}/events/{b['event_id']}/invites", headers=a["headers"], timeout=10)
    _assert_denied(deny_inv, "event invites cross-org")


def test_metric_pb_creates_milestone_in_own_org(tenants):
    a = tenants["A"]
    r = requests.post(
        f"{BASE}/metrics",
        headers=a["headers"],
        json={"athlete_id": a["athlete_id"], "metric_key": "exit_velo", "value": 99.5, "source": "iso-test"},
        timeout=10,
    )
    assert r.status_code == 200, r.text
    assert r.json().get("is_personal_best") is True
    ms = requests.get(f"{BASE}/milestones/athlete/{a['athlete_id']}", headers=a["headers"], timeout=10)
    assert ms.status_code == 200
    assert any(m.get("kind") == "personal_best" and m.get("value") == 99.5 for m in ms.json())


@pytest.fixture(scope="module")
def athlete_users(tenants):
    """Link athlete portal users for org A and B."""
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "pbg_scout_local")

    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient
    from auth import hash_password
    from db import now_iso

    async def seed():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        out = {}
        for key in ("A", "B"):
            t = tenants[key]
            uid = f"user-ath-{key.lower()}-{uuid.uuid4().hex[:6]}"
            email = f"iso.athlete.{key.lower()}.{uuid.uuid4().hex[:6]}@example.com"
            await db.users.insert_one({
                "id": uid, "email": email, "full_name": f"Portal Athlete {key}",
                "password_hash": hash_password(PASSWORD), "active": True,
                "created_at": now_iso(), "updated_at": now_iso(),
            })
            await db.memberships.insert_one({
                "id": f"mem-{uid}", "user_id": uid, "organization_id": t["org_id"],
                "role": "athlete", "active": True, "created_at": now_iso(),
            })
            await db.athletes.update_one(
                {"id": t["athlete_id"]},
                {"$set": {"user_id": uid, "self_service_enabled": True, "email": email, "bio": "seed"}},
            )
            out[key] = {"user_id": uid, "email": email, "athlete_id": t["athlete_id"], "org_id": t["org_id"]}
        return out

    data = asyncio.run(seed())
    for key, o in data.items():
        r = requests.post(f"{BASE}/auth/login", json={"email": o["email"], "password": PASSWORD}, timeout=10)
        assert r.status_code == 200, r.text
        o["headers"] = {"Authorization": f"Bearer {r.json()['token']}"}
    return data


def test_athlete_cannot_read_other_athlete(athlete_users, tenants):
    a_ath = athlete_users["A"]
    b = tenants["B"]
    # Athlete A hitting B's athlete record
    resp = requests.get(f"{BASE}/athletes/{b['athlete_id']}", headers=a_ath["headers"], timeout=10)
    _assert_denied(resp, "athleteA→athleteB")
    # Athlete A me endpoints must resolve only own athlete
    me = requests.get(f"{BASE}/me/athlete", headers=a_ath["headers"], timeout=10)
    assert me.status_code == 200
    assert me.json()["id"] == a_ath["athlete_id"]


def test_athlete_staff_endpoints_forbidden(athlete_users, tenants):
    a_ath = athlete_users["A"]
    a = tenants["A"]
    staff_paths = [
        "/athletes",
        f"/events/{a['event_id']}",
        "/templates",
        "/staff",
        "/review/queue",
        f"/evaluations/{a['eval_id']}",
        "/reports/event-completion/" + a["event_id"],
    ]
    for path in staff_paths:
        resp = requests.get(f"{BASE}{path}", headers=a_ath["headers"], timeout=10)
        _assert_denied(resp, f"athlete staff {path}")


def test_athlete_patch_rejects_privileged_fields(athlete_users):
    a_ath = athlete_users["A"]
    for payload in (
        {"primary_position": "P"},
        {"organization_id": "org-evil"},
        {"bio": "ok", "primary_position": "C"},
    ):
        resp = requests.patch(f"{BASE}/me/athlete", json=payload, headers=a_ath["headers"], timeout=10)
        assert resp.status_code == 422, f"expected 422 for {payload}, got {resp.status_code} {resp.text[:200]}"
    ok = requests.patch(f"{BASE}/me/athlete", json={"bio": "Updated bio"}, headers=a_ath["headers"], timeout=10)
    assert ok.status_code == 200
    assert ok.json().get("bio") == "Updated bio"


def test_owner_can_switch_organizations(tenants):
    """Same user with two memberships must only see the active org's athletes."""
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient
    from auth import hash_password
    from db import now_iso

    a, b = tenants["A"], tenants["B"]

    async def link_owner_to_both():
        client = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
        db = client[os.environ.get("DB_NAME", "pbg_scout_local")]
        email = f"iso.multi.{uuid.uuid4().hex[:6]}@example.com"
        uid = f"user-multi-{uuid.uuid4().hex[:6]}"
        await db.users.insert_one({
            "id": uid, "email": email, "full_name": "Multi Org Owner",
            "password_hash": hash_password(PASSWORD), "active": True,
            "active_organization_id": a["org_id"],
            "created_at": now_iso(), "updated_at": now_iso(),
        })
        for org_id, role in ((a["org_id"], "owner"), (b["org_id"], "owner")):
            await db.memberships.insert_one({
                "id": f"mem-{uid}-{org_id[-6:]}", "user_id": uid, "organization_id": org_id,
                "role": role, "active": True, "created_at": now_iso(),
            })
        return email

    email = asyncio.run(link_owner_to_both())
    login = requests.post(f"{BASE}/auth/login", json={"email": email, "password": PASSWORD}, timeout=10)
    assert login.status_code == 200, login.text
    assert len(login.json()["user"]["memberships"]) == 2
    tok = login.json()["token"]
    headers = {"Authorization": f"Bearer {tok}"}
    # start in A
    ath_a = requests.get(f"{BASE}/athletes", headers=headers, timeout=10)
    assert ath_a.status_code == 200
    assert {x["id"] for x in ath_a.json()} == {a["athlete_id"]}
    # switch to B
    sw = requests.post(
        f"{BASE}/auth/switch-organization",
        headers=headers,
        json={"organization_id": b["org_id"]},
        timeout=10,
    )
    assert sw.status_code == 200, sw.text
    assert sw.json()["user"]["organization_id"] == b["org_id"]
    headers_b = {"Authorization": f"Bearer {sw.json()['token']}"}
    ath_b = requests.get(f"{BASE}/athletes", headers=headers_b, timeout=10)
    assert ath_b.status_code == 200
    ids_b = {x["id"] for x in ath_b.json()}
    assert b["athlete_id"] in ids_b
    assert a["athlete_id"] not in ids_b


def test_expired_invitation_rejected(tenants):
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
    import asyncio
    from datetime import datetime, timedelta, timezone
    from motor.motor_asyncio import AsyncIOMotorClient
    from db import now_iso, new_id

    a = tenants["A"]

    async def seed_expired():
        client = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
        db = client[os.environ.get("DB_NAME", "pbg_scout_local")]
        token = f"expired-{uuid.uuid4().hex}"
        inv_id = new_id()
        await db.invitations.insert_one({
            "id": inv_id, "organization_id": a["org_id"],
            "email": f"expired.{uuid.uuid4().hex[:6]}@example.com",
            "full_name": "Expired Invite", "role": "athlete",
            "athlete_id": a["athlete_id"], "token": token, "status": "pending",
            "expires_at": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(),
            "created_at": now_iso(),
        })
        return token

    token = asyncio.run(seed_expired())
    lookup = requests.get(f"{BASE}/invitations/lookup/{token}", timeout=10)
    assert lookup.status_code in (400, 404), lookup.text
    accept = requests.post(
        f"{BASE}/auth/accept-invitation",
        json={"token": token, "password": "ExpiredPass1!"},
        timeout=10,
    )
    assert accept.status_code in (400, 404), accept.text


if __name__ == "__main__":
    # Minimal runner without pytest for CI-less environments
    class _Dummy:
        pass

    t = tenants.__wrapped__() if hasattr(tenants, "__wrapped__") else None
    # Call fixture body directly
    class FakeRequest:
        pass

    # Re-run seed inline
    print("Use: pytest tests/test_org_isolation.py -n 0")
    sys.exit(1)
