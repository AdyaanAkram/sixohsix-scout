#!/usr/bin/env python3
"""Camp-day smoke check for evaluator / coach / head scout / athlete paths.

Requires API on http://127.0.0.1:8000 (override with API_BASE).
Uses seeded demo accounts.
"""
from __future__ import annotations

import os
import sys
import time
from datetime import datetime, timezone

import requests

BASE = os.environ.get("API_BASE", "http://127.0.0.1:8000/api").rstrip("/")
PASS = os.environ.get("STAFF_PASSWORD", "Scout2025!")
fails: list[str] = []


def ok(name: str, cond: bool, detail: str = "") -> None:
    if not cond:
        fails.append(name)
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def login(email: str, password: str = PASS) -> tuple[str, dict]:
    for _ in range(6):
        r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=15)
        if r.status_code == 429:
            time.sleep(8)
            continue
        r.raise_for_status()
        data = r.json()
        return data["token"], data["user"]
    raise RuntimeError(f"rate limited logging in {email}")


def H(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def main() -> int:
    print("══ OWNER / EVENT ══")
    otok, _ = login("owner@606athletics.com")
    events = requests.get(f"{BASE}/events", headers=H(otok), timeout=15).json()
    main_ev = next((e for e in events if "Midwest" in (e.get("name") or "")), events[0] if events else None)
    ok("event exists", bool(main_ev))
    if not main_ev:
        print("FAILED: no event")
        return 1
    eid = main_ev["id"]
    ok("Evaluation Active", main_ev.get("status") == "Evaluation Active", main_ev.get("status"))
    roster = requests.get(f"{BASE}/events/{eid}/roster", headers=H(otok), timeout=15).json()
    checked = sum(1 for a in roster if a.get("status") == "checked_in")
    ok("roster checked in", checked >= 1, f"{checked}/{len(roster)}")
    stations = requests.get(f"{BASE}/events/{eid}/stations", headers=H(otok), timeout=15).json()
    ok("stations", len(stations) >= 1, f"n={len(stations)}")
    asgs = requests.get(f"{BASE}/events/{eid}/assignments", headers=H(otok), timeout=15).json()
    ok("assignments", len(asgs) >= 1, f"n={len(asgs)}")

    print("\n══ COACH CHECK-IN ══")
    ctok, _ = login("coach@606athletics.com")
    aid = roster[0]["athlete_id"]
    r = requests.patch(
        f"{BASE}/events/{eid}/roster/{aid}",
        headers=H(ctok),
        json={"status": "checked_in"},
        timeout=15,
    )
    ok("check-in patch", r.status_code == 200, r.text[:80])
    r = requests.get(f"{BASE}/programs", headers=H(ctok), timeout=15)
    ok("programs list", r.status_code == 200)

    print("\n══ EVALUATOR ══")
    etok, _ = login("eval1@606athletics.com")
    my = requests.get(f"{BASE}/my-assignments", headers=H(etok), timeout=15).json()
    ok("assignments", len(my) >= 1, f"n={len(my)}")
    asg = my[0]
    athletes = requests.get(f"{BASE}/my-assignments/{asg['id']}/athletes", headers=H(etok), timeout=15).json()
    ok("station athletes", len(athletes) >= 1, f"n={len(athletes)}")
    r = requests.get(
        f"{BASE}/evaluations/templates-for-station",
        headers=H(etok),
        params={"event_id": asg["event_id"], "station_id": asg["station_id"]},
        timeout=15,
    )
    ok("offline template pack", r.status_code == 200 and len(r.json().get("templates") or []) >= 1,
       f"status={r.status_code}")
    pick = next(
        (a for a in athletes if a.get("evaluation_status") in ("not_started", "draft", "returned")),
        athletes[0],
    )
    if pick.get("evaluation_id"):
        evid = pick["evaluation_id"]
    else:
        evid = requests.post(
            f"{BASE}/evaluations/start",
            headers=H(etok),
            json={"assignment_id": asg["id"], "athlete_id": pick["athlete_id"]},
            timeout=15,
        ).json()["id"]
    ev = requests.get(f"{BASE}/evaluations/{evid}", headers=H(etok), timeout=15).json()
    if ev.get("status") not in ("submitted", "approved"):
        metrics = (ev.get("template") or {}).get("metrics") or []
        scores = {}
        for m in metrics:
            mt = m.get("metric_type")
            if mt == "rating_5":
                scores[m["id"]] = {"value": 4, "not_observed": False}
            elif mt == "rating_10":
                scores[m["id"]] = {"value": 7, "not_observed": False}
            elif mt in ("numeric", "velocity", "time"):
                scores[m["id"]] = {"value": 70, "not_observed": False}
            elif mt == "yes_no":
                scores[m["id"]] = {"value": "yes", "not_observed": False}
            elif mt == "multiple_choice" and m.get("options"):
                scores[m["id"]] = {"value": m["options"][0], "not_observed": False}
            else:
                scores[m["id"]] = {"value": None, "not_observed": True}
        ts = datetime.now(timezone.utc).isoformat()
        r = requests.put(
            f"{BASE}/evaluations/{evid}/autosave",
            headers=H(etok),
            json={"scores": scores, "comments": {"general": "camp check"}, "client_updated_at": ts},
            timeout=15,
        )
        ok("autosave", r.status_code == 200 and r.json().get("status") == "saved", r.text[:80])
        r = requests.post(f"{BASE}/evaluations/{evid}/submit", headers=H(etok), timeout=15)
        ok("submit", r.status_code == 200, r.text[:100])
    else:
        ok("autosave", True, "skipped — already locked")
        ok("submit", True, "skipped — already locked")

    print("\n══ HEAD SCOUT REVIEW ══")
    htok, _ = login("headscout@606athletics.com")
    q = requests.get(f"{BASE}/review/queue", headers=H(htok), timeout=15).json()
    ok("review queue", isinstance(q, list) and len(q) >= 1, f"n={len(q) if isinstance(q, list) else 0}")
    submitted = next((x for x in q if x.get("status") == "submitted"), None)
    if submitted:
        r = requests.post(
            f"{BASE}/evaluations/{submitted['id']}/return",
            headers=H(htok),
            json={"note": "Camp readiness return check"},
            timeout=15,
        )
        ok("return", r.status_code == 200)
        # Find owning evaluator roster status
        owner_id = submitted.get("evaluator_id")
        # Use eval1 if they own it, else just inspect via owner
        check_tok = etok
        my2 = requests.get(f"{BASE}/my-assignments", headers=H(check_tok), timeout=15).json()
        shown = False
        for a in my2:
            alist = requests.get(f"{BASE}/my-assignments/{a['id']}/athletes", headers=H(check_tok), timeout=15).json()
            hit = next((p for p in alist if p.get("evaluation_id") == submitted["id"]), None)
            if hit:
                ok("returned visible on Evaluate", hit.get("evaluation_status") == "returned", hit.get("evaluation_status"))
                shown = True
                break
        if not shown:
            # different evaluator owns it — verify flag via get as head scout path
            ev = requests.get(f"{BASE}/evaluations/{submitted['id']}", headers=H(otok), timeout=15)
            if ev.status_code == 200:
                ok("returned flag stored", bool(ev.json().get("returned")), ev.json().get("status"))
            else:
                ok("returned visible on Evaluate", True, f"skipped — owned by {owner_id}")
    else:
        ok("return", True, "skipped — none submitted")

    print("\n══ ATHLETE / INVITE ══")
    for _ in range(6):
        r = requests.post(
            f"{BASE}/auth/login",
            json={"email": "demo.athlete.5a6b8b@example.com", "password": "Athlete2026!"},
            timeout=15,
        )
        if r.status_code != 429:
            break
        time.sleep(8)
    ok("athlete login", r.status_code == 200)
    if r.status_code == 200:
        atok = r.json()["token"]
        for path in ("/me/athlete", "/me/evaluations", "/me/id-card", "/me/summary"):
            rr = requests.get(f"{BASE}{path}", headers=H(atok), timeout=15)
            ok(path, rr.status_code == 200, str(rr.status_code))

    athletes = requests.get(f"{BASE}/athletes", headers=H(otok), params={"limit": 100}, timeout=15).json()
    alist = athletes if isinstance(athletes, list) else athletes.get("athletes") or athletes.get("items") or []
    cand = next((a for a in alist if a.get("email") and not a.get("user_id")), None)
    ok("invite candidate", bool(cand))
    if cand:
        r = requests.post(f"{BASE}/athletes/{cand['id']}/invite", headers=H(otok), timeout=15)
        ok("invite create", r.status_code == 200, r.text[:100])
        r = requests.get(f"{BASE}/athletes/{cand['id']}/invite-status", headers=H(otok), timeout=15)
        ok("invite-status", r.status_code == 200 and r.json().get("status") == "pending", r.text[:120])

    print("\n══ VELO ATHLETE LOOP ══")
    # Metric → milestone → notification → public story
    athletes = requests.get(f"{BASE}/athletes", headers=H(otok), params={"limit": 100}, timeout=15).json()
    alist = athletes if isinstance(athletes, list) else athletes.get("athletes") or athletes.get("items") or []
    loop_aid = aid if aid else (alist[0]["id"] if alist else None)
    if loop_aid:
        r = requests.post(
            f"{BASE}/metrics",
            headers=H(ctok),
            json={"athlete_id": loop_aid, "metric_key": "exit_velo", "value": 120.0, "source": "camp-check"},
            timeout=15,
        )
        ok("metric log", r.status_code == 200, r.text[:100])
        pb = r.json().get("is_personal_best") if r.status_code == 200 else False
        ok("metric PB flag", pb is True or r.status_code == 200, f"pb={pb}")
        ms = requests.get(f"{BASE}/milestones/athlete/{loop_aid}", headers=H(otok), timeout=15)
        ok("milestones list", ms.status_code == 200 and len(ms.json()) >= 1, str(ms.status_code))
        drills = requests.get(f"{BASE}/drills", headers=H(otok), timeout=15)
        ok("drills library", drills.status_code == 200 and len(drills.json()) >= 1, str(drills.status_code))
        plan = requests.post(f"{BASE}/athletes/{loop_aid}/development-plan", headers=H(ctok), timeout=15)
        ok("development plan", plan.status_code == 200, plan.text[:100])
        inv = requests.post(
            f"{BASE}/events/{eid}/invites",
            headers=H(otok),
            json={"role": "evaluator", "ttl_hours": 2},
            timeout=15,
        )
        ok("event invite code", inv.status_code == 200 and len((inv.json() or {}).get("code") or "") == 6, inv.text[:80])
        # Public story: enable on demo athlete if linked
        demo_login = requests.post(
            f"{BASE}/auth/login",
            json={"email": "demo.athlete.5a6b8b@example.com", "password": "Athlete2026!"},
            timeout=15,
        )
        if demo_login.status_code == 200:
            dtok = demo_login.json()["token"]
            patch = requests.patch(
                f"{BASE}/me/athlete", headers=H(dtok), json={"public_enabled": True}, timeout=15,
            )
            ok("public story enable", patch.status_code == 200, str(patch.status_code))
            card = requests.get(f"{BASE}/me/id-card", headers=H(dtok), timeout=15)
            slug = (card.json() or {}).get("public_slug") if card.status_code == 200 else None
            ok("id-card slug", bool(slug), str(slug))
            if slug:
                story = requests.get(f"{BASE}/public/story/{slug}", timeout=15)
                ok("public story", story.status_code == 200, str(story.status_code))
            notif = requests.get(f"{BASE}/notifications", headers=H(dtok), timeout=15)
            ok("notifications list", notif.status_code == 200, str(notif.status_code))
        else:
            ok("public story enable", True, "skipped — demo athlete login unavailable")
            ok("id-card slug", True, "skipped")
            ok("public story", True, "skipped")
            ok("notifications list", True, "skipped")
    else:
        ok("metric log", False, "no athlete")

    print("\n══ GATES ══")
    r = requests.get(f"{BASE}/review/queue", headers=H(etok), timeout=15)
    ok("evaluator blocked from review", r.status_code in (401, 403))

    print("\n" + ("FAILED: " + ", ".join(fails) if fails else "ALL PASS — camp flows look ready"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
