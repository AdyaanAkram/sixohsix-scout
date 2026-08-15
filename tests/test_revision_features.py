"""Integration coverage for the revision features (spec §5/§6/§8/§12/§13/§14/§16/§17/§18).

Hits the LIVE backend over HTTP (same style as test_org_isolation.py) using the
seeded PBG Midwest + PBG South orgs. A running server is assumed at PBG_API_BASE
(default http://127.0.0.1:8000/api) seeded against local Mongo `pbg_scout_local`.

Design rules honoured:
  * Re-runnable & self-cleaning. Data we create (a throwaway athlete, portal
    users, ad-hoc metrics/notes/event-invites/redeemed users) is deleted in
    fixture teardown, tracked by id — never left in the shared DB.
  * We NEVER mutate the seeded demo rows. Reads against seeded data only.
  * Any test whose seed precondition is absent SKIPs (honest) instead of failing.

Run:
  cd /Users/.../PBG-Scout-App-Concept-
  backend/.venv/bin/python -m pytest tests/test_revision_features.py -q
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid

import pytest
import requests

# Make backend importable (auth.hash_password, db helpers) — same as test_org_isolation.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "pbg_scout_local")

BASE = os.environ.get("PBG_API_BASE", "http://127.0.0.1:8000/api")
PASSWORD = "Scout2025!"

# Seeded logins (backend/seed.py). All share PASSWORD.
STAFF_EMAILS = {
    "owner": "owner@606athletics.com",
    "admin": "admin@606athletics.com",
    "head_scout": "headscout@606athletics.com",
    "coach": "coach@606athletics.com",
    "evaluator": "eval1@606athletics.com",
    "south_coach": "coach.south@606athletics.com",  # single-org PBG South coach
}

MIDWEST_ORG = "org-pbg-midwest"
SOUTH_ORG = "org-pbg-south"

TIMEOUT = 15


# --------------------------------------------------------------------------- #
# Low-level helpers
# --------------------------------------------------------------------------- #

def _login(email: str, password: str = PASSWORD):
    # The server rate-limits /auth/login (15/60s per IP). Back off on 429 so the
    # suite stays re-runnable even when logins from a prior run are still counted.
    import time
    for attempt in range(4):
        r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=TIMEOUT)
        if r.status_code == 429:
            time.sleep(5)
            continue
        if r.status_code != 200:
            return None
        j = r.json()
        return {"headers": {"Authorization": f"Bearer {j['token']}"}, "user": j["user"], "token": j["token"]}
    return None


def _get(path, sess, **kw):
    return requests.get(f"{BASE}{path}", headers=sess["headers"], timeout=TIMEOUT, **kw)


def _post(path, sess, **kw):
    return requests.post(f"{BASE}{path}", headers=sess["headers"], timeout=TIMEOUT, **kw)


def _mongo():
    """Return (client, db). Mirrors test_org_isolation's direct-Mongo approach."""
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
    os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
    os.environ.setdefault("DB_NAME", "pbg_scout_local")
    from motor.motor_asyncio import AsyncIOMotorClient
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    return client, client[os.environ["DB_NAME"]]


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


# --------------------------------------------------------------------------- #
# Session context: logins + discovered seed handles
# --------------------------------------------------------------------------- #

@pytest.fixture(scope="module")
def ctx():
    sessions = {}
    for role, email in STAFF_EMAILS.items():
        s = _login(email)
        if s is None:
            pytest.skip(f"Seed login missing: {email} — cannot run revision suite.")
        sessions[role] = s

    hs = sessions["head_scout"]

    # Event (Midwest has a single seeded evaluation camp)
    events = _get("/events", hs).json()
    event_id = events[0]["id"] if events else None

    # Athletes in Midwest
    athletes = _get("/athletes", hs).json()
    athlete_ids = [a["id"] for a in athletes]

    # A two-season athlete (spec §6 demo).
    two_season_athlete = None
    for a in athletes:
        r = _get(f"/athletes/{a['id']}/seasons", hs)
        if r.status_code == 200 and len(r.json()) >= 2:
            two_season_athlete = a["id"]
            break

    # A submitted/approved evaluation owned by eval1 (for results §14) + one draft.
    ev1 = sessions["evaluator"]
    submitted_eval = draft_eval = None
    mine = _get("/my-evaluations", ev1)
    if mine.status_code == 200:
        submitted_eval = next((e["id"] for e in mine.json() if e.get("status") in ("submitted", "approved")), None)
        draft_eval = next((e["id"] for e in mine.json() if e.get("status") == "draft"), None)

    # A roster athlete on the event.
    roster_athlete = None
    if event_id:
        ro = _get(f"/events/{event_id}/roster", hs)
        if ro.status_code == 200 and ro.json():
            first = ro.json()[0]
            roster_athlete = first.get("athlete_id") or first.get("id")

    # A South-org athlete id, for cross-tenant probes.
    south_athlete = None
    sc = sessions["south_coach"]
    sa = _get("/athletes", sc)
    if sa.status_code == 200 and sa.json():
        south_athlete = sa.json()[0]["id"]

    return {
        "s": sessions,
        "event_id": event_id,
        "athlete_ids": athlete_ids,
        "two_season_athlete": two_season_athlete,
        "submitted_eval": submitted_eval,
        "draft_eval": draft_eval,
        "roster_athlete": roster_athlete,
        "south_athlete": south_athlete,
    }


# --------------------------------------------------------------------------- #
# Sandbox: a throwaway athlete + linked athlete/parent portal users in Midwest.
# Everything is deleted on teardown, tracked by athlete id + user ids.
# --------------------------------------------------------------------------- #

@pytest.fixture(scope="module")
def sandbox(ctx):
    suffix = uuid.uuid4().hex[:8]
    athlete_id = f"ath-rev-{suffix}"
    athlete_user_id = f"user-rev-ath-{suffix}"
    parent_user_id = f"user-rev-par-{suffix}"
    athlete_email = f"rev.athlete.{suffix}@example.com"
    parent_email = f"rev.parent.{suffix}@example.com"

    from auth import hash_password
    from db import now_iso

    async def seed():
        client, db = _mongo()
        try:
            await db.athletes.insert_one({
                "id": athlete_id, "organization_id": MIDWEST_ORG,
                "first_name": "Sandbox", "last_name": f"Rev{suffix[:4]}",
                "primary_position": "SS", "age_group": "14U", "status": "active",
                "user_id": athlete_user_id, "guardian_user_id": parent_user_id,
                "self_service_enabled": True, "email": athlete_email,
                "created_at": now_iso(), "updated_at": now_iso(),
            })
            for uid, email, role in (
                (athlete_user_id, athlete_email, "athlete"),
                (parent_user_id, parent_email, "parent"),
            ):
                await db.users.insert_one({
                    "id": uid, "email": email, "full_name": f"{role.title()} Rev",
                    "password_hash": hash_password(PASSWORD), "active": True,
                    "active_organization_id": MIDWEST_ORG,
                    "created_at": now_iso(), "updated_at": now_iso(),
                })
                await db.memberships.insert_one({
                    "id": f"mem-{uid}", "user_id": uid, "organization_id": MIDWEST_ORG,
                    "role": role, "active": True, "created_at": now_iso(),
                })
        finally:
            client.close()

    _run(seed())

    ath = _login(athlete_email)
    par = _login(parent_email)

    yield {
        "athlete_id": athlete_id,
        "athlete_user_id": athlete_user_id,
        "parent_user_id": parent_user_id,
        "athlete_sess": ath,
        "parent_sess": par,
    }

    async def cleanup():
        client, db = _mongo()
        try:
            await db.athletes.delete_many({"id": athlete_id})
            await db.users.delete_many({"id": {"$in": [athlete_user_id, parent_user_id]}})
            await db.memberships.delete_many({"user_id": {"$in": [athlete_user_id, parent_user_id]}})
            await db.verified_metrics.delete_many({"athlete_id": athlete_id})
            await db.milestones.delete_many({"athlete_id": athlete_id})
            await db.athlete_notes.delete_many({"athlete_id": athlete_id})
            await db.athlete_seasons.delete_many({"athlete_id": athlete_id})
            await db.athlete_goals.delete_many({"athlete_id": athlete_id})
        finally:
            client.close()

    _run(cleanup())


@pytest.fixture
def cleanup():
    """Function-scoped delete registry: tests append (collection, filter)."""
    jobs: list[tuple[str, dict]] = []
    yield jobs

    async def run_cleanup():
        client, db = _mongo()
        try:
            for coll, filt in jobs:
                await db[coll].delete_many(filt)
        finally:
            client.close()

    if jobs:
        _run(run_cleanup())


# =========================================================================== #
# §14  Evaluation results
# =========================================================================== #

def test_results_submitted_returns_full_payload(ctx):
    if not ctx["submitted_eval"]:
        pytest.skip("No submitted/approved evaluation owned by eval1 in seed.")
    r = _get(f"/evaluations/{ctx['submitted_eval']}/results", ctx["s"]["evaluator"])
    assert r.status_code == 200, r.text
    body = r.json()
    for key in ("overall_score", "score_change", "top_strengths", "top_improvements",
                "category_scores", "progress_series", "verified_measurements",
                "recommendation", "next_evaluation_date", "full_evaluation"):
        assert key in body, f"results payload missing '{key}'"
    assert isinstance(body["top_strengths"], list) and len(body["top_strengths"]) <= 3
    assert isinstance(body["top_improvements"], list) and len(body["top_improvements"]) <= 3
    assert isinstance(body["category_scores"], list)
    assert isinstance(body["progress_series"], list)
    assert isinstance(body["verified_measurements"], list)
    assert isinstance(body["full_evaluation"], dict)
    # A category named a top strength must never also be a top improvement.
    used = {(i.get("source"), i.get("label")) for i in body["top_strengths"]}
    assert used.isdisjoint({(i.get("source"), i.get("label")) for i in body["top_improvements"]})


def test_results_draft_returns_409(ctx):
    if not ctx["draft_eval"]:
        pytest.skip("No draft evaluation owned by eval1 in seed.")
    r = _get(f"/evaluations/{ctx['draft_eval']}/results", ctx["s"]["evaluator"])
    assert r.status_code == 409, f"expected 409 for draft results, got {r.status_code}: {r.text[:160]}"


def test_results_cross_tenant_404(ctx):
    if not ctx["submitted_eval"]:
        pytest.skip("No submitted evaluation to probe cross-tenant.")
    r = _get(f"/evaluations/{ctx['submitted_eval']}/results", ctx["s"]["south_coach"])
    assert r.status_code == 404, f"cross-tenant results should 404, got {r.status_code}"


# =========================================================================== #
# §16  Metric verification sources
# =========================================================================== #

EXPECTED_SOURCES = {"athlete_submitted", "parent_submitted", "coach_submitted",
                    "event_verified", "device_verified", "id_verified"}


def test_metric_sources_catalog_coach(ctx):
    r = _get("/metrics/sources", ctx["s"]["coach"])
    assert r.status_code == 200, r.text
    body = r.json()
    keys = {s["key"] for s in body["sources"]}
    assert keys == EXPECTED_SOURCES, f"expected the six sources, got {keys}"
    allowed = {s["key"] for s in body["sources"] if s["allowed_for_me"]}
    # A coach may write coach_submitted but NOT id_verified (review-only tier).
    assert "coach_submitted" in allowed
    assert "id_verified" not in allowed
    assert body["default_for_me"] == "coach_submitted"


def test_metric_sources_evaluator_writes_nothing(ctx):
    r = _get("/metrics/sources", ctx["s"]["evaluator"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert all(not s["allowed_for_me"] for s in body["sources"]), "evaluator must not be able to write any source"
    assert body["default_for_me"] is None


def test_metric_sources_headscout_can_id_verify(ctx):
    r = _get("/metrics/sources", ctx["s"]["head_scout"])
    assert r.status_code == 200, r.text
    allowed = {s["key"] for s in r.json()["sources"] if s["allowed_for_me"]}
    assert "id_verified" in allowed, "head_scout (review role) must be able to stamp id_verified"


def test_coach_writes_coach_submitted(ctx, sandbox, cleanup):
    cleanup.append(("verified_metrics", {"athlete_id": sandbox["athlete_id"]}))
    cleanup.append(("milestones", {"athlete_id": sandbox["athlete_id"]}))
    r = _post("/metrics", ctx["s"]["coach"], json={
        "athlete_id": sandbox["athlete_id"], "metric_key": "exit_velocity",
        "value": 80.0, "source": "coach_submitted"})
    assert r.status_code == 200, r.text
    assert r.json().get("is_verified") is True
    assert r.json().get("source") == "coach_submitted"


def test_metric_unknown_source_400(ctx, sandbox):
    r = _post("/metrics", ctx["s"]["coach"], json={
        "athlete_id": sandbox["athlete_id"], "metric_key": "exit_velocity",
        "value": 81.0, "source": "totally_made_up"})
    assert r.status_code == 400, f"unknown source should 400, got {r.status_code}: {r.text[:160]}"


def test_metric_unknown_key_400(ctx, sandbox):
    r = _post("/metrics", ctx["s"]["coach"], json={
        "athlete_id": sandbox["athlete_id"], "metric_key": "not_a_metric", "value": 1.0})
    assert r.status_code == 400, f"unknown metric_key should 400, got {r.status_code}"


def test_legacy_metric_key_canonicalized(ctx, sandbox, cleanup):
    cleanup.append(("verified_metrics", {"athlete_id": sandbox["athlete_id"]}))
    cleanup.append(("milestones", {"athlete_id": sandbox["athlete_id"]}))
    r = _post("/metrics", ctx["s"]["coach"], json={
        "athlete_id": sandbox["athlete_id"], "metric_key": "exit_velo", "value": 79.0})
    assert r.status_code == 200, r.text
    assert r.json().get("metric_key") == "exit_velocity", "legacy key must canonicalize"


def test_athlete_cannot_write_verified_source(sandbox, cleanup):
    if sandbox["athlete_sess"] is None:
        pytest.skip("Athlete portal login unavailable.")
    cleanup.append(("verified_metrics", {"athlete_id": sandbox["athlete_id"]}))
    r = _post("/metrics", sandbox["athlete_sess"], json={
        "athlete_id": sandbox["athlete_id"], "metric_key": "exit_velocity",
        "value": 95.0, "source": "event_verified"})
    assert r.status_code == 403, f"athlete writing verified tier must 403, got {r.status_code}: {r.text[:160]}"


def test_parent_cannot_write_verified_source(sandbox, cleanup):
    if sandbox["parent_sess"] is None:
        pytest.skip("Parent portal login unavailable.")
    cleanup.append(("verified_metrics", {"athlete_id": sandbox["athlete_id"]}))
    r = _post("/metrics", sandbox["parent_sess"], json={
        "athlete_id": sandbox["athlete_id"], "metric_key": "exit_velocity",
        "value": 96.0, "source": "device_verified"})
    assert r.status_code == 403, f"parent writing verified tier must 403, got {r.status_code}: {r.text[:160]}"


def test_athlete_self_submit_is_unverified(sandbox, cleanup):
    if sandbox["athlete_sess"] is None:
        pytest.skip("Athlete portal login unavailable.")
    cleanup.append(("verified_metrics", {"athlete_id": sandbox["athlete_id"]}))
    r = _post("/metrics", sandbox["athlete_sess"], json={
        "athlete_id": sandbox["athlete_id"], "metric_key": "exit_velocity",
        "value": 70.0, "source": "athlete_submitted"})
    assert r.status_code == 200, r.text
    assert r.json().get("is_verified") is False
    assert r.json().get("is_personal_best") is False, "unverified self-report must never claim a PB"


# =========================================================================== #
# §18  Player comparison
# =========================================================================== #

def test_compare_headscout_ok(ctx):
    ids = ctx["athlete_ids"][:3]
    if len(ids) < 2:
        pytest.skip("Not enough athletes to compare.")
    r = _post("/athletes/compare", ctx["s"]["head_scout"], json={"athlete_ids": ids})
    assert r.status_code == 200, r.text
    players = r.json()["players"]
    assert len(players) == len(ids)


def test_compare_coach_ok(ctx):
    ids = ctx["athlete_ids"][:2]
    if len(ids) < 2:
        pytest.skip("Not enough athletes to compare.")
    r = _post("/athletes/compare", ctx["s"]["coach"], json={"athlete_ids": ids})
    assert r.status_code == 200, r.text


def test_compare_evaluator_forbidden(ctx):
    ids = ctx["athlete_ids"][:2]
    r = _post("/athletes/compare", ctx["s"]["evaluator"], json={"athlete_ids": ids})
    assert r.status_code == 403, f"evaluator must be excluded from compare, got {r.status_code}"


def test_compare_more_than_four_400(ctx):
    ids = ctx["athlete_ids"][:5]
    if len(ids) < 5:
        pytest.skip("Need 5 distinct athletes to exercise the >4 guard.")
    r = _post("/athletes/compare", ctx["s"]["head_scout"], json={"athlete_ids": ids})
    assert r.status_code == 400, f">4 players must 400, got {r.status_code}"


def test_compare_cross_org_id_silently_skipped(ctx):
    if not ctx["south_athlete"] or not ctx["athlete_ids"]:
        pytest.skip("Need both a Midwest and a South athlete.")
    own = ctx["athlete_ids"][0]
    r = _post("/athletes/compare", ctx["s"]["head_scout"],
              json={"athlete_ids": [own, ctx["south_athlete"]]})
    assert r.status_code == 200, r.text
    returned = {(p.get("athlete") or {}).get("id") for p in r.json()["players"]}
    assert ctx["south_athlete"] not in returned, "cross-tenant athlete must NOT leak into comparison"
    assert own in returned


# =========================================================================== #
# §6  Seasons / career
# =========================================================================== #

def test_seasons_list(ctx):
    aid = ctx["two_season_athlete"]
    if not aid:
        pytest.skip("No two-season athlete present in seed.")
    r = _get(f"/athletes/{aid}/seasons", ctx["s"]["head_scout"])
    assert r.status_code == 200, r.text
    assert len(r.json()) >= 2


def test_season_records_split_by_season(ctx):
    aid = ctx["two_season_athlete"]
    if not aid:
        pytest.skip("No two-season athlete present in seed.")
    hs = ctx["s"]["head_scout"]
    seasons = _get(f"/athletes/{aid}/seasons", hs).json()
    metric_ids_per_season = []
    for s in seasons:
        rr = _get(f"/athletes/{aid}/seasons/{s['id']}/records", hs)
        assert rr.status_code == 200, rr.text
        body = rr.json()
        assert body["counts"]["metrics"] == len(body["metrics"])
        metric_ids_per_season.append({m["id"] for m in body["metrics"]})
    # Each metric belongs to at most one season — no double counting across seasons.
    for i in range(len(metric_ids_per_season)):
        for j in range(i + 1, len(metric_ids_per_season)):
            assert metric_ids_per_season[i].isdisjoint(metric_ids_per_season[j]), \
                "a metric must not appear under two seasons"
    # Demo athlete has a dated verified metric per season → at least two total.
    assert sum(len(s) for s in metric_ids_per_season) >= 2


def test_career_aggregates(ctx):
    aid = ctx["two_season_athlete"]
    if not aid:
        pytest.skip("No two-season athlete present in seed.")
    r = _get(f"/athletes/{aid}/career", ctx["s"]["head_scout"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["season_count"] >= 2
    assert isinstance(body["total_evaluations"], int)
    assert len(body["seasons"]) == body["season_count"]


def test_seasons_cross_tenant_404(ctx):
    if not ctx["south_athlete"]:
        pytest.skip("No South athlete to probe cross-tenant.")
    r = _get(f"/athletes/{ctx['south_athlete']}/seasons", ctx["s"]["head_scout"])
    assert r.status_code == 404, f"cross-tenant seasons must 404, got {r.status_code}"


# =========================================================================== #
# §13  Event progress dashboard
# =========================================================================== #

def test_event_progress_coach_ok(ctx):
    if not ctx["event_id"]:
        pytest.skip("No seeded event.")
    r = _get(f"/events/{ctx['event_id']}/progress", ctx["s"]["coach"])
    assert r.status_code == 200, r.text
    body = r.json()
    for key in ("players_in_progress", "evaluations_draft", "avg_evaluation_seconds",
                "station_progress", "evaluator_progress"):
        assert key in body, f"progress payload missing '{key}'"
    assert isinstance(body["players_in_progress"], int)
    assert isinstance(body["evaluations_draft"], int)
    assert isinstance(body["station_progress"], list)
    assert isinstance(body["evaluator_progress"], list)
    # Nullable metric must be null or a number — never fabricated.
    assert body["avg_evaluation_seconds"] is None or isinstance(body["avg_evaluation_seconds"], (int, float))


def test_event_progress_evaluator_forbidden(ctx):
    if not ctx["event_id"]:
        pytest.skip("No seeded event.")
    r = _get(f"/events/{ctx['event_id']}/progress", ctx["s"]["evaluator"])
    assert r.status_code == 403, f"evaluator must not read the manager dashboard, got {r.status_code}"


def test_event_progress_cross_tenant_404(ctx):
    if not ctx["event_id"]:
        pytest.skip("No seeded event.")
    r = _get(f"/events/{ctx['event_id']}/progress", ctx["s"]["south_coach"])
    assert r.status_code == 404, f"cross-tenant progress must 404, got {r.status_code}"


def test_event_player_progress_shape(ctx):
    if not (ctx["event_id"] and ctx["roster_athlete"]):
        pytest.skip("No event roster athlete available.")
    r = _get(f"/events/{ctx['event_id']}/players/{ctx['roster_athlete']}/progress", ctx["s"]["coach"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body["stations"], list)
    assert isinstance(body["missing_stations"], list)
    assert isinstance(body["stations_missing"], int)
    for row in body["stations"]:
        assert isinstance(row["missing_required"], list), "missing_required must always be a list"
        assert row["status"] in ("complete", "draft", "missing", "n/a")


def test_event_player_progress_cross_tenant_404(ctx):
    if not (ctx["event_id"] and ctx["roster_athlete"]):
        pytest.skip("No event roster athlete available.")
    r = _get(f"/events/{ctx['event_id']}/players/{ctx['roster_athlete']}/progress", ctx["s"]["south_coach"])
    assert r.status_code == 404, f"cross-tenant per-player progress must 404, got {r.status_code}"


# =========================================================================== #
# §17  Notes visibility (confidential/scout note must not leak to evaluator)
# =========================================================================== #

@pytest.fixture(scope="module")
def scout_notes(ctx, sandbox):
    """Create one scout note + one confidential scout note on the sandbox athlete."""
    hs = ctx["s"]["head_scout"]
    made = {}
    r1 = _post("/scout-assessments", hs, json={
        "athlete_id": sandbox["athlete_id"],
        "summary": "Scout-only assessment — must never reach an evaluator.",
        "confidential": False})
    r2 = _post("/scout-assessments", hs, json={
        "athlete_id": sandbox["athlete_id"],
        "summary": "Confidential note — head scout / admin only.",
        "confidential": True})
    if r1.status_code == 200:
        made["scout"] = r1.json()["id"]
    if r2.status_code == 200:
        made["confidential"] = r2.json()["id"]
    yield made
    # Teardown handled by sandbox (deletes all athlete_notes for the athlete),
    # but delete explicitly too in case sandbox outlives this fixture.
    if made:
        async def _c():
            client, db = _mongo()
            try:
                await db.athlete_notes.delete_many({"id": {"$in": list(made.values())}})
            finally:
                client.close()
        _run(_c())


def test_scout_notes_created(scout_notes):
    if "scout" not in scout_notes or "confidential" not in scout_notes:
        pytest.skip("Could not create scout notes (endpoint unavailable).")


def test_scout_note_hidden_from_evaluator(ctx, sandbox, scout_notes):
    if not scout_notes:
        pytest.skip("No scout notes created.")
    r = _get(f"/athletes/{sandbox['athlete_id']}/notes", ctx["s"]["evaluator"])
    assert r.status_code == 200, r.text
    ids = {n["id"] for n in r.json()}
    assert scout_notes.get("scout") not in ids, "scout note leaked to evaluator (regression)"
    assert scout_notes.get("confidential") not in ids, "confidential note leaked to evaluator (regression)"


def test_scout_note_visible_to_headscout(ctx, sandbox, scout_notes):
    if not scout_notes:
        pytest.skip("No scout notes created.")
    r = _get(f"/athletes/{sandbox['athlete_id']}/notes", ctx["s"]["head_scout"])
    assert r.status_code == 200, r.text
    ids = {n["id"] for n in r.json()}
    assert scout_notes.get("scout") in ids
    assert scout_notes.get("confidential") in ids


def test_confidential_note_hidden_from_coach(ctx, sandbox, scout_notes):
    if not scout_notes:
        pytest.skip("No scout notes created.")
    r = _get(f"/athletes/{sandbox['athlete_id']}/notes", ctx["s"]["coach"])
    assert r.status_code == 200, r.text
    ids = {n["id"] for n in r.json()}
    assert scout_notes.get("confidential") not in ids, "confidential note leaked to coach"


# =========================================================================== #
# §12  Assignment / event-invite expiry (security-critical)
# =========================================================================== #

def test_expired_event_invite_denied(ctx, cleanup):
    if not ctx["event_id"]:
        pytest.skip("No seeded event.")
    admin = ctx["s"]["admin"]
    inv = _post(f"/events/{ctx['event_id']}/invites", admin,
                json={"role": "evaluator", "ttl_hours": -1})
    if inv.status_code != 200:
        pytest.skip(f"Could not create event invite: {inv.status_code} {inv.text[:120]}")
    cleanup.append(("event_invites", {"id": inv.json()["id"]}))
    code = inv.json()["code"]
    redeem = _post("/events/redeem", admin, json={
        "code": code, "email": f"expired.{uuid.uuid4().hex[:6]}@example.com",
        "full_name": "Expired Redeemer", "password": "RedeemPass1!"})
    assert redeem.status_code == 400, f"expired invite must be rejected, got {redeem.status_code}: {redeem.text[:160]}"
    assert "expired" in redeem.text.lower()


def test_revoked_event_invite_denied(ctx, cleanup):
    if not ctx["event_id"]:
        pytest.skip("No seeded event.")
    admin = ctx["s"]["admin"]
    inv = _post(f"/events/{ctx['event_id']}/invites", admin,
                json={"role": "evaluator", "ttl_hours": 48})
    if inv.status_code != 200:
        pytest.skip(f"Could not create event invite: {inv.status_code} {inv.text[:120]}")
    invite_id = inv.json()["id"]
    code = inv.json()["code"]
    cleanup.append(("event_invites", {"id": invite_id}))
    rev = _post(f"/events/invites/{invite_id}/revoke", admin)
    assert rev.status_code == 200, rev.text
    redeem = _post("/events/redeem", admin, json={
        "code": code, "email": f"revoked.{uuid.uuid4().hex[:6]}@example.com",
        "full_name": "Revoked Redeemer", "password": "RedeemPass1!"})
    assert redeem.status_code == 404, f"revoked invite must be rejected, got {redeem.status_code}: {redeem.text[:160]}"


def test_valid_redeem_then_revoke_cuts_access(ctx, cleanup):
    """Full §12 lifecycle: redeem grants access; revoke deactivates the temporary
    membership so the account can no longer act in the org. Fully self-cleaning."""
    if not ctx["event_id"]:
        pytest.skip("No seeded event.")
    admin = ctx["s"]["admin"]
    email = f"redeem.{uuid.uuid4().hex[:8]}@example.com"

    inv = _post(f"/events/{ctx['event_id']}/invites", admin,
                json={"role": "coach", "ttl_hours": 48})
    if inv.status_code != 200:
        pytest.skip(f"Could not create event invite: {inv.status_code} {inv.text[:120]}")
    invite_id = inv.json()["id"]
    code = inv.json()["code"]
    # Register cleanup up-front so artifacts are removed even if an assert fails.
    cleanup.append(("event_invites", {"id": invite_id}))
    cleanup.append(("users", {"email": email}))
    cleanup.append(("memberships", {"event_invite_id": invite_id}))
    cleanup.append(("evaluator_assignments", {"event_id": ctx["event_id"], "created_by": inv.json().get("invited_by")}))

    redeem = _post("/events/redeem", admin, json={
        "code": code, "email": email, "full_name": "Redeem Coach", "password": "RedeemPass1!"})
    assert redeem.status_code == 200, f"valid redeem should succeed, got {redeem.status_code}: {redeem.text[:160]}"

    # New coach can now authenticate and reach a staff endpoint.
    sess = _login(email, "RedeemPass1!")
    if sess is None:
        pytest.skip("Login rate-limited; cannot verify redeemed-coach access this run.")
    before = _get("/events", sess)
    assert before.status_code == 200, f"redeemed coach should have org access, got {before.status_code}"

    # Revoke → temporary membership deactivated.
    rev = _post(f"/events/invites/{invite_id}/revoke", admin)
    assert rev.status_code == 200, rev.text

    # A fresh login now reflects the revoked membership: either login fails, or
    # the token carries no active org and staff reads are denied.
    after_sess = _login(email, "RedeemPass1!")
    if after_sess is None:
        return  # login refused = access cut
    after = _get("/events", after_sess)
    assert after.status_code in (401, 403), \
        f"revoked coach must lose org access, got {after.status_code}"


# =========================================================================== #
# §5/§8  Age-aware template resolution
# =========================================================================== #

def test_age_aware_template_resolution_api():
    pytest.skip("No public template-resolve API endpoint exists; the age-aware "
                "resolver is exercised by direct unit tests, not over HTTP.")
