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
from positions import AGE_BANDS, age_band_for_age, resolve_template
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
    return age_band_for_age(age)


# Bands that get position-specific templates. "Professional" gets the general
# skills form only — it is assigned manually and carries no seeded athletes.
TEMPLATE_BANDS = [b for b in AGE_BANDS if b != "Professional"]
YOUNGER_BANDS = ["7U-8U", "9U-10U", "11U-12U"]


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
    # One pool per canonical band (7U-8U through College) so every band is populated.
    age_pools = [(7, 8), (9, 10), (11, 12), (13, 14), (15, 16), (17, 18), (19, 21)]
    for i in range(30):
        age = random.randint(*age_pools[i % len(age_pools)])
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
    # Two metric vocabularies per position category: younger bands score movement,
    # fundamentals and makeup; older bands score verified measurements, position
    # tools, game performance and recruitability (spec §8/§9).
    CORE_CATS = [{"name": "Athleticism", "weight": 20}, {"name": "Hitting", "weight": 25},
                 {"name": "Defense", "weight": 25}, {"name": "Arm Strength", "weight": 15},
                 {"name": "Baseball IQ", "weight": 10}, {"name": "Coachability", "weight": 5}]

    def cats(*names):
        return [c for c in CORE_CATS if c["name"] in names]

    def general_young(band):
        ms = [
            metric("Athletic Movement", "Athleticism", "rating_5", weight=2, required=True, order=1),
            metric("Coordination and Balance", "Athleticism", "rating_5", order=2),
            metric("Running Mechanics", "Athleticism", "rating_5", order=3),
            metric("Hitting Fundamentals", "Hitting", "rating_5", weight=2, required=True, order=4),
            metric("Contact Consistency", "Hitting", "rating_5", weight=2, order=5),
            metric("Confidence in the Box", "Hitting", "rating_5", order=6),
            metric("Throwing Fundamentals", "Arm Strength", "rating_5", weight=2, order=7),
            metric("Throwing Accuracy", "Arm Strength", "rating_5", order=8),
            metric("Catching Fundamentals", "Defense", "rating_5", weight=2, required=True, order=9),
            metric("Ground-Ball Fundamentals", "Defense", "rating_5", weight=2, order=10),
            metric("Baseball Awareness", "Baseball IQ", "rating_5", weight=2, order=11),
            metric("Base-Running Awareness", "Baseball IQ", "rating_5", order=12),
            metric("Effort", "Coachability", "rating_5", required=True, order=13),
            metric("Coachability", "Coachability", "rating_5", weight=2, required=True, order=14),
            metric("Evaluator Notes", "Coachability", "comment", order=16),
        ]
        if band != "7U-8U":
            ms.insert(3, metric("Home-to-First Time", "Athleticism", "time", unit="sec",
                                higher=False, key="home_to_first", order=15))
        return CORE_CATS, ms

    def general_old(band):
        return CORE_CATS, [
            metric("Sixty-Yard Dash", "Athleticism", "time", unit="sec", weight=2, higher=False,
                   key="sixty_yard_dash", required=True, order=1),
            metric("Home-to-First Time", "Athleticism", "time", unit="sec", higher=False,
                   key="home_to_first", order=2),
            metric("Broad Jump", "Athleticism", "numeric", unit="in", key="broad_jump", order=3),
            metric("Vertical Jump", "Athleticism", "numeric", unit="in", key="vertical_jump", order=4),
            metric("Physical Projection", "Athleticism", "rating_5", weight=2, order=5),
            metric("Exit Velocity", "Hitting", "velocity", unit="mph", weight=2,
                   key="exit_velocity", required=True, order=6),
            metric("Bat Speed", "Hitting", "velocity", unit="mph", weight=2, key="bat_speed", order=7),
            metric("Hitting Approach", "Hitting", "rating_5", weight=2, order=8),
            metric("Game Performance - Hitting", "Hitting", "rating_5", key="game_performance_hitting", order=9),
            metric("Throwing Velocity", "Arm Strength", "velocity", unit="mph", weight=2,
                   key="throwing_velocity", order=10),
            metric("Arm Accuracy and Carry", "Arm Strength", "rating_5", order=11),
            metric("Defensive Impact", "Defense", "rating_5", weight=2, required=True, order=12),
            metric("Fielding Consistency", "Defense", "rating_5", weight=2, order=13),
            metric("Baseball IQ", "Baseball IQ", "rating_5", weight=2, key="baseball_iq_rating", order=14),
            metric("Competitive Consistency", "Baseball IQ", "rating_5", order=15),
            metric("Coachability", "Coachability", "rating_5", weight=2, required=True, order=16),
            metric("Recruitability", "Coachability", "rating_5", weight=2, order=17),
            metric("Evaluator Summary", "Coachability", "comment", order=18),
        ]

    def pitching_young(band):
        return cats("Arm Strength", "Defense", "Baseball IQ", "Coachability"), [
            metric("Throwing Fundamentals", "Arm Strength", "rating_5", weight=2, required=True, order=1),
            metric("Arm Action", "Arm Strength", "rating_5", weight=2, order=2),
            metric("Strike-Throwing Consistency", "Arm Strength", "rating_5", weight=2, required=True, order=3),
            metric("Balance on the Mound", "Defense", "rating_5", order=4),
            metric("Fielding the Position", "Defense", "rating_5", order=5),
            metric("Pitch Awareness", "Baseball IQ", "rating_5", order=6),
            metric("Effort", "Coachability", "rating_5", required=True, order=7),
            metric("Coachability", "Coachability", "rating_5", weight=2, order=8),
        ]

    def pitching_old(band):
        return cats("Arm Strength", "Defense", "Baseball IQ", "Coachability"), [
            metric("Pitching Velocity", "Arm Strength", "velocity", unit="mph", weight=2,
                   key="pitching_velocity", required=True, order=1),
            metric("Fastball Command", "Arm Strength", "rating_5", weight=2, required=True, order=2),
            metric("Breaking Ball", "Arm Strength", "rating_5", order=3),
            metric("Changeup", "Arm Strength", "rating_5", order=4),
            metric("Mechanical Repeatability", "Arm Strength", "rating_5", weight=2, order=5),
            metric("Fielding the Position", "Defense", "rating_5", order=6),
            metric("Holding Runners", "Defense", "rating_5", order=7),
            metric("Pitch Sequencing", "Baseball IQ", "rating_5", weight=2, order=8),
            metric("Mound Presence", "Baseball IQ", "rating_5", order=9),
            metric("Recruitability", "Coachability", "rating_5", weight=2, order=10),
            metric("Evaluator Summary", "Coachability", "comment", order=11),
        ]

    def catching_young(band):
        return cats("Defense", "Arm Strength", "Baseball IQ", "Coachability"), [
            metric("Receiving Fundamentals", "Defense", "rating_5", weight=2, required=True, order=1),
            metric("Blocking Fundamentals", "Defense", "rating_5", weight=2, order=2),
            metric("Catching Stance and Footwork", "Defense", "rating_5", order=3),
            metric("Throwing Fundamentals", "Arm Strength", "rating_5", weight=2, order=4),
            metric("Baseball Awareness", "Baseball IQ", "rating_5", order=5),
            metric("Effort", "Coachability", "rating_5", required=True, order=6),
            metric("Coachability", "Coachability", "rating_5", weight=2, order=7),
        ]

    def catching_old(band):
        return cats("Defense", "Arm Strength", "Baseball IQ", "Coachability"), [
            metric("Pop Time", "Arm Strength", "time", unit="sec", weight=2, higher=False,
                   key="pop_time", required=True, order=1),
            metric("Throwing Velocity", "Arm Strength", "velocity", unit="mph", weight=2,
                   key="throwing_velocity", order=2),
            metric("Transfer and Exchange", "Arm Strength", "rating_5", order=3),
            metric("Receiving and Framing", "Defense", "rating_5", weight=2, required=True, order=4),
            metric("Blocking", "Defense", "rating_5", weight=2, order=5),
            metric("Defensive Impact", "Defense", "rating_5", weight=2, order=6),
            metric("Game Calling", "Baseball IQ", "rating_5", weight=2, order=7),
            metric("Pitcher Management", "Baseball IQ", "rating_5", order=8),
            metric("Recruitability", "Coachability", "rating_5", weight=2, order=9),
            metric("Evaluator Summary", "Coachability", "comment", order=10),
        ]

    def infield_young(band):
        return cats("Defense", "Arm Strength", "Athleticism", "Coachability"), [
            metric("Ground-Ball Fundamentals", "Defense", "rating_5", weight=2, required=True, order=1),
            metric("Glove Work", "Defense", "rating_5", weight=2, order=2),
            metric("Infield Footwork", "Defense", "rating_5", order=3),
            metric("First-Base Footwork and Scoop", "Defense", "rating_5", key="first_base_footwork", order=4),
            metric("Throwing Fundamentals", "Arm Strength", "rating_5", weight=2, order=5),
            metric("Throwing Accuracy", "Arm Strength", "rating_5", order=6),
            metric("Lateral Movement", "Athleticism", "rating_5", order=7),
            metric("Effort", "Coachability", "rating_5", required=True, order=8),
            metric("Coachability", "Coachability", "rating_5", weight=2, order=9),
        ]

    def infield_old(band):
        return cats("Defense", "Arm Strength", "Athleticism", "Baseball IQ", "Coachability"), [
            metric("Throwing Velocity", "Arm Strength", "velocity", unit="mph", weight=2,
                   key="throwing_velocity", required=True, order=1),
            metric("Arm Accuracy and Carry", "Arm Strength", "rating_5", weight=2, order=2),
            metric("Infield Actions", "Defense", "rating_5", weight=2, required=True, order=3),
            metric("Range", "Defense", "rating_5", weight=2, order=4),
            metric("Double-Play Turn", "Defense", "rating_5", order=5),
            metric("First-Base Footwork and Scoop", "Defense", "rating_5", key="first_base_footwork", order=6),
            metric("Defensive Consistency", "Defense", "rating_5", weight=2, order=7),
            metric("Home-to-First Time", "Athleticism", "time", unit="sec", higher=False,
                   key="home_to_first", order=8),
            metric("Physical Projection", "Athleticism", "rating_5", order=9),
            metric("Baseball IQ", "Baseball IQ", "rating_5", weight=2, key="baseball_iq_rating", order=10),
            metric("Recruitability", "Coachability", "rating_5", weight=2, order=11),
            metric("Evaluator Summary", "Coachability", "comment", order=12),
        ]

    def outfield_young(band):
        return cats("Defense", "Arm Strength", "Athleticism", "Coachability"), [
            metric("Fly-Ball Fundamentals", "Defense", "rating_5", weight=2, required=True, order=1),
            metric("Routes to the Ball", "Defense", "rating_5", weight=2, order=2),
            metric("Communication", "Defense", "rating_5", order=3),
            metric("Throwing Fundamentals", "Arm Strength", "rating_5", weight=2, order=4),
            metric("Throwing Accuracy", "Arm Strength", "rating_5", order=5),
            metric("Running Mechanics", "Athleticism", "rating_5", order=6),
            metric("Effort", "Coachability", "rating_5", required=True, order=7),
            metric("Coachability", "Coachability", "rating_5", weight=2, order=8),
        ]

    def outfield_old(band):
        return cats("Defense", "Arm Strength", "Athleticism", "Baseball IQ", "Coachability"), [
            metric("Sixty-Yard Dash", "Athleticism", "time", unit="sec", weight=2, higher=False,
                   key="sixty_yard_dash", required=True, order=1),
            metric("Physical Projection", "Athleticism", "rating_5", order=2),
            metric("Throwing Velocity", "Arm Strength", "velocity", unit="mph", weight=2,
                   key="throwing_velocity", required=True, order=3),
            metric("Arm Accuracy and Carry", "Arm Strength", "rating_5", weight=2, order=4),
            metric("Routes and Reads", "Defense", "rating_5", weight=2, required=True, order=5),
            metric("Closing Speed", "Defense", "rating_5", weight=2, order=6),
            metric("Defensive Consistency", "Defense", "rating_5", weight=2, order=7),
            metric("Baseball IQ", "Baseball IQ", "rating_5", weight=2, key="baseball_iq_rating", order=8),
            metric("Recruitability", "Coachability", "rating_5", weight=2, order=9),
            metric("Evaluator Summary", "Coachability", "comment", order=10),
        ]

    def hitting_young(band):
        return cats("Hitting", "Baseball IQ", "Coachability"), [
            metric("Hitting Fundamentals", "Hitting", "rating_5", weight=2, required=True, order=1),
            metric("Contact Consistency", "Hitting", "rating_5", weight=2, order=2),
            metric("Swing Balance", "Hitting", "rating_5", order=3),
            metric("Confidence in the Box", "Hitting", "rating_5", order=4),
            metric("Pitch Awareness", "Baseball IQ", "rating_5", order=5),
            metric("Effort", "Coachability", "rating_5", required=True, order=6),
            metric("Coachability", "Coachability", "rating_5", weight=2, order=7),
        ]

    def hitting_old(band):
        return cats("Hitting", "Baseball IQ", "Coachability"), [
            metric("Exit Velocity", "Hitting", "velocity", unit="mph", weight=2,
                   key="exit_velocity", required=True, order=1),
            metric("Bat Speed", "Hitting", "velocity", unit="mph", weight=2, key="bat_speed", required=True, order=2),
            metric("Hitting Approach", "Hitting", "rating_5", weight=2, order=3),
            metric("Contact Quality", "Hitting", "rating_5", weight=2, order=4),
            metric("Power Projection", "Hitting", "rating_5", order=5),
            metric("Game Performance - Hitting", "Hitting", "rating_5", key="game_performance_hitting", order=6),
            metric("Pitch Recognition", "Baseball IQ", "rating_5", weight=2, order=7),
            metric("Approach Consistency", "Baseball IQ", "rating_5", order=8),
            metric("Recruitability", "Coachability", "rating_5", weight=2, order=9),
            metric("Evaluator Summary", "Coachability", "comment", order=10),
        ]

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

    # Every age band gets its own general form, and every band below Professional gets
    # its own copy of each position form. Both an age_group AND applies_to_positions are
    # set on the position forms — without both, resolve_template can never match on age.
    POSITION_FORMS = [
        ("Pitching", ["P"], pitching_young, pitching_old),
        ("Catching", ["C"], catching_young, catching_old),
        ("Infield", ["IF", "1B", "2B", "3B", "SS"], infield_young, infield_old),
        ("Outfield", ["OF", "LF", "CF", "RF"], outfield_young, outfield_old),
        ("Hitting", ["DH"], hitting_young, hitting_old),
    ]

    all_templates = []
    templates_by_band = {}
    for band in AGE_BANDS:
        young = band in YOUNGER_BANDS
        suffix = "Skills Evaluation" if young else "Showcase Evaluation"
        gen = station_template(f"{band} General {suffix}",
                               (general_young if young else general_old)(band), band)
        all_templates.append(gen)
        templates_by_band[band] = {"General": gen}
        if band not in TEMPLATE_BANDS:
            continue
        for label, applies_to, build_young, build_old in POSITION_FORMS:
            tpl = station_template(f"{band} {label} {suffix}",
                                   (build_young if young else build_old)(band),
                                   band, applies_to=applies_to)
            all_templates.append(tpl)
            templates_by_band[band][label] = tpl

    # Age-neutral station forms: no age_group and no positions, so they are only ever
    # reached through station.template_id or the org default.
    tpl_athletic = station_template("Athletic Testing Station", (
        cats("Athleticism"),
        [metric("Sixty-Yard Dash", "Athleticism", "time", unit="sec", weight=2, higher=False, key="sixty_yard_dash", order=1),
         metric("Home-to-First Time", "Athleticism", "time", unit="sec", higher=False, key="home_to_first", order=2),
         metric("Broad Jump", "Athleticism", "numeric", unit="in", key="broad_jump", order=3),
         metric("Vertical Jump", "Athleticism", "numeric", unit="in", key="vertical_jump", order=4),
         metric("Athletic Movement", "Athleticism", "rating_5", weight=2, required=True, order=5)]))
    tpl_hitting_station = station_template("Hitting Station", (
        cats("Hitting", "Coachability"),
        [metric("Exit Velocity", "Hitting", "velocity", unit="mph", weight=2, key="exit_velocity", order=1),
         metric("Bat Speed", "Hitting", "velocity", unit="mph", weight=2, key="bat_speed", order=2),
         metric("Hitting Approach", "Hitting", "rating_5", weight=2, required=True, order=3),
         metric("Contact Quality", "Hitting", "rating_5", weight=2, required=True, order=4),
         metric("Power Projection", "Hitting", "rating_5", order=5),
         metric("Coachability", "Coachability", "rating_5", order=6)]))
    tpl_baserunning = station_template("Base Running Station", (
        cats("Athleticism", "Baseball IQ"),
        [metric("Home-to-First Time", "Athleticism", "time", unit="sec", weight=2, higher=False, key="home_to_first", order=1),
         metric("Lead and Jump", "Athleticism", "rating_5", order=2),
         metric("Turns and Reads", "Baseball IQ", "rating_5", weight=2, required=True, order=3),
         metric("Base-Running Instincts", "Baseball IQ", "rating_5", weight=2, order=4)]))
    tpl_iq = station_template("Baseball IQ Station", (
        cats("Baseball IQ"),
        [metric("Situational Awareness", "Baseball IQ", "rating_5", weight=2, required=True, order=1),
         metric("Count and Pitch Awareness", "Baseball IQ", "rating_5", weight=2, order=2),
         metric("Game Decision-Making", "Baseball IQ", "rating_5", weight=2, order=3),
         metric("On-Field Communication", "Baseball IQ", "rating_5", order=4)]))
    tpl_character = station_template("Character and Coachability Station", (
        cats("Coachability"),
        [metric("Effort", "Coachability", "rating_5", weight=2, required=True, order=1),
         metric("Coachability", "Coachability", "rating_5", weight=2, required=True, order=2),
         metric("Confidence", "Coachability", "rating_5", order=3),
         metric("Teammate Impact", "Coachability", "rating_5", order=4),
         metric("Response to Failure", "Coachability", "rating_5", order=5),
         metric("Evaluator Notes", "Coachability", "comment", order=6)]))
    # Catch-all for athletes with no age band on file. Deliberately age-neutral — the
    # old default was an 8U-10U form, which mis-scored every older athlete.
    tpl_default = station_template("General Evaluation (All Ages)", (
        cats("Athleticism", "Hitting", "Defense", "Arm Strength", "Baseball IQ", "Coachability"),
        [metric("Athletic Movement", "Athleticism", "rating_5", weight=2, required=True, order=1),
         metric("Hitting Ability", "Hitting", "rating_5", weight=2, required=True, order=2),
         metric("Defensive Ability", "Defense", "rating_5", weight=2, required=True, order=3),
         metric("Arm Strength", "Arm Strength", "rating_5", weight=2, key="arm_strength_rating", order=4),
         metric("Baseball IQ", "Baseball IQ", "rating_5", weight=2, key="baseball_iq_rating", order=5),
         metric("Coachability", "Coachability", "rating_5", weight=2, required=True, order=6),
         metric("Evaluator Summary", "Coachability", "comment", order=7)]), is_default=True)

    all_templates += [tpl_athletic, tpl_hitting_station, tpl_baserunning, tpl_iq,
                      tpl_character, tpl_default]
    for t in all_templates:
        await db.evaluation_templates.insert_one(t)

    # ---- Benchmarks ----
    # Canonical metric keys only. scoring.find_benchmark compares age_group by exact
    # string, so these must be the same canonical bands athletes carry.
    METRIC_UNITS = {
        "sixty_yard_dash": ("sec", False), "home_to_first": ("sec", False),
        "pop_time": ("sec", False), "exit_velocity": ("mph", True),
        "bat_speed": ("mph", True), "throwing_velocity": ("mph", True),
        "pitching_velocity": ("mph", True), "broad_jump": ("in", True),
        "vertical_jump": ("in", True),
    }
    # band -> metric_key -> (floor_value, elite_value)
    BAND_BENCHMARKS = {
        "7U-8U": {"sixty_yard_dash": (13.5, 10.0), "home_to_first": (8.2, 6.0),
                  "exit_velocity": (25, 45), "bat_speed": (25, 40),
                  "throwing_velocity": (20, 38), "pitching_velocity": (20, 35),
                  "broad_jump": (30, 52), "vertical_jump": (6, 13)},
        "9U-10U": {"sixty_yard_dash": (12.0, 8.8), "home_to_first": (7.6, 5.4),
                   "exit_velocity": (32, 55), "bat_speed": (30, 48),
                   "throwing_velocity": (25, 48), "pitching_velocity": (25, 45),
                   "pop_time": (3.6, 2.6), "broad_jump": (38, 64), "vertical_jump": (8, 17)},
        "11U-12U": {"sixty_yard_dash": (11.0, 7.9), "home_to_first": (6.9, 4.9),
                    "exit_velocity": (40, 68), "bat_speed": (36, 58),
                    "throwing_velocity": (32, 60), "pitching_velocity": (32, 58),
                    "pop_time": (3.4, 2.4), "broad_jump": (48, 76), "vertical_jump": (11, 22)},
        "13U-14U": {"sixty_yard_dash": (10.0, 7.2), "home_to_first": (6.3, 4.5),
                    "exit_velocity": (50, 85), "bat_speed": (44, 68),
                    "throwing_velocity": (42, 72), "pitching_velocity": (40, 70),
                    "pop_time": (3.1, 2.2), "broad_jump": (58, 90), "vertical_jump": (14, 27)},
        "15U-16U": {"sixty_yard_dash": (8.8, 6.9), "home_to_first": (5.8, 4.3),
                    "exit_velocity": (58, 92), "bat_speed": (50, 75),
                    "throwing_velocity": (50, 82), "pitching_velocity": (48, 82),
                    "pop_time": (2.9, 2.05), "broad_jump": (66, 102), "vertical_jump": (17, 31)},
        "17U-18U": {"sixty_yard_dash": (8.2, 6.6), "home_to_first": (5.4, 4.1),
                    "exit_velocity": (65, 100), "bat_speed": (55, 80),
                    "throwing_velocity": (55, 88), "pitching_velocity": (55, 90),
                    "pop_time": (2.7, 1.95), "broad_jump": (72, 110), "vertical_jump": (19, 34)},
        "College": {"sixty_yard_dash": (7.9, 6.4), "home_to_first": (5.2, 4.0),
                    "exit_velocity": (72, 105), "bat_speed": (60, 85),
                    "throwing_velocity": (62, 92), "pitching_velocity": (62, 95),
                    "pop_time": (2.6, 1.85), "broad_jump": (78, 116), "vertical_jump": (21, 37)},
    }
    # Position benchmarks — find_benchmark prefers these over the age-only row (spec §4D).
    POSITION_BENCHMARKS = [
        ("pop_time", "C", "13U-14U", 3.0, 2.15), ("pop_time", "C", "15U-16U", 2.85, 2.0),
        ("pop_time", "C", "17U-18U", 2.65, 1.9), ("pop_time", "C", "College", 2.55, 1.82),
        ("pitching_velocity", "P", "11U-12U", 35, 62), ("pitching_velocity", "P", "13U-14U", 44, 74),
        ("pitching_velocity", "P", "15U-16U", 52, 85), ("pitching_velocity", "P", "17U-18U", 58, 92),
        ("pitching_velocity", "P", "College", 65, 97),
        ("throwing_velocity", "C", "13U-14U", 45, 75), ("throwing_velocity", "C", "15U-16U", 53, 84),
        ("throwing_velocity", "C", "17U-18U", 58, 90),
        ("throwing_velocity", "SS", "13U-14U", 46, 76), ("throwing_velocity", "SS", "15U-16U", 54, 85),
        ("throwing_velocity", "SS", "17U-18U", 60, 91),
        ("throwing_velocity", "CF", "15U-16U", 55, 86), ("throwing_velocity", "CF", "17U-18U", 60, 92),
        ("exit_velocity", "1B", "15U-16U", 62, 95), ("exit_velocity", "1B", "17U-18U", 68, 102),
        ("sixty_yard_dash", "CF", "15U-16U", 8.4, 6.7), ("sixty_yard_dash", "CF", "17U-18U", 7.9, 6.4),
        ("home_to_first", "C", "17U-18U", 5.8, 4.4),
    ]

    benchmarks = []
    for band, rows in BAND_BENCHMARKS.items():
        for key, (floor_v, elite_v) in rows.items():
            unit, higher = METRIC_UNITS[key]
            benchmarks.append({"metric_key": key, "age_group": band, "position": None,
                               "unit": unit, "higher_is_better": higher,
                               "floor_value": floor_v, "elite_value": elite_v})
    for key, pos, band, floor_v, elite_v in POSITION_BENCHMARKS:
        unit, higher = METRIC_UNITS[key]
        benchmarks.append({"metric_key": key, "age_group": band, "position": pos,
                           "unit": unit, "higher_is_better": higher,
                           "floor_value": floor_v, "elite_value": elite_v})
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
        "description": "Spring player evaluation and development camp spanning 7U through College.",
        "age_groups": list(AGE_BANDS[:-1]), "status": "Evaluation Active",
        "created_by": user_ids["admin@pbgscout.com"],
        "created_at": iso(now - timedelta(days=21)), "updated_at": now_iso(),
    })

    # ---- Groups ----
    group_ids = {}
    GROUP_BANDS = [("Group A - Youth", ["7U-8U", "9U-10U"]),
                   ("Group B - Middle", ["11U-12U", "13U-14U"]),
                   ("Group C - Upper", ["15U-16U", "17U-18U", "College", "Professional"])]
    for gname, _bands in GROUP_BANDS:
        gid = new_id()
        group_ids[gname] = gid
        await db.event_groups.insert_one({
            "id": gid, "organization_id": ORG_ID, "event_id": event_id,
            "name": gname, "created_at": now_iso(),
        })
    glist = list(group_ids.values())

    # ---- Roster + check-in ----
    def group_for(a):
        ag = a.get("age_group") or "11U-12U"
        for idx, (gname, bands) in enumerate(GROUP_BANDS):
            if ag in bands:
                return glist[idx]
        return glist[1]

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
    # A station's template is only the fallback — resolve_template picks the athlete's
    # own age+position form first. The mid band is the sane default for a mixed camp.
    mid = templates_by_band["13U-14U"]
    station_defs = [
        ("Athletic Testing", tpl_athletic["id"]),
        ("Hitting", tpl_hitting_station["id"]),
        ("Infield", mid["Infield"]["id"]),
        ("Outfield", mid["Outfield"]["id"]),
        ("Pitching", mid["Pitching"]["id"]),
        ("Catching", mid["Catching"]["id"]),
        ("Base Running", tpl_baserunning["id"]),
        ("Character and Coachability", tpl_character["id"]),
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
        """Draw measurements from the athlete's own band benchmark so seeded values are
        plausible for their age rather than uniform across the whole camp."""
        band = BAND_BENCHMARKS.get(athlete.get("age_group")) or BAND_BENCHMARKS["11U-12U"]
        scores = {}
        for m in template["metrics"]:
            mt = m["metric_type"]
            if mt == "rating_5":
                scores[m["id"]] = {"value": random.randint(2, 5)}
            elif mt == "rating_10":
                scores[m["id"]] = {"value": random.randint(4, 10)}
            elif mt in ("time", "velocity", "numeric"):
                span = band.get(m.get("key"))
                if not span:
                    continue
                lo, hi = sorted(span)
                val = random.uniform(lo + (hi - lo) * 0.15, hi - (hi - lo) * 0.1)
                scores[m["id"]] = {"value": round(val, 2 if mt == "time" else 1)}
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
        entries = await db.event_athletes.find({"event_id": event_id, "status": "checked_in"}).to_list(100)
        random.shuffle(entries)
        subset = entries[:10]
        for i, entry in enumerate(subset):
            athlete = next((a for a in athletes if a["id"] == entry["athlete_id"]), None)
            if not athlete:
                continue
            # Seed through the real resolver so stored evaluations carry the same
            # age+position template the app would serve.
            template, _reason = resolve_template(
                all_templates, position=athlete["primary_position"],
                station_template_id=station["template_id"], age_group=athlete["age_group"])
            template = template or tpl_by_id[station["template_id"]]
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

    # ---- Two seasons stacked under one permanent ID (spec §6 demo) ----
    # Same athlete, prior + current season, each with its own date range and a
    # dated verified metric so /records and /career can prove the split.
    for yr, team, ev in ((2025, "606 Prospects 13U", 78.0), (2026, "606 Prospects 14U", 84.5)):
        season = {
            "id": new_id(), "athlete_id": demo["id"], "organization_id": ORG_ID,
            "year": yr, "team": team, "organization_name": "60'6\" Athletics",
            "age_group": demo.get("age_group"), "height": demo.get("height"),
            "weight": demo.get("weight"),
            "start_date": f"{yr}-01-01", "end_date": f"{yr}-12-31",
            "created_by": scout_id, "created_at": now_iso(), "updated_at": now_iso(),
        }
        await db.athlete_seasons.insert_one(season)
        await db.verified_metrics.insert_one({
            "id": new_id(), "organization_id": ORG_ID, "athlete_id": demo["id"],
            "metric_key": "exit_velocity", "value": ev, "unit": "mph",
            "verified_by": scout_id, "verified_by_name": "Ramon Dela Cruz",
            "is_verified": True, "source": "event_verified",
            "season_id": season["id"],
            "measured_at": f"{yr}-06-15", "created_at": now_iso(),
        })
    # Append-only physical history → drives position_change / team_change timeline
    # events (spec §7). Mirrors what PATCH /athletes writes on a real edit.
    await db.athletes.update_one({"id": demo["id"]}, {"$push": {"physical_history": {"$each": [
        {"field": "current_team", "from": "606 Prospects 13U", "to": "606 Prospects 14U",
         "at": "2026-01-05T12:00:00+00:00", "by": scout_id, "by_name": "Ramon Dela Cruz"},
        {"field": "primary_position", "from": "2B", "to": "SS",
         "at": "2026-02-10T12:00:00+00:00", "by": scout_id, "by_name": "Ramon Dela Cruz"},
    ]}}})

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
            "date_of_birth": dob_for_age(12), "age": 12, "age_group": age_group_for_age(12),
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
        "age_groups": ["11U-12U"], "description": "Short-term clinic for South org.",
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
    print(f"  Stations: {len(station_defs)}, Groups: {len(GROUP_BANDS)}, Templates: {len(all_templates)}")
    print(f"  Age bands: {', '.join(AGE_BANDS)}")
    print(f"  Benchmarks: {len(benchmarks)} ({len(POSITION_BENCHMARKS)} position-specific)")
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
