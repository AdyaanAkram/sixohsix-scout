"""Re-link family accounts onto org athlete records that never got matched.

A family self-registers into the 60'6" registry, then their child is matched
into the club's org by _link_or_copy_athlete using an exact name + exact DOB
rule. When the club's record carries no date of birth — as the CSV-imported
records do — that rule cannot match, so the club record never receives the
family's account link or contact address.

The visible effect: the parent signs in and cannot see their own child's
results (the portal resolves athletes by user_id / guardian_user_id), and a
published assessment sends them no email, because the address lives on the
registry record rather than the club one.

This copies the linkage across. It is deliberately strict:

  * exact normalized full-name match, and ONLY when that name is unique on
    both sides — never guesses between two children with the same name
  * only touches a club record that has NO user_id and NO guardian_user_id
  * only fills fields that are empty; never overwrites existing data
  * skips any pair whose dates of birth are both present and disagree

Dry run by default.

    /opt/homebrew/bin/python3 scripts/relink_families.py          # preview
    /opt/homebrew/bin/python3 scripts/relink_families.py --yes    # apply
"""
import asyncio
import collections
import os
import re
import sys

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(".env.fly.local")
APPLY = "--yes" in sys.argv
REGISTRY = "org-606-registry"

FIELDS = ("_id", "id", "first_name", "last_name", "date_of_birth", "user_id",
          "guardian_user_id", "guardian_email", "guardian_name",
          "self_service_enabled", "organization_id")
PROJ = {k: 1 for k in FIELDS if k != "_id"} | {"_id": 0}

COPY_FIELDS = ("guardian_user_id", "user_id", "guardian_email", "guardian_name")


def norm(a):
    return re.sub(r"[^a-z]", "", ((a.get("first_name") or "") + (a.get("last_name") or "")).lower())


def unique_by_name(rows):
    """name -> record, keeping only names that appear exactly once."""
    counts = collections.Counter(norm(r) for r in rows)
    return {norm(r): r for r in rows if counts[norm(r)] == 1}


async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

    registry = await db.athletes.find({"organization_id": REGISTRY}, PROJ).to_list(2000)
    reg_by_name = unique_by_name(registry)

    planned, skipped = [], []
    async for org in db.organizations.find({}, {"_id": 0, "id": 1, "name": 1}):
        if org["id"] == REGISTRY:
            continue
        club = await db.athletes.find({"organization_id": org["id"]}, PROJ).to_list(2000)
        club_by_name = unique_by_name(club)

        for name, c in club_by_name.items():
            if c.get("user_id") or c.get("guardian_user_id"):
                continue                                  # already linked
            r = reg_by_name.get(name)
            if not r:
                continue
            if not (r.get("guardian_user_id") or r.get("user_id")):
                continue                                  # registry side has no account either
            cd, rd = c.get("date_of_birth"), r.get("date_of_birth")
            if cd and rd and cd != rd:
                skipped.append((org["name"], c, "dates of birth disagree"))
                continue

            patch = {k: r[k] for k in COPY_FIELDS if r.get(k) and not c.get(k)}
            if not patch:
                continue
            patch["self_service_enabled"] = True
            if rd and not cd:
                patch["date_of_birth"] = rd               # fill the gap that caused the miss
            planned.append((org, c, patch))

    for org, c, patch in planned:
        keys = ", ".join(k for k in patch if k != "self_service_enabled")
        print(f"  {org['name']:16} {c['first_name']} {c['last_name']:22} <- {keys}")
    for org_name, c, why in skipped:
        print(f"  SKIP {org_name:16} {c['first_name']} {c['last_name']:22} ({why})")

    if APPLY:
        for org, c, patch in planned:
            await db.athletes.update_one(
                {"id": c["id"], "organization_id": org["id"]}, {"$set": patch})
        print(f"\nDone — {len(planned)} athlete records re-linked.")
    else:
        print(f"\nDRY RUN — {len(planned)} records would be re-linked, "
              f"{len(skipped)} skipped. Re-run with --yes to apply.")


asyncio.run(main())
