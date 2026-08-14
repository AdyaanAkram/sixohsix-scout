"""Purge ALL athletes and their child data from the production database.

DESTRUCTIVE — run deliberately. Takes a full backup (laptop + R2) first, deletes
athlete media files from R2, then removes athletes, evaluations, metrics, media,
notes, goals, seasons, milestones, awards, watchlists, rosters, invitations, and
athlete/parent logins. Keeps: organizations, staff users, events, groups,
stations, templates, drills, audit log.

Run:  cd backend && MONGO_URL='<atlas url>' \
      R2_KEY='<access key>' R2_SECRET='<secret>' \
      .venv/bin/python scripts/purge_athletes.py --yes
"""
from __future__ import annotations

import asyncio
import datetime
import gzip
import json
import os
import sys

from motor.motor_asyncio import AsyncIOMotorClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

R2_ENDPOINT = "https://32ab65fa42de3131c5415160ce7e95a8.r2.cloudflarestorage.com"
R2_BUCKET = "606-id-media"
PURGE = ["athletes", "evaluations", "verified_metrics", "athlete_media", "athlete_notes",
         "athlete_goals", "athlete_seasons", "milestones", "awards", "scout_watchlist",
         "event_athletes", "invitations"]


async def main() -> int:
    if "--yes" not in sys.argv:
        print("Refusing to run without --yes (this deletes every athlete).")
        return 1
    from storage import S3Storage
    db = AsyncIOMotorClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=15000)["pbg_scout"]
    s3 = S3Storage(bucket=R2_BUCKET, region="auto", endpoint_url=R2_ENDPOINT,
                   access_key=os.environ["R2_KEY"], secret_key=os.environ["R2_SECRET"])

    # 1. Full backup first — laptop + R2.
    dump, total = {}, 0
    for n in sorted(await db.list_collection_names()):
        rows = await db[n].find({}, {"_id": 0}).to_list(100000)
        dump[n] = rows
        total += len(rows)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d-%H%M%S")
    blob = gzip.compress(json.dumps(dump, default=str).encode())
    path = os.path.expanduser(f"~/606-backups/pbg_scout-PREPURGE-{stamp}.json.gz")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "wb").write(blob)
    s3.put(f"backups/pbg_scout-PREPURGE-{stamp}.json.gz", blob, "application/gzip")
    print(f"pre-purge backup: {total} docs -> {path} + R2")

    # 2. Athlete media files out of R2 (rows carry their storage keys).
    n_files = 0
    for m in await db.athlete_media.find({}, {"_id": 0, "storage_key": 1}).to_list(10000):
        if m.get("storage_key"):
            try:
                s3.delete(m["storage_key"])
                n_files += 1
            except Exception:
                pass
    print(f"R2 media files deleted: {n_files}")

    # 3. Purge collections.
    counts = {}
    for coll in PURGE:
        counts[coll] = (await db[coll].delete_many({})).deleted_count

    # 4. Athlete/parent logins + memberships.
    mems = await db.memberships.find({"role": {"$in": ["athlete", "parent"]}},
                                     {"_id": 0, "user_id": 1}).to_list(1000)
    uids = [m["user_id"] for m in mems]
    counts["athlete_users"] = (await db.users.delete_many({"id": {"$in": uids}})).deleted_count
    counts["athlete_memberships"] = (
        await db.memberships.delete_many({"role": {"$in": ["athlete", "parent"]}})).deleted_count

    await db.audit_log.insert_one({
        "organization_id": "all", "action": "athletes_purged", "target_type": "maintenance",
        "target_id": "all", "details": counts, "actor_name": "owner-authorized purge",
        "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat()})
    print("purged:", {k: v for k, v in counts.items() if v})
    print("kept: orgs", await db.organizations.count_documents({}),
          "| staff users", await db.users.count_documents({}),
          "| events", await db.events.count_documents({}),
          "| templates", await db.evaluation_templates.count_documents({}))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
