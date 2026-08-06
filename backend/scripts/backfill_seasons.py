"""Backfill season linkage (spec §6) — RE-RUNNABLE, non-destructive.

For every organization and athlete this script:
  1. Ensures an `athlete_seasons` record exists for each year the athlete's
     evaluations / metrics / media / goals span (creates only absent years).
  2. Sets `season_id` on existing metrics / media / goals rows where it is
     currently ABSENT and derivable from the record's own date.

It NEVER overwrites an existing season_id, never edits evaluations (the
append-only submit path is untouched — evaluations are grouped by event date at
read time), and never deletes anything. A second run fills nothing new.

Run:  cd backend && .venv/bin/python scripts/backfill_seasons.py
"""
import asyncio
import os
import sys

# Make the backend package importable when run from backend/ or scripts/.
_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

from db import db, new_id, now_iso  # noqa: E402
from routes_players import season_for_date  # noqa: E402


def _year_of(date_str):
    if not date_str:
        return None
    try:
        return int(str(date_str)[:4])
    except (ValueError, TypeError):
        return None


async def _event_dates(org_id):
    rows = await db.events.find(
        {"organization_id": org_id}, {"_id": 0, "id": 1, "date": 1}).to_list(5000)
    return {r["id"]: r.get("date") for r in rows}


async def backfill_org(org_id):
    stats = {"seasons_created": 0, "metrics_linked": 0, "media_linked": 0, "goals_linked": 0}
    event_dates = await _event_dates(org_id)
    athletes = await db.athletes.find(
        {"organization_id": org_id}, {"_id": 0, "id": 1}).to_list(10000)

    for a in athletes:
        aid = a["id"]

        # ---- Gather the years this athlete has any record in ----
        needed_years = set()

        evals = await db.evaluations.find(
            {"athlete_id": aid, "organization_id": org_id},
            {"_id": 0, "event_id": 1}).to_list(2000)
        for e in evals:
            needed_years.add(_year_of(event_dates.get(e.get("event_id"))))

        metrics = await db.verified_metrics.find(
            {"athlete_id": aid, "organization_id": org_id},
            {"_id": 0, "id": 1, "measured_at": 1, "created_at": 1, "season_id": 1}).to_list(5000)
        for m in metrics:
            needed_years.add(_year_of(m.get("measured_at") or m.get("created_at")))

        media = await db.athlete_media.find(
            {"athlete_id": aid, "organization_id": org_id},
            {"_id": 0, "id": 1, "capture_date": 1, "created_at": 1, "season_id": 1}).to_list(5000)
        for m in media:
            needed_years.add(_year_of(m.get("capture_date") or m.get("created_at")))

        goals = await db.athlete_goals.find(
            {"athlete_id": aid, "organization_id": org_id},
            {"_id": 0, "id": 1, "start_date": 1, "created_at": 1, "season_id": 1}).to_list(5000)
        for g in goals:
            needed_years.add(_year_of(g.get("start_date") or g.get("created_at")))

        needed_years.discard(None)
        if not needed_years and not (metrics or media or goals):
            continue

        # ---- Load seasons; create the absent years only ----
        seasons = await db.athlete_seasons.find(
            {"athlete_id": aid, "organization_id": org_id}, {"_id": 0}).to_list(500)
        existing_years = {s.get("year") for s in seasons}

        for yr in sorted(needed_years):
            if yr in existing_years:
                continue
            # A custom-range season already covering mid-year also counts as covered.
            if season_for_date(seasons, f"{yr}-06-15"):
                continue
            doc = {
                "id": new_id(), "athlete_id": aid, "organization_id": org_id,
                "year": yr, "team": None, "organization_name": None, "age_group": None,
                "height": None, "weight": None, "start_date": None, "end_date": None,
                "auto_created": True, "created_by": None,
                "created_at": now_iso(), "updated_at": now_iso(),
            }
            await db.athlete_seasons.insert_one(doc)
            seasons.append({k: v for k, v in doc.items()})
            existing_years.add(yr)
            stats["seasons_created"] += 1

        # ---- Set season_id where absent and derivable ----
        async def _link(rows, coll, date_fields, stat_key):
            for r in rows:
                if r.get("season_id"):
                    continue
                date_str = next((r.get(f) for f in date_fields if r.get(f)), None)
                matched = season_for_date(seasons, date_str)
                if matched:
                    await coll.update_one(
                        {"id": r["id"], "organization_id": org_id},
                        {"$set": {"season_id": matched["id"]}})
                    stats[stat_key] += 1

        await _link(metrics, db.verified_metrics, ("measured_at", "created_at"), "metrics_linked")
        await _link(media, db.athlete_media, ("capture_date", "created_at"), "media_linked")
        await _link(goals, db.athlete_goals, ("start_date", "created_at"), "goals_linked")

    return stats


async def main():
    orgs = await db.organizations.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)
    print(f"Backfilling season linkage across {len(orgs)} organization(s)...\n")
    totals = {"seasons_created": 0, "metrics_linked": 0, "media_linked": 0, "goals_linked": 0}
    for org in orgs:
        stats = await backfill_org(org["id"])
        for k in totals:
            totals[k] += stats[k]
        print(f"  {org.get('name') or org['id']}: "
              f"{stats['seasons_created']} seasons created, "
              f"{stats['metrics_linked']} metrics / {stats['media_linked']} media / "
              f"{stats['goals_linked']} goals linked")
    print("\nBackfill summary (all orgs):")
    print(f"  Seasons created : {totals['seasons_created']}")
    print(f"  Metrics linked  : {totals['metrics_linked']}")
    print(f"  Media linked    : {totals['media_linked']}")
    print(f"  Goals linked    : {totals['goals_linked']}")
    if all(v == 0 for v in totals.values()):
        print("  Nothing to fill — already fully linked (idempotent).")


if __name__ == "__main__":
    asyncio.run(main())
