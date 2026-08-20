"""Mark evaluated athletes as checked in.

The 13-18U import left 26 athletes on the roster as "registered" even though
every one of them has a submitted evaluation — they were at the event, the
check-in just never got recorded. That gap makes an evaluator's athlete list
show 24 of 50 athletes and makes station progress read "49/24".

Only touches event_athletes rows that BOTH are not checked_in AND have an
evaluation for that event. Dry run by default; pass --yes to write.

    /opt/homebrew/bin/python3 scripts/backfill_checkin.py          # preview
    /opt/homebrew/bin/python3 scripts/backfill_checkin.py --yes    # apply
"""
import asyncio
import os
import sys

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(".env.fly.local")
APPLY = "--yes" in sys.argv


async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    total = 0
    async for event in db.events.find({}, {"_id": 0, "id": 1, "name": 1}):
        evaluated = {
            e["athlete_id"]
            async for e in db.evaluations.find(
                {"event_id": event["id"]}, {"_id": 0, "athlete_id": 1})
        }
        if not evaluated:
            continue
        stale = [
            r["athlete_id"]
            async for r in db.event_athletes.find(
                {"event_id": event["id"], "status": {"$ne": "checked_in"},
                 "athlete_id": {"$in": list(evaluated)}},
                {"_id": 0, "athlete_id": 1})
        ]
        if not stale:
            continue
        total += len(stale)
        print(f"{event['name']}: {len(stale)} evaluated athletes not checked in")
        if APPLY:
            res = await db.event_athletes.update_many(
                {"event_id": event["id"], "athlete_id": {"$in": stale}},
                {"$set": {"status": "checked_in"}},
            )
            print(f"  updated {res.modified_count}")

    if not APPLY:
        print(f"\nDRY RUN — {total} rows would change. Re-run with --yes to apply.")
    else:
        print(f"\nDone — {total} rows.")


asyncio.run(main())
