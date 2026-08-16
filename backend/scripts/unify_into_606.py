"""One-time fix (16 Aug 2026): move events accidentally built in the PBG South
demo org into the real org (org-pbg-midwest / "606 Athletics"), so the roster,
templates, join-code families, pending approvals and today's events all live in
ONE organization.

Moves: events, stations, event groups, event rosters, evaluator assignments,
evaluations (currently zero), and the real athlete added this morning
(Jr Lopez). Clears any station template refs that don't resolve in the target
org. Points the owner account at 606 Athletics. Audit-logged.

Run from the repo root:
    /opt/homebrew/bin/python3 backend/scripts/unify_into_606.py --yes
(without --yes it prints what it WOULD do)
"""
import argparse
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from pymongo import MongoClient

SOUTH, TARGET = "org-pbg-south", "org-pbg-midwest"
COLLS = ("events", "stations", "event_groups", "event_athletes",
         "evaluator_assignments", "evaluations")


def env_from_file(path: Path):
    for line in path.read_text().splitlines():
        if line.startswith("MONGO_URL="):
            os.environ.setdefault("MONGO_URL", line.split("=", 1)[1].strip().strip('"'))
        if line.startswith("DB_NAME="):
            os.environ.setdefault("DB_NAME", line.split("=", 1)[1].strip().strip('"'))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--yes", action="store_true", help="actually write (default: dry-run)")
    args = ap.parse_args()

    root = Path(__file__).resolve().parents[2]
    envf = root / ".env.fly.local"
    if envf.exists():
        env_from_file(envf)
    mongo_url, db_name = os.environ.get("MONGO_URL"), os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        sys.exit("MONGO_URL / DB_NAME not found (.env.fly.local)")
    db = MongoClient(mongo_url, serverSelectionTimeoutMS=20000)[db_name]
    ts = datetime.now(timezone.utc).isoformat()

    print(f"{'DRY RUN — ' if not args.yes else ''}moving PBG South data into 606 Athletics:")
    for coll in COLLS:
        n = db[coll].count_documents({"organization_id": SOUTH})
        print(f"  {coll}: {n}")
        if args.yes and n:
            db[coll].update_many({"organization_id": SOUTH}, {"$set": {"organization_id": TARGET}})

    jl = db.athletes.find_one({"organization_id": SOUTH, "last_name": "Lopez", "first_name": "Jr"})
    if jl:
        dup = db.athletes.find_one({
            "organization_id": TARGET, "date_of_birth": jl.get("date_of_birth"),
            "first_name": {"$regex": "^Jr$", "$options": "i"},
            "last_name": {"$regex": "^Lopez$", "$options": "i"}})
        if dup:
            print("  Jr Lopez already exists in 606 Athletics — archiving the South copy")
            if args.yes:
                db.athletes.update_one({"_id": jl["_id"]}, {"$set": {"status": "archived"}})
        else:
            print("  Jr Lopez -> 606 Athletics")
            if args.yes:
                db.athletes.update_one({"_id": jl["_id"]},
                                       {"$set": {"organization_id": TARGET, "updated_at": ts}})

    if args.yes:
        for st in db.stations.find({"organization_id": TARGET, "template_id": {"$ne": None}}):
            if not db.evaluation_templates.find_one({"id": st["template_id"], "organization_id": TARGET}):
                db.stations.update_one({"_id": st["_id"]}, {"$set": {"template_id": None}})
                print(f"  cleared dangling template ref on station {st.get('name')}")
        db.users.update_one({"email": "owner@606athletics.com"},
                            {"$set": {"active_organization_id": TARGET}})
        db.users.update_one({"email": "darelltobias@gmail.com"},
                            {"$set": {"active_organization_id": "org-606-registry"}})
        db.audit_log.insert_one({
            "organization_id": TARGET, "action": "org_data_migration",
            "entity_type": "organization", "entity_id": TARGET,
            "meta": {"from": SOUTH, "reason": "events built in wrong org; unified into 606 Athletics"},
            "actor_name": "unify_into_606.py (owner-run)", "created_at": ts})
        print("owner account now opens in 606 Athletics.")
        print("DONE — refresh the app; use the org switcher if you're still in PBG South.")
    else:
        print("\nDry run only. Re-run with --yes to apply.")


if __name__ == "__main__":
    main()
