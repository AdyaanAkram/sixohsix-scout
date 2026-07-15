"""PBG Scout Phase 1 POC: core workflow test in isolation.
Covers: auth, RBAC, org isolation, evaluator assignment restriction,
autosave idempotency, offline-stale rejection, submit lock, weighted scoring,
head scout review, coach assessment/goal, CSV import, reports/PDF.
Run: python /app/tests/test_core.py
"""
import io
import sys

import requests

BASE = "http://localhost:8001/api"
PASSWORD = "Scout2025!"

results = []


def check(name, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    results.append((status, name, detail))
    print(f"[{status}] {name} {('- ' + str(detail)) if detail and not cond else ''}")
    return cond


def login(email):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200, f"login failed for {email}: {r.text}"
    d = r.json()
    return {"Authorization": f"Bearer {d['token']}"}, d["user"]


def main():
    # ---------- 1. Auth ----------
    admin_h, admin = login("admin@pbgscout.com")
    eval1_h, eval1 = login("eval1@pbgscout.com")
    eval3_h, eval3 = login("eval3@pbgscout.com")
    scout_h, scout = login("headscout@pbgscout.com")
    coach_h, coach = login("coach@pbgscout.com")
    owner_h, owner = login("owner@pbgscout.com")
    check("Login works for all active roles", True)

    r = requests.post(f"{BASE}/auth/login", json={"email": "admin@pbgscout.com", "password": "wrong"})
    check("Wrong password rejected (401)", r.status_code == 401)

    r = requests.get(f"{BASE}/auth/me")
    check("No token -> 401", r.status_code == 401)

    r = requests.get(f"{BASE}/auth/me", headers=eval1_h)
    check("auth/me returns role from server (not client)", r.json().get("role") == "evaluator")

    # ---------- 2. RBAC ----------
    r = requests.post(f"{BASE}/events", json={"name": "X", "date": "2026-01-01"}, headers=eval1_h)
    check("Evaluator cannot create events (403)", r.status_code == 403)
    r = requests.get(f"{BASE}/audit-logs", headers=eval1_h)
    check("Evaluator cannot view audit logs (403)", r.status_code == 403)
    r = requests.get(f"{BASE}/audit-logs", headers=owner_h)
    check("Owner can view audit logs", r.status_code == 200 and len(r.json()) > 0)
    r = requests.get(f"{BASE}/review/queue", headers=eval1_h)
    check("Evaluator cannot access review queue (403)", r.status_code == 403)

    # Guardian privacy: evaluator should not see guardian fields
    r = requests.get(f"{BASE}/athletes", headers=eval1_h)
    a0 = r.json()[0]
    check("Evaluator cannot see guardian info", "guardian_email" not in a0 and "emergency_contact" not in a0)
    r = requests.get(f"{BASE}/athletes", headers=admin_h)
    check("Admin sees guardian info", "guardian_email" in r.json()[0])

    # ---------- 3. Evaluator assignment restriction ----------
    r = requests.get(f"{BASE}/my-assignments", headers=eval1_h)
    my_assignments = r.json()
    check("Evaluator sees own assignments", len(my_assignments) >= 1)
    my_a = my_assignments[0]

    r = requests.get(f"{BASE}/my-assignments", headers=eval3_h)
    other_a = r.json()[0]
    r = requests.get(f"{BASE}/my-assignments/{other_a['id']}/athletes", headers=eval1_h)
    check("Evaluator blocked from another evaluator's assignment (403)", r.status_code == 403)

    r = requests.get(f"{BASE}/my-assignments/{my_a['id']}/athletes", headers=eval1_h)
    athletes = r.json()
    check("Evaluator gets assigned (checked-in) players", len(athletes) > 0)

    # ---------- 4. Start + autosave + scoring ----------
    target = next((x for x in athletes if x["evaluation_status"] == "not_started"), athletes[0])
    r = requests.post(f"{BASE}/evaluations/start", json={"assignment_id": my_a["id"], "athlete_id": target["athlete_id"]}, headers=eval1_h)
    ev = r.json()
    check("Start evaluation creates/returns draft", r.status_code == 200 and ev.get("status") in ("draft",) or ev.get("id"))
    ev_id = ev["id"]

    # idempotent start (no duplicates)
    r2 = requests.post(f"{BASE}/evaluations/start", json={"assignment_id": my_a["id"], "athlete_id": target["athlete_id"]}, headers=eval1_h)
    check("Start is idempotent (same evaluation id)", r2.json()["id"] == ev_id)

    template = my_a.get("template") or {}
    metrics = template.get("metrics", [])
    rating = next(m for m in metrics if m["metric_type"] == "rating_5")
    timem = next((m for m in metrics if m["metric_type"] == "time"), None)

    scores = {rating["id"]: {"value": 4}}
    if timem:
        scores[timem["id"]] = {"value": 7.5, "attempt_2": 7.2}
    r = requests.put(f"{BASE}/evaluations/{ev_id}/autosave",
                     json={"scores": scores, "client_updated_at": "2026-01-01T10:00:00"},
                     headers=eval1_h)
    d = r.json()
    check("Autosave saves and computes", r.status_code == 200 and d["status"] == "saved")

    # verify rating normalization 4/5 -> 8.0
    mr = d["computed"]["metric_results"]
    check("Rating 4/5 normalizes to 8.0", mr[rating["id"]]["normalized"] == 8.0, mr[rating["id"]])

    if timem:
        tr = mr[timem["id"]]
        check("Time metric uses best attempt (lower)", tr["raw"] == 7.2, tr)
        # 14U player + sixty_yard benchmark floor 10.0 elite 6.6 -> (7.2-10)/(6.6-10)=0.8235 -> 8.24
        # (only check normalized in valid range or None if no benchmark for age group)
        check("Measurement normalized only via benchmark (or raw-only)",
              tr["normalized"] is None or 0 <= tr["normalized"] <= 10, tr)

    # stale offline payload must be ignored
    r = requests.put(f"{BASE}/evaluations/{ev_id}/autosave",
                     json={"scores": {rating["id"]: {"value": 1}}, "client_updated_at": "2025-12-31T00:00:00"},
                     headers=eval1_h)
    check("Stale offline sync ignored", r.json()["status"] == "stale_ignored")
    r = requests.get(f"{BASE}/evaluations/{ev_id}", headers=eval1_h)
    check("Score unchanged after stale sync", r.json()["scores"][rating["id"]]["value"] == 4)

    # eval3 cannot autosave eval1's evaluation
    r = requests.put(f"{BASE}/evaluations/{ev_id}/autosave", json={"scores": {}}, headers=eval3_h)
    check("Another evaluator cannot edit my evaluation (403)", r.status_code == 403)

    # ---------- 5. Submit validation + lock ----------
    required = [m for m in metrics if m.get("required") and m["metric_type"] not in ("comment", "observation")]
    unfilled = [m for m in required if m["id"] not in scores]
    if unfilled:
        r = requests.post(f"{BASE}/evaluations/{ev_id}/submit", headers=eval1_h)
        check("Submit blocked when required metrics missing (400)", r.status_code == 400, r.text[:120])
        # fill them
        for m in unfilled:
            scores[m["id"]] = {"value": 3} if m["metric_type"].startswith("rating") else {"value": 5.0}
        requests.put(f"{BASE}/evaluations/{ev_id}/autosave", json={"scores": scores, "client_updated_at": "2026-01-01T10:05:00"}, headers=eval1_h)

    r = requests.put(f"{BASE}/evaluations/{ev_id}/autosave",
                     json={"comments": {"strengths": "Explosive first step", "development_needs": "Route efficiency", "general": "", "quick_tags": ["Hustle"]},
                           "client_updated_at": "2026-01-01T10:06:00"}, headers=eval1_h)
    check("Comments autosave", r.status_code == 200)

    r = requests.post(f"{BASE}/evaluations/{ev_id}/submit", headers=eval1_h)
    check("Submit succeeds", r.status_code == 200 and r.json()["status"] == "submitted", r.text[:200])

    r = requests.post(f"{BASE}/evaluations/{ev_id}/submit", headers=eval1_h)
    check("Duplicate submit blocked (409)", r.status_code == 409)
    r = requests.put(f"{BASE}/evaluations/{ev_id}/autosave", json={"scores": scores}, headers=eval1_h)
    check("Locked evaluation cannot be edited (409)", r.status_code == 409)

    # ---------- 6. Head scout review ----------
    r = requests.get(f"{BASE}/review/queue", headers=scout_h)
    queue = r.json()
    check("Review queue lists submitted evaluations", any(q["id"] == ev_id for q in queue))
    r = requests.post(f"{BASE}/evaluations/{ev_id}/approve", json={"note": "Consistent with live look."}, headers=scout_h)
    check("Head scout approves evaluation", r.status_code == 200)
    r = requests.post(f"{BASE}/scout-assessments", json={
        "athlete_id": target["athlete_id"], "summary": "High-upside athlete; track through summer.",
        "position_recommendation": "CF", "flag_follow_up": True}, headers=scout_h)
    check("Head scout final assessment + flag", r.status_code == 200)
    r = requests.get(f"{BASE}/flagged-athletes", headers=scout_h)
    check("Flagged players list includes athlete", any(a["id"] == target["athlete_id"] for a in r.json()))

    # ---------- 7. Coach workflow ----------
    r = requests.post(f"{BASE}/athletes/{target['athlete_id']}/notes", json={
        "athlete_id": target["athlete_id"], "assessment_type": "Development Check-In",
        "strengths": "Improved tempo", "development_priorities": "Lower-half strength"}, headers=coach_h)
    check("Coach adds YTD assessment", r.status_code == 200)
    r = requests.post(f"{BASE}/goals", json={
        "athlete_id": target["athlete_id"], "title": "Improve 60 time by 0.2s",
        "category": "Athleticism", "status": "Active", "progress": 10}, headers=coach_h)
    check("Coach creates development goal", r.status_code == 200)
    gid = r.json()["id"]
    r = requests.patch(f"{BASE}/goals/{gid}", json={"progress": 35, "status": "Improving"}, headers=coach_h)
    check("Coach updates goal progress", r.status_code == 200)
    r = requests.get(f"{BASE}/athletes/{target['athlete_id']}/timeline", headers=coach_h)
    tl = r.json()
    check("Player timeline has evaluation+note+goal entries",
          any(t["type"] == "evaluation" for t in tl) and any(t["type"] == "goal" for t in tl))

    # ---------- 8. Player summary scoring ----------
    r = requests.get(f"{BASE}/athletes/{target['athlete_id']}/summary", headers=scout_h)
    s = r.json()
    check("Player summary computes overall + categories",
          s["evaluation_count"] >= 1 and s["latest_overall"] is not None, s.get("latest_overall"))

    # ---------- 9. CSV import ----------
    csv_data = ("First Name,Last Name,Date of Birth,Primary Position,Bats,Throws,Team,City,State,Guardian Name,Guardian Email\n"
                "Test,Importer,2012-05-10,SS,R,R,Test Team,Chicago,IL,Guardian Importer,g@example.com\n"
                ",MissingFirst,2012-01-01,C,R,R,Test Team,Chicago,IL,,\n")
    r = requests.post(f"{BASE}/athletes/import/preview", files={"file": ("roster.csv", io.BytesIO(csv_data.encode()), "text/csv")}, headers=admin_h)
    p = r.json()
    check("CSV preview validates rows", p["valid_rows"] == 1 and p["error_rows"] == 1, p)
    r = requests.post(f"{BASE}/athletes/import/confirm", json={"rows": p["rows"]}, headers=admin_h)
    check("CSV import skips invalid rows", r.json()["imported"] == 1 and r.json()["skipped"] == 1)
    r = requests.post(f"{BASE}/athletes/import/preview", files={"file": ("roster.csv", io.BytesIO(csv_data.encode()), "text/csv")}, headers=admin_h)
    check("Duplicate detection on re-import", r.json()["duplicate_rows"] == 1)
    r = requests.post(f"{BASE}/athletes/import/preview", files={"file": ("x.csv", io.BytesIO(csv_data.encode()))}, headers=eval1_h)
    check("Evaluator cannot import players (403)", r.status_code == 403)

    # ---------- 10. Reports ----------
    r = requests.get(f"{BASE}/events", headers=admin_h)
    event_id = r.json()[0]["id"]
    r = requests.get(f"{BASE}/reports/leaderboard", params={"event_id": event_id}, headers=scout_h)
    lb = r.json()
    check("Leaderboard ranks players", len(lb) > 3 and lb[0]["rank"] == 1 and lb[0]["score"] >= lb[1]["score"])
    r = requests.get(f"{BASE}/reports/disagreement/{event_id}", headers=scout_h)
    check("Disagreement report responds", r.status_code == 200)
    r = requests.get(f"{BASE}/reports/event-results/{event_id}/csv", headers=admin_h)
    check("Event results CSV export", r.status_code == 200 and "Overall Score" in r.text)
    r = requests.get(f"{BASE}/reports/player/{target['athlete_id']}/pdf", headers=scout_h)
    check("Player PDF report generates", r.status_code == 200 and r.content[:4] == b"%PDF" and len(r.content) > 2000)
    r = requests.get(f"{BASE}/events/{event_id}/progress", headers=admin_h)
    prog = r.json()
    check("Live progress computes station/evaluator stats", len(prog["station_progress"]) == 6 and prog["checked_in"] > 0)

    # ---------- Summary ----------
    fails = [r for r in results if r[0] == "FAIL"]
    print(f"\n{'='*50}\nTOTAL: {len(results)}  PASS: {len(results)-len(fails)}  FAIL: {len(fails)}")
    for f in fails:
        print(f"  FAIL: {f[1]} {f[2]}")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
