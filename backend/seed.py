"""Seed fictional data for PBG Scout. Wipes and recreates seed org data.
Run: python seed.py

Refuses to run when APP_ENV=production unless ALLOW_PROD_SEED=I_UNDERSTAND_WIPE.
"""
import asyncio
import os
import random
import sys
from datetime import date, datetime, timedelta, timezone

from auth import hash_password
from db import db, new_id, now_iso
from scoring import compute_evaluation_scores

random.seed(42)

ORG_ID = "org-pbg-midwest"
ORG_SOUTH_ID = "org-pbg-south"

STAFF = [
    {"email": "owner@pbgscout.com", "name": "Marco Villanueva", "role": "owner"},
    {"email": "admin@pbgscout.com", "name": "Liza Santos", "role": "admin"},
    {"email": "headscout@pbgscout.com", "name": "Ramon Dela Cruz", "role": "head_scout"},
    {"email": "coach@pbgscout.com", "name": "Jun Mercado", "role": "coach"},
    {"email": "eval1@pbgscout.com", "name": "Andres Reyes", "role": "evaluator"},
    {"email": "eval2@pbgscout.com", "name": "Kiko Bautista", "role": "evaluator"},
    {"email": "eval3@pbgscout.com", "name": "Paolo Garcia", "role": "evaluator"},
    {"email": "eval4@pbgscout.com", "name": "Danilo Ramos", "role": "evaluator"},
]
PASSWORD = "Scout2025!"

FIRST_NAMES = ["Miguel", "Jacob", "Ethan", "Noah", "Gabriel", "Joshua", "Nathan", "Marcus",
               "Adrian", "Angelo", "Rafael", "Christian", "Daniel", "Isaiah", "Elijah",
               "Lucas", "Mateo", "Diego", "Carlos", "Antonio", "Jordan", "Tyler", "Dylan",
               "Kai", "Evan", "Aaron", "Caleb", "Julian", "Xavier", "Vincent"]
LAST_NAMES = ["Reyes", "Santos", "Cruz", "Bautista", "Garcia", "Mendoza", "Torres", "Flores",
              "Ramos", "Gonzales", "Aquino", "Navarro", "Villanueva", "Domingo", "Castillo",
              "Salazar", "Mercado", "Aguilar", "Del Rosario", "Fernandez", "Lim", "Tan",
              "Ocampo", "Pascual", "Rivera", "Soriano", "Valdez", "Ybarra", "Zamora", "Corpuz"]
TEAMS = ["Chicago Islanders", "Midwest Tamaraws", "Lake County Eagles", "Des Plaines Dragons", "Skokie Sluggers"]
CITIES = [("Chicago", "IL"), ("Skokie", "IL"), ("Des Plaines", "IL"), ("Milwaukee", "WI"), ("Naperville", "IL"), ("Schaumburg", "IL")]
POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"]


def dob_for_age(age):
    today = date.today()
    year = today.year - age
    return f"{year}-{random.randint(1, 12):02d}-{random.randint(1, 28):02d}"


def age_group_for_age(age):
    bracket = min(max(age + (age % 2), 8), 18)
    return f"{bracket}U"


def iso(dt):
    return dt.replace(tzinfo=timezone.utc).isoformat()


async def wipe():
    for coll in ["organizations", "users", "memberships", "athletes", "events", "event_athletes",
                 "event_groups", "stations", "evaluation_templates", "evaluator_assignments",
                 "evaluations", "athlete_notes", "athlete_goals", "athlete_media",
                 "metric_benchmarks", "audit_logs", "invitations", "password_resets", "ai_drafts",
                 "verified_metrics", "milestones", "notifications", "awards", "drills",
                 "development_plans", "event_invites",
                 "programs", "sessions", "enrollments", "attendance", "locations"]:
        await db[coll].delete_many({})


def metric(name, category, mtype, unit=None, weight=1, required=False, mn=None, mx=None, order=0, higher=True, key=None, desc=None):
    return {"id": new_id(), "key": key or name.lower().replace(" ", "_").replace("-", "_"),
            "name": name, "description": desc, "category": category, "metric_type": mtype,
            "unit": unit, "weight": weight, "required": required, "min_value": mn,
            "max_value": mx, "display_order": order, "higher_is_better": higher, "options": []}


async def main():
    await wipe()
    now = datetime.now(timezone.utc)

    # ---- Organization ----
    await db.organizations.insert_one({
        "id": ORG_ID, "name": "PBG Midwest",
        "full_name": "Philippines Baseball Group Midwest",
        "tagline": "Identify. Evaluate. Develop. Connect.",
        "contact_email": "info@pbgscout.com",
        "feature_flags": {"athlete_portal": False, "parent_portal": False, "ai_features": False},
        "created_at": now_iso(), "updated_at": now_iso(),
    })

    # ---- Staff ----
    user_ids = {}
    pw = hash_password(PASSWORD)
    for s in STAFF:
        uid = new_id()
        user_ids[s["email"]] = uid
        await db.users.insert_one({
            "id": uid, "email": s["email"], "full_name": s["name"],
            "password_hash": pw, "active": True,
            "active_organization_id": ORG_ID,
            "created_at": now_iso(), "updated_at": now_iso(),
        })
        await db.memberships.insert_one({
            "id": new_id(), "user_id": uid, "organization_id": ORG_ID,
            "role": s["role"], "active": True, "created_at": now_iso(),
        })

    # ---- Athletes (30) ----
    athletes = []
    age_pools = [(9, 10), (11, 12), (13, 14)]
    for i in range(30):
        age = random.randint(*age_pools[i % 3])
        first = FIRST_NAMES[i]
        last = LAST_NAMES[i]
        city, state = random.choice(CITIES)
        pos = random.choice(POSITIONS)
        secondary = random.sample([p for p in POSITIONS if p != pos], k=random.randint(0, 2))
        dob = dob_for_age(age)
        a = {
            "id": new_id(), "organization_id": ORG_ID,
            "first_name": first, "last_name": last,
            "preferred_name": first if random.random() > 0.8 else None,
            "date_of_birth": dob, "age": age, "age_group": age_group_for_age(age),
            "graduation_year": date.today().year + (18 - age),
            "primary_position": pos, "secondary_positions": secondary,
            "bats": random.choice(["R", "R", "L", "S"]), "throws": random.choice(["R", "R", "R", "L"]),
            "height": f"{random.randint(48, 70)} in", "weight": f"{random.randint(65, 160)} lb",
            "jersey_number": str(random.randint(1, 99)),
            "current_team": random.choice(TEAMS), "school": f"{city} {random.choice(['Middle School', 'Elementary', 'Junior High', 'High School'])}",
            "city": city, "state": state, "country": "USA",
            "guardian_name": f"{random.choice(['Maria', 'Jose', 'Ana', 'Ramon', 'Teresa'])} {last}",
            "guardian_email": f"guardian.{last.lower().replace(' ', '')}{i}@example.com",
            "guardian_phone": f"(312) 555-{random.randint(1000, 9999)}",
            "emergency_contact": f"{random.choice(['Maria', 'Jose', 'Ana'])} {last} (312) 555-{random.randint(1000, 9999)}",
            "status": "active", "photo_url": None, "flagged_follow_up": False,
            "created_by": user_ids["admin@pbgscout.com"],
            "created_at": iso(now - timedelta(days=random.randint(10, 200))),
            "updated_at": now_iso(),
        }
        athletes.append(a)
        await db.athletes.insert_one(a)

    # ---- Templates ----
    def rating_metrics_8u():
        cats = [{"name": "Athleticism", "weight": 20}, {"name": "Hitting", "weight": 25},
                {"name": "Defense", "weight": 25}, {"name": "Arm Strength", "weight": 15},
                {"name": "Baseball IQ", "weight": 10}, {"name": "Coachability", "weight": 5}]
        ms = [
            metric("Athletic Movement", "Athleticism", "rating_5", weight=2, required=True, order=1),
            metric("Balance", "Athleticism", "rating_5", order=2),
            metric("Effort", "Coachability", "rating_5", required=True, order=3),
            metric("Coachability", "Coachability", "rating_5", weight=2, required=True, order=4),
            metric("Throwing Fundamentals", "Arm Strength", "rating_5", weight=2, order=5),
            metric("Throwing Accuracy", "Arm Strength", "rating_5", order=6),
            metric("Catching Fundamentals", "Defense", "rating_5", weight=2, order=7),
            metric("Ground-Ball Fundamentals", "Defense", "rating_5", weight=2, order=8),
            metric("Hitting Contact", "Hitting", "rating_5", weight=2, required=True, order=9),
            metric("Base-Running Awareness", "Baseball IQ", "rating_5", order=10),
            metric("Baseball Instincts", "Baseball IQ", "rating_5", weight=2, order=11),
        ]
        return cats, ms

    def metrics_11u():
        cats = [{"name": "Athleticism", "weight": 20}, {"name": "Hitting", "weight": 25},
                {"name": "Defense", "weight": 25}, {"name": "Arm Strength", "weight": 15},
                {"name": "Baseball IQ", "weight": 10}, {"name": "Coachability", "weight": 5}]
        ms = [
            metric("Home-to-First Time", "Athleticism", "time", unit="sec", weight=2, higher=False, key="home_to_first", order=1),
            metric("Arm Strength", "Arm Strength", "rating_5", weight=2, required=True, order=2),
            metric("Throwing Accuracy", "Arm Strength", "rating_5", order=3),
            metric("Infield Mechanics", "Defense", "rating_5", weight=2, order=4),
            metric("Outfield Routes", "Defense", "rating_5", order=5),
            metric("Catching Ability", "Defense", "rating_5", order=6),
            metric("Bat Speed", "Hitting", "rating_5", weight=2, required=True, order=7),
            metric("Contact Quality", "Hitting", "rating_5", weight=2, required=True, order=8),
            metric("Pitch Recognition", "Hitting", "rating_5", order=9),
            metric("Base-Running Instincts", "Baseball IQ", "rating_5", order=10),
            metric("Competitive Response", "Baseball IQ", "rating_5", order=11),
            metric("Baseball IQ", "Baseball IQ", "rating_5", weight=2, order=12),
            metric("Coachability", "Coachability", "rating_5", weight=2, required=True, order=13),
        ]
        return cats, ms

    def metrics_14u():
        cats = [{"name": "Athleticism", "weight": 20}, {"name": "Hitting", "weight": 25},
                {"name": "Defense", "weight": 25}, {"name": "Arm Strength", "weight": 15},
                {"name": "Baseball IQ", "weight": 10}, {"name": "Coachability", "weight": 5}]
        ms = [
            metric("Sixty-Yard Dash", "Athleticism", "time", unit="sec", weight=2, higher=False, key="sixty_yard_dash", required=True, order=1),
            metric("Home-to-First Time", "Athleticism", "time", unit="sec", higher=False, key="home_to_first", order=2),
            metric("Physical Projection", "Athleticism", "rating_5", order=3),
            metric("Exit Velocity", "Hitting", "velocity", unit="mph", weight=2, key="exit_velocity", required=True, order=4),
            metric("Bat Speed", "Hitting", "rating_5", weight=2, order=5),
            metric("Contact Quality", "Hitting", "rating_5", weight=2, order=6),
            metric("Power Projection", "Hitting", "rating_5", order=7),
            metric("Throwing Velocity", "Arm Strength", "velocity", unit="mph", weight=2, key="throwing_velocity", order=8),
            metric("Throwing Accuracy", "Arm Strength", "rating_5", order=9),
            metric("Defensive Projection", "Defense", "rating_5", weight=2, order=10),
            metric("Fielding Mechanics", "Defense", "rating_5", weight=2, order=11),
            metric("Baseball IQ", "Baseball IQ", "rating_5", weight=2, order=12),
            metric("Competitive Makeup", "Baseball IQ", "rating_5", order=13),
            metric("Coachability", "Coachability", "rating_5", weight=2, required=True, order=14),
        ]
        return cats, ms

    def station_template(name, cats_ms, age_group=None, applies_to=None, is_default=False):
        cats, ms = cats_ms
        return {"id": new_id(), "organization_id": ORG_ID, "name": name,
                "description": None, "age_group": age_group, "position": (applies_to or [None])[0] if applies_to else None,
                "applies_to_positions": applies_to or [],
                "is_default": is_default,
                "template_version": 1,
                "event_type": "Evaluation", "categories": cats, "metrics": ms,
                "created_by": user_ids["admin@pbgscout.com"],
                "created_at": now_iso(), "updated_at": now_iso()}

    # Age template keys: prefer band labels so resolve_template can match athlete age_group
    # (exact 7U/…/18U/College/Pro also work; blank age_group = all ages)
    tpl_8u = station_template("8U-10U Skills Evaluation", rating_metrics_8u(), "8U-10U", is_default=True)
    tpl_11u = station_template("11U-13U Skills Evaluation", metrics_11u(), "11U-13U")
    tpl_14u = station_template("14U-18U Showcase Evaluation", metrics_14u(), "14U-18U")

    # station-specific templates
    tpl_athletic = station_template("Athletic Testing", (
        [{"name": "Athleticism", "weight": 20}],
        [metric("Sixty-Yard Dash", "Athleticism", "time", unit="sec", weight=2, higher=False, key="sixty_yard_dash", order=1),
         metric("Home-to-First Time", "Athleticism", "time", unit="sec", higher=False, key="home_to_first", order=2),
         metric("Athletic Movement", "Athleticism", "rating_5", weight=2, required=True, order=3),
         metric("Balance", "Athleticism", "rating_5", order=4)]))
    tpl_hitting = station_template("Hitting Station", (
        [{"name": "Hitting", "weight": 25}, {"name": "Coachability", "weight": 5}],
        [metric("Exit Velocity", "Hitting", "velocity", unit="mph", weight=2, key="exit_velocity", order=1),
         metric("Bat Speed", "Hitting", "rating_5", weight=2, required=True, order=2),
         metric("Contact Quality", "Hitting", "rating_5", weight=2, required=True, order=3),
         metric("Power Projection", "Hitting", "rating_5", order=4),
         metric("Pitch Recognition", "Hitting", "rating_5", order=5),
         metric("Coachability", "Coachability", "rating_5", order=6)]))
    tpl_infield = station_template("Infield Station", (
        [{"name": "Defense", "weight": 25}, {"name": "Arm Strength", "weight": 15}],
        [metric("Ground-Ball Fundamentals", "Defense", "rating_5", weight=2, required=True, order=1),
         metric("Infield Mechanics", "Defense", "rating_5", weight=2, order=2),
         metric("Footwork", "Defense", "rating_5", order=3),
         metric("Throwing Velocity", "Arm Strength", "velocity", unit="mph", key="throwing_velocity", order=4),
         metric("Throwing Accuracy", "Arm Strength", "rating_5", weight=2, order=5)]),
        applies_to=["IF", "1B", "2B", "3B", "SS"])
    tpl_outfield = station_template("Outfield Station", (
        [{"name": "Defense", "weight": 25}, {"name": "Arm Strength", "weight": 15}],
        [metric("Outfield Routes", "Defense", "rating_5", weight=2, required=True, order=1),
         metric("Fly-Ball Reads", "Defense", "rating_5", weight=2, order=2),
         metric("Throwing Velocity", "Arm Strength", "velocity", unit="mph", key="throwing_velocity", order=3),
         metric("Throwing Accuracy", "Arm Strength", "rating_5", order=4)]),
        applies_to=["OF", "LF", "CF", "RF"])
    tpl_pitching = station_template("Pitching Station", (
        [{"name": "Arm Strength", "weight": 15}, {"name": "Baseball IQ", "weight": 10}],
        [metric("Pitching Velocity", "Arm Strength", "velocity", unit="mph", weight=2, key="pitching_velocity", order=1),
         metric("Pitching Mechanics", "Arm Strength", "rating_5", weight=2, required=True, order=2),
         metric("Control", "Arm Strength", "rating_5", weight=2, order=3),
         metric("Pitch Sequencing", "Baseball IQ", "rating_5", order=4)]),
        applies_to=["P"])
    tpl_catching = station_template("Catching Station", (
        [{"name": "Defense", "weight": 25}, {"name": "Arm Strength", "weight": 15}],
        [metric("Pop Time", "Arm Strength", "time", unit="sec", higher=False, key="pop_time", order=1),
         metric("Receiving", "Defense", "rating_5", weight=2, required=True, order=2),
         metric("Blocking", "Defense", "rating_5", weight=2, order=3),
         metric("Footwork", "Defense", "rating_5", order=4)]),
        applies_to=["C"])

    all_templates = [tpl_8u, tpl_11u, tpl_14u, tpl_athletic, tpl_hitting, tpl_infield,
                     tpl_outfield, tpl_pitching, tpl_catching]
    for t in all_templates:
        await db.evaluation_templates.insert_one(t)

    # ---- Benchmarks ----
    benchmarks = [
        # sixty yard dash (lower better): floor 10.0s -> elite 6.6s
        {"metric_key": "sixty_yard_dash", "age_group": "14U", "unit": "sec", "higher_is_better": False, "floor_value": 10.0, "elite_value": 6.6},
        {"metric_key": "sixty_yard_dash", "age_group": "12U", "unit": "sec", "higher_is_better": False, "floor_value": 11.0, "elite_value": 7.4},
        {"metric_key": "home_to_first", "age_group": "14U", "unit": "sec", "higher_is_better": False, "floor_value": 6.2, "elite_value": 4.2},
        {"metric_key": "home_to_first", "age_group": "12U", "unit": "sec", "higher_is_better": False, "floor_value": 6.8, "elite_value": 4.6},
        {"metric_key": "home_to_first", "age_group": "10U", "unit": "sec", "higher_is_better": False, "floor_value": 7.4, "elite_value": 5.0},
        {"metric_key": "exit_velocity", "age_group": "14U", "unit": "mph", "higher_is_better": True, "floor_value": 50, "elite_value": 90},
        {"metric_key": "exit_velocity", "age_group": "12U", "unit": "mph", "higher_is_better": True, "floor_value": 40, "elite_value": 75},
        {"metric_key": "throwing_velocity", "age_group": "14U", "unit": "mph", "higher_is_better": True, "floor_value": 45, "elite_value": 80},
        {"metric_key": "throwing_velocity", "age_group": "12U", "unit": "mph", "higher_is_better": True, "floor_value": 35, "elite_value": 65},
        {"metric_key": "pitching_velocity", "age_group": "14U", "unit": "mph", "higher_is_better": True, "floor_value": 45, "elite_value": 80},
        {"metric_key": "pitching_velocity", "age_group": "12U", "unit": "mph", "higher_is_better": True, "floor_value": 35, "elite_value": 65},
        {"metric_key": "pop_time", "age_group": "14U", "unit": "sec", "higher_is_better": False, "floor_value": 3.0, "elite_value": 1.9},
    ]
    for b in benchmarks:
        await db.metric_benchmarks.insert_one({"id": new_id(), "organization_id": ORG_ID, "created_at": now_iso(), **b})

    # ---- Event ----
    event_date = (now + timedelta(days=3)).strftime("%Y-%m-%d")
    event_id = new_id()
    await db.events.insert_one({
        "id": event_id, "organization_id": ORG_ID,
        "name": "PBG Midwest Spring Evaluation Camp",
        "event_type": "Evaluation", "date": event_date,
        "start_time": "09:00", "end_time": "15:00",
        "location": "Diamond Fields Complex, Skokie IL",
        "description": "Spring player evaluation and development camp for 10U, 12U and 14U age groups.",
        "age_groups": ["10U", "12U", "14U"], "status": "Evaluation Active",
        "created_by": user_ids["admin@pbgscout.com"],
        "created_at": iso(now - timedelta(days=21)), "updated_at": now_iso(),
    })

    # ---- Groups ----
    group_ids = {}
    for gname in ["Group A - 10U", "Group B - 12U", "Group C - 14U"]:
        gid = new_id()
        group_ids[gname] = gid
        await db.event_groups.insert_one({
            "id": gid, "organization_id": ORG_ID, "event_id": event_id,
            "name": gname, "created_at": now_iso(),
        })
    glist = list(group_ids.values())

    # ---- Roster + check-in ----
    def group_for(a):
        ag = a.get("age_group") or "12U"
        n = int(ag.replace("U", ""))
        if n <= 10:
            return glist[0]
        if n <= 12:
            return glist[1]
        return glist[2]

    bib = 1
    for a in athletes:
        checked = random.random() > 0.15
        await db.event_athletes.insert_one({
            "id": new_id(), "organization_id": ORG_ID, "event_id": event_id,
            "athlete_id": a["id"], "status": "checked_in" if checked else "registered",
            "checked_in_at": now_iso() if checked else None,
            "bib_number": str(bib) if checked else None,
            "group_id": group_for(a), "late_arrival": False,
            "flagged_incomplete": False, "walk_up": False,
            "created_at": now_iso(), "updated_at": now_iso(),
        })
        bib += 1

    # ---- Stations ----
    station_defs = [
        ("Athletic Testing", tpl_athletic["id"]),
        ("Hitting", tpl_hitting["id"]),
        ("Infield", tpl_infield["id"]),
        ("Outfield", tpl_outfield["id"]),
        ("Pitching", tpl_pitching["id"]),
        ("Catching", tpl_catching["id"]),
    ]
    station_ids = {}
    for name, tid in station_defs:
        sid = new_id()
        station_ids[name] = sid
        await db.stations.insert_one({
            "id": sid, "organization_id": ORG_ID, "event_id": event_id,
            "name": name, "template_id": tid, "group_ids": glist,
            "start_time": "09:30", "end_time": "14:30",
            "created_at": now_iso(), "updated_at": now_iso(),
        })

    # ---- Evaluator assignments ----
    eval_emails = ["eval1@pbgscout.com", "eval2@pbgscout.com", "eval3@pbgscout.com", "eval4@pbgscout.com"]
    assign_defs = [
        (eval_emails[0], "Athletic Testing", glist),
        (eval_emails[0], "Hitting", glist),
        (eval_emails[1], "Hitting", glist),
        (eval_emails[1], "Infield", glist),
        (eval_emails[2], "Outfield", glist),
        (eval_emails[2], "Pitching", glist),
        (eval_emails[3], "Catching", glist),
        (eval_emails[3], "Athletic Testing", glist),
    ]
    assignment_ids = []
    for email, station, gids in assign_defs:
        aid = new_id()
        assignment_ids.append((aid, email, station))
        await db.evaluator_assignments.insert_one({
            "id": aid, "organization_id": ORG_ID, "event_id": event_id,
            "station_id": station_ids[station], "evaluator_id": user_ids[email],
            "group_ids": gids, "created_by": user_ids["admin@pbgscout.com"],
            "created_at": now_iso(), "updated_at": now_iso(),
        })

    # ---- Evaluations (mixed complete / drafts) ----
    tpl_by_id = {t["id"]: t for t in all_templates}
    bench_list = benchmarks

    def gen_scores(template, athlete):
        scores = {}
        for m in template["metrics"]:
            mt = m["metric_type"]
            if mt == "rating_5":
                scores[m["id"]] = {"value": random.randint(2, 5)}
            elif mt == "time":
                key = m.get("key")
                base = {"sixty_yard_dash": (7.2, 9.5), "home_to_first": (4.5, 6.5), "pop_time": (2.0, 2.9)}.get(key, (5, 9))
                scores[m["id"]] = {"value": round(random.uniform(*base), 2)}
            elif mt == "velocity":
                key = m.get("key")
                base = {"exit_velocity": (48, 82), "throwing_velocity": (42, 74), "pitching_velocity": (42, 72)}.get(key, (40, 80))
                scores[m["id"]] = {"value": round(random.uniform(*base), 1)}
        return scores

    strengths_pool = ["Quick hands through the zone", "Strong first step", "Consistent throwing slot",
                      "Great energy and hustle", "Smooth glove work", "Aggressive base runner",
                      "Excellent focus between reps", "Balanced swing with good extension"]
    needs_pool = ["Needs work on backhand plays", "Tends to drift on breaking balls",
                  "Footwork on double plays", "Arm slot consistency", "First-step quickness",
                  "Pitch selection discipline", "Follow-through on throws"]

    submitted_count = 0
    draft_count = 0
    evaluators_cycle = 0
    for (assignment_id, email, station_name) in assignment_ids[:6]:
        sid = station_ids[station_name]
        station = await db.stations.find_one({"id": sid})
        template = tpl_by_id[station["template_id"]]
        entries = await db.event_athletes.find({"event_id": event_id, "status": "checked_in"}).to_list(100)
        random.shuffle(entries)
        subset = entries[:10]
        for i, entry in enumerate(subset):
            athlete = next((a for a in athletes if a["id"] == entry["athlete_id"]), None)
            if not athlete:
                continue
            scores = gen_scores(template, athlete)
            computed = compute_evaluation_scores(template, scores, bench_list,
                                                 age_group=athlete["age_group"], position=athlete["primary_position"])
            is_draft = i >= 7
            uid = user_ids[email]
            uname = next(s["name"] for s in STAFF if s["email"] == email)
            ts = iso(now - timedelta(hours=random.randint(1, 40)))
            doc = {
                "id": new_id(), "organization_id": ORG_ID, "event_id": event_id,
                "station_id": sid, "assignment_id": assignment_id,
                "template_id": template["id"], "athlete_id": athlete["id"],
                "evaluator_id": uid, "evaluator_name": uname,
                "status": "draft" if is_draft else ("approved" if random.random() > 0.6 else "submitted"),
                "scores": scores,
                "comments": {"strengths": random.choice(strengths_pool),
                             "development_needs": random.choice(needs_pool),
                             "general": "", "quick_tags": []},
                "computed": computed, "client_updated_at": ts,
                "created_at": ts, "updated_at": ts,
                "submitted_at": None if is_draft else ts,
                "reviewed_by": None, "review_note": None,
            }
            if doc["status"] == "approved":
                doc["reviewed_by"] = user_ids["headscout@pbgscout.com"]
                doc["reviewed_by_name"] = "Ramon Dela Cruz"
                doc["reviewed_at"] = ts
            existing = await db.evaluations.find_one({"event_id": event_id, "station_id": sid, "evaluator_id": uid, "athlete_id": athlete["id"]})
            if existing:
                continue
            await db.evaluations.insert_one(doc)
            if is_draft:
                draft_count += 1
            else:
                submitted_count += 1
        evaluators_cycle += 1

    # ---- Coach assessments + goals + scout notes ----
    coach_id = user_ids["coach@pbgscout.com"]
    scout_id = user_ids["headscout@pbgscout.com"]
    for a in athletes[:8]:
        await db.athlete_notes.insert_one({
            "id": new_id(), "organization_id": ORG_ID, "athlete_id": a["id"],
            "note_type": "assessment", "author_id": coach_id, "author_name": "Jun Mercado", "author_role": "coach",
            "assessment_type": random.choice(["Practice Observation", "Game Observation", "Training Assessment", "Development Check-In"]),
            "assessment_date": (now - timedelta(days=random.randint(5, 60))).strftime("%Y-%m-%d"),
            "team_or_program": a["current_team"],
            "strengths": random.choice(strengths_pool),
            "development_priorities": random.choice(needs_pool),
            "recommended_drills": "Tee work 3x/week; long-toss progression on Tuesdays.",
            "position_recommendation": None, "follow_up_date": (now + timedelta(days=30)).strftime("%Y-%m-%d"),
            "internal_note": None, "parent_visible_note": None, "goal_id": None,
            "ai_draft": None, "ai_model": None, "ai_generated_at": None,
            "ai_approved_by": None, "ai_approved_at": None, "ai_status": None,
            "created_at": iso(now - timedelta(days=random.randint(5, 60))), "updated_at": now_iso(),
        })
    for a in athletes[:6]:
        await db.athlete_goals.insert_one({
            "id": new_id(), "organization_id": ORG_ID, "athlete_id": a["id"],
            "title": random.choice(["Raise exit velocity by 5 mph", "Cut home-to-first by 0.3s",
                                    "Improve throwing accuracy", "Add 2-seam command", "Sharper outfield routes"]),
            "description": "Focused development block with weekly check-ins.",
            "category": random.choice(["Hitting", "Athleticism", "Arm Strength", "Defense"]),
            "starting_point": "Baseline recorded at spring camp",
            "target": "Measured improvement at next evaluation",
            "target_date": (now + timedelta(days=60)).strftime("%Y-%m-%d"),
            "assigned_coach_id": coach_id, "assigned_coach_name": "Jun Mercado",
            "recommended_drills": "Med-ball rotational throws; sprint mechanics drills.",
            "progress": random.choice([0, 10, 25, 40, 60]),
            "status": random.choice(["Active", "Improving", "Not Started"]),
            "notes": None, "created_by": coach_id,
            "created_at": iso(now - timedelta(days=random.randint(10, 45))), "updated_at": now_iso(),
        })
    # scout assessments on 3 players (flag 2)
    for i, a in enumerate(athletes[:3]):
        flag = i < 2
        await db.athlete_notes.insert_one({
            "id": new_id(), "organization_id": ORG_ID, "athlete_id": a["id"],
            "note_type": "scout_assessment", "author_id": scout_id, "author_name": "Ramon Dela Cruz", "author_role": "head_scout",
            "summary": "Projectable frame with above-average bat speed for the age group. Defensive actions are clean; needs consistency on throws under pressure.",
            "position_recommendation": a["primary_position"],
            "development_recommendation": "Continue strength program; add weekly live at-bats.",
            "flag_follow_up": flag, "team_consideration": flag, "confidential": False,
            "assessment_date": (now - timedelta(days=random.randint(1, 20))).strftime("%Y-%m-%d"),
            "created_at": iso(now - timedelta(days=random.randint(1, 20))), "updated_at": now_iso(),
        })
        if flag:
            await db.athletes.update_one({"id": a["id"]}, {"$set": {"flagged_follow_up": True, "position_projection": a["primary_position"]}})

    from routes_drills import ensure_org_drills
    drill_n = await ensure_org_drills(ORG_ID)
    # Sample verified metrics + PB milestone for demo athlete
    demo = next((x for x in athletes if x.get("email") and "demo" in (x.get("email") or "")), athletes[0])
    await db.verified_metrics.insert_one({
        "id": new_id(), "organization_id": ORG_ID, "athlete_id": demo["id"],
        "metric_key": "exit_velo", "value": 82.5, "unit": "mph",
        "verified_by": scout_id, "verified_by_name": "Ramon Dela Cruz",
        "measured_at": now.strftime("%Y-%m-%d"), "source": "seed", "created_at": now_iso(),
    })
    await db.milestones.insert_one({
        "id": new_id(), "organization_id": ORG_ID, "athlete_id": demo["id"],
        "kind": "personal_best", "metric_key": "exit_velo", "value": 82.5, "unit": "mph",
        "prev_value": None, "delta": None, "label": "New PB · Exit Velocity",
        "detail": "82.5 mph", "created_at": now_iso(),
    })

    # ---- Second org (owner can switch) — own athletes / events / programs ----
    await db.organizations.insert_one({
        "id": ORG_SOUTH_ID, "name": "PBG South",
        "full_name": "Philippines Baseball Group South Texas",
        "tagline": "Identify. Evaluate. Develop. Connect.",
        "contact_email": "south@pbgscout.com",
        "feature_flags": {"athlete_portal": True, "parent_portal": True, "ai_features": False},
        "created_at": now_iso(), "updated_at": now_iso(),
    })
    owner_uid = user_ids["owner@pbgscout.com"]
    await db.memberships.insert_one({
        "id": new_id(), "user_id": owner_uid, "organization_id": ORG_SOUTH_ID,
        "role": "owner", "active": True, "created_at": now_iso(),
    })
    # Dedicated south coach (single-org) so lists stay distinct
    south_coach = new_id()
    await db.users.insert_one({
        "id": south_coach, "email": "coach.south@pbgscout.com", "full_name": "Luis Navarro",
        "password_hash": pw, "active": True, "active_organization_id": ORG_SOUTH_ID,
        "created_at": now_iso(), "updated_at": now_iso(),
    })
    await db.memberships.insert_one({
        "id": new_id(), "user_id": south_coach, "organization_id": ORG_SOUTH_ID,
        "role": "coach", "active": True, "created_at": now_iso(),
    })
    south_athletes = []
    for i in range(6):
        a = {
            "id": new_id(), "organization_id": ORG_SOUTH_ID,
            "first_name": FIRST_NAMES[20 + i], "last_name": LAST_NAMES[20 + i],
            "date_of_birth": dob_for_age(12), "age": 12, "age_group": "12U",
            "primary_position": random.choice(POSITIONS), "secondary_positions": [],
            "bats": "R", "throws": "R", "status": "active",
            "city": "Houston", "state": "TX", "country": "USA",
            "current_team": "Houston Islanders",
            "shared_with_organizations": [],
            "created_at": now_iso(), "updated_at": now_iso(),
        }
        south_athletes.append(a)
        await db.athletes.insert_one(a)
    south_event = new_id()
    await db.events.insert_one({
        "id": south_event, "organization_id": ORG_SOUTH_ID,
        "name": "PBG South Summer Clinic", "event_type": "Clinic",
        "date": "2026-08-22", "start_time": "09:00", "end_time": "14:00",
        "location": "Houston Sports Complex", "status": "Registration Open",
        "age_groups": ["12U"], "description": "Short-term clinic for South org.",
        "created_at": now_iso(), "updated_at": now_iso(),
    })
    await db.programs.insert_one({
        "id": new_id(), "organization_id": ORG_SOUTH_ID,
        "name": "South Year-Round Development", "type": "training_block",
        "status": "open", "start_date": "2026-09-01", "end_date": "2027-05-31",
        "description": "Long-term program for PBG South athletes.",
        "created_at": now_iso(), "updated_at": now_iso(),
    })
    from routes_drills import ensure_org_drills as _ensure_south
    await _ensure_south(ORG_SOUTH_ID)

    print("Seed complete.")
    print(f"  Drills seeded: {drill_n}")
    print(f"  Org: PBG Midwest ({ORG_ID})")
    print(f"  Org: PBG South ({ORG_SOUTH_ID}) — owner can switch")
    print(f"  Staff: {len(STAFF)} + coach.south@pbgscout.com (password: {PASSWORD})")
    print(f"  Athletes: {len(athletes)} Midwest + {len(south_athletes)} South")
    print(f"  Event: PBG Midwest Spring Evaluation Camp ({event_id})")
    print(f"  Stations: {len(station_defs)}, Groups: 3, Templates: {len(all_templates)}")
    print(f"  Evaluations: {submitted_count} submitted/approved, {draft_count} drafts")


if __name__ == "__main__":
    app_env = (os.environ.get("APP_ENV") or "development").lower()
    if app_env == "production" and os.environ.get("ALLOW_PROD_SEED") != "I_UNDERSTAND_WIPE":
        print(
            "Refusing to seed: APP_ENV=production.\n"
            "Seed wipes the database. For a real org use: python bootstrap_admin.py\n"
            "To override (DESTROY data): ALLOW_PROD_SEED=I_UNDERSTAND_WIPE python seed.py",
            file=sys.stderr,
        )
        sys.exit(1)
    asyncio.run(main())
