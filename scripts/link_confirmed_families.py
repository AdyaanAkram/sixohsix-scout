"""Attach family contacts that were hand-confirmed, one athlete at a time.

Unlike relink_families.py (exact name + unique match), these are near-misses a
human looked at and approved individually, so each is spelled out explicitly
rather than matched by rule.

Two different kinds of link, and the difference matters:

  SAME_CHILD  - one child recorded twice under different spellings. The
                registry row is the same human, so the date of birth carries
                over along with the family contact.

  SIBLING     - a brother already linked to the family account. The parent and
                contact address are shared; the DATE OF BIRTH IS NOT. Copying
                it would give one child their brother's birthday.

Dry run by default.

    /opt/homebrew/bin/python3 scripts/link_confirmed_families.py          # preview
    /opt/homebrew/bin/python3 scripts/link_confirmed_families.py --yes    # apply
"""
import asyncio
import os
import sys

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(".env.fly.local")
APPLY = "--yes" in sys.argv

PBG = "org-pbg-midwest"
REGISTRY = "org-606-registry"

# (target org, target name)  <-  (source org, source name), kind
LINKS = [
    # Same child, surname spelled "Gunther" in the club's CSV import and
    # "Guenther" by the family. Both 15U-16U; dob 2010-04-09 gives age 16.
    ((PBG, "Ethan", "Gunther"), (REGISTRY, "Ethan", "Guenther"), "SAME_CHILD"),
    # Ian is Dean's older brother (15U-16U vs 13U-14U). Dean is already linked
    # to Crystal Harrington, so Ian takes the same parent and address — and
    # keeps his own (still unknown) birthday.
    ((PBG, "Ian", "Harrington"), (PBG, "Dean", "Harrington"), "SIBLING"),
]

CONTACT_FIELDS = ("guardian_user_id", "guardian_email", "guardian_name")


async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    changed = 0

    for (t_org, t_first, t_last), (s_org, s_first, s_last), kind in LINKS:
        target = await db.athletes.find_one(
            {"organization_id": t_org, "first_name": t_first, "last_name": t_last}, {"_id": 0})
        source = await db.athletes.find_one(
            {"organization_id": s_org, "first_name": s_first, "last_name": s_last}, {"_id": 0})

        label = f"{t_first} {t_last}"
        if not target or not source:
            print(f"  SKIP {label:20} — record not found")
            continue
        if target.get("guardian_user_id") or target.get("user_id"):
            print(f"  SKIP {label:20} — already linked to an account")
            continue

        patch = {f: source[f] for f in CONTACT_FIELDS if source.get(f) and not target.get(f)}
        if kind == "SAME_CHILD" and source.get("date_of_birth") and not target.get("date_of_birth"):
            patch["date_of_birth"] = source["date_of_birth"]
        if not patch:
            print(f"  SKIP {label:20} — nothing to copy")
            continue
        patch["self_service_enabled"] = True

        dob_note = patch.get("date_of_birth", "not copied (sibling)")
        print(f"  {label:20} [{kind:10}] <- {s_first} {s_last}: "
              f"{patch.get('guardian_email')}  dob: {dob_note}")
        changed += 1
        if APPLY:
            await db.athletes.update_one(
                {"id": target["id"], "organization_id": t_org}, {"$set": patch})

    print(f"\n{'Done' if APPLY else 'DRY RUN'} — {changed} record(s)"
          f"{'' if APPLY else ' would change. Re-run with --yes to apply.'}")


asyncio.run(main())
