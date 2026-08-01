"""Ensure Mongo indexes for multi-tenant performance and uniqueness."""
from __future__ import annotations

import logging

from db import db

logger = logging.getLogger("indexes")


async def ensure_indexes() -> None:
    """Idempotent index creation — safe to run on every boot."""
    specs = [
        ("athletes", [("organization_id", 1), ("status", 1)]),
        ("athletes", [("organization_id", 1), ("last_name", 1), ("first_name", 1)]),
        ("athletes", [("organization_id", 1), ("user_id", 1)]),
        ("athletes", [("organization_id", 1), ("guardian_user_id", 1)]),
        ("events", [("organization_id", 1), ("date", -1)]),
        ("evaluations", [("organization_id", 1), ("athlete_id", 1), ("status", 1)]),
        ("evaluations", [("organization_id", 1), ("event_id", 1), ("station_id", 1)]),
        ("memberships", [("user_id", 1), ("active", 1)]),
        ("memberships", [("organization_id", 1), ("user_id", 1)]),
        ("invitations", [("token", 1)], {"unique": True}),
        ("invitations", [("organization_id", 1), ("status", 1)]),
        ("audit_logs", [("organization_id", 1), ("created_at", -1)]),
        ("programs", [("organization_id", 1), ("status", 1)]),
        ("programs", [("organization_id", 1), ("start_date", 1)]),
        ("sessions", [("organization_id", 1), ("program_id", 1), ("date", 1)]),
        ("enrollments", [("organization_id", 1), ("program_id", 1), ("athlete_id", 1)], {"unique": True}),
        ("attendance", [("organization_id", 1), ("session_id", 1), ("athlete_id", 1)], {"unique": True}),
        ("locations", [("organization_id", 1), ("name", 1)]),
        ("verified_metrics", [("organization_id", 1), ("athlete_id", 1), ("metric_key", 1)]),
        ("milestones", [("organization_id", 1), ("athlete_id", 1), ("created_at", -1)]),
        ("notifications", [("user_id", 1), ("read", 1), ("created_at", -1)]),
        ("awards", [("organization_id", 1), ("status", 1)]),
        ("awards", [("organization_id", 1), ("athlete_id", 1)]),
        ("drills", [("organization_id", 1), ("active", 1)]),
        ("development_plans", [("organization_id", 1), ("athlete_id", 1), ("created_at", -1)]),
        ("event_invites", [("code", 1)], {"unique": True}),
        ("event_invites", [("organization_id", 1), ("event_id", 1)]),
        ("athletes", [("public_slug", 1)], {"unique": True, "sparse": True}),
        ("athlete_media", [("organization_id", 1), ("consent_status", 1)]),
    ]
    for item in specs:
        coll_name, keys = item[0], item[1]
        kwargs = item[2] if len(item) > 2 else {}
        try:
            await db[coll_name].create_index(keys, background=True, **kwargs)
        except Exception as e:
            logger.warning("index %s %s: %s", coll_name, keys, e)
    logger.info("Mongo indexes ensured")
