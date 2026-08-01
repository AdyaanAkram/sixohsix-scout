#!/usr/bin/env python3
"""Create the first organization + owner account without wiping data.

Safe for production. Idempotent if the email already exists.

  python bootstrap_admin.py \
    --org "60'6 Athletics" \
    --email owner@yourdomain.com \
    --name "Camp Director" \
    --password 'use-a-long-random-password'
"""
from __future__ import annotations

import argparse
import asyncio
import sys

from auth import hash_password
from db import db, new_id, now_iso


async def main() -> int:
    p = argparse.ArgumentParser(description="Bootstrap first org + owner")
    p.add_argument("--org", required=True, help="Organization display name")
    p.add_argument("--email", required=True)
    p.add_argument("--name", required=True, help="Owner full name")
    p.add_argument("--password", required=True)
    p.add_argument("--org-id", default=None, help="Optional fixed organization id")
    args = p.parse_args()

    if len(args.password) < 10:
        print("Password must be at least 10 characters.", file=sys.stderr)
        return 1

    email = args.email.strip().lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        mem = await db.memberships.find_one({"user_id": existing["id"], "role": "owner"})
        print(f"User {email} already exists (id={existing['id']}).")
        if mem:
            print(f"Already an owner of org {mem['organization_id']}. Nothing to do.")
            return 0
        print("User exists but is not an owner — aborting to avoid surprise role changes.")
        return 1

    org_id = args.org_id or new_id()
    uid = new_id()
    ts = now_iso()
    await db.organizations.insert_one({
        "id": org_id,
        "name": args.org.strip(),
        "created_at": ts,
        "updated_at": ts,
        "settings": {},
    })
    await db.users.insert_one({
        "id": uid,
        "email": email,
        "full_name": args.name.strip(),
        "password_hash": hash_password(args.password),
        "active": True,
        "created_at": ts,
        "updated_at": ts,
    })
    await db.memberships.insert_one({
        "id": new_id(),
        "user_id": uid,
        "organization_id": org_id,
        "role": "owner",
        "active": True,
        "created_at": ts,
    })
    print("Created organization + owner.")
    print(f"  org_id:  {org_id}")
    print(f"  email:   {email}")
    print(f"  role:    owner")
    print("Sign in at /signin and invite staff from the Staff page.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
