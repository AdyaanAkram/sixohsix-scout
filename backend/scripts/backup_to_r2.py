"""Nightly database snapshot to R2 — standalone, no app imports.

Runs in GitHub Actions (see .github/workflows/nightly-backup.yml). Dumps every
collection to one gzipped JSON blob, uploads to the R2 bucket under
backups/nightly/, and prunes that prefix to the newest KEEP copies. Manual
snapshots under backups/ (outside nightly/) are never touched.

Required env: BACKUP_MONGO_URL, R2_ENDPOINT_URL, R2_ACCESS_KEY, R2_SECRET_KEY,
R2_BUCKET. Optional: BACKUP_DB_NAME (default pbg_scout), BACKUP_KEEP (default 30).
"""
from __future__ import annotations

import datetime
import gzip
import json
import os
import sys

import boto3
from botocore.config import Config
from pymongo import MongoClient

KEEP = int(os.environ.get("BACKUP_KEEP", "30"))
DB_NAME = os.environ.get("BACKUP_DB_NAME", "pbg_scout")
PREFIX = "backups/nightly/"


def main() -> int:
    client = MongoClient(os.environ["BACKUP_MONGO_URL"], serverSelectionTimeoutMS=20000)
    db = client[DB_NAME]

    dump: dict[str, list] = {}
    total = 0
    for name in sorted(db.list_collection_names()):
        rows = list(db[name].find({}, {"_id": 0}))
        dump[name] = rows
        total += len(rows)
    if total == 0:
        # An empty dump almost certainly means a wrong DB name/URL — refuse to
        # write it so a misconfiguration can never rotate real backups away.
        print("ABORT: 0 documents found — refusing to store an empty backup.")
        return 1

    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d-%H%M%S")
    blob = gzip.compress(json.dumps(dump, default=str).encode())
    key = f"{PREFIX}{DB_NAME}-{stamp}.json.gz"

    s3 = boto3.client(
        "s3",
        region_name="auto",
        endpoint_url=os.environ["R2_ENDPOINT_URL"],
        aws_access_key_id=os.environ["R2_ACCESS_KEY"],
        aws_secret_access_key=os.environ["R2_SECRET_KEY"],
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )
    bucket = os.environ["R2_BUCKET"]
    s3.put_object(Bucket=bucket, Key=key, Body=blob, ContentType="application/gzip")
    print(f"backed up {len(dump)} collections / {total} documents "
          f"({len(blob) / 1024:.0f} KB) -> {bucket}/{key}")

    # Prune: newest KEEP stay, older nightly snapshots go.
    objs = s3.list_objects_v2(Bucket=bucket, Prefix=PREFIX).get("Contents", [])
    objs.sort(key=lambda o: o["LastModified"], reverse=True)
    for old in objs[KEEP:]:
        s3.delete_object(Bucket=bucket, Key=old["Key"])
        print(f"pruned {old['Key']}")
    print(f"retention: {min(len(objs), KEEP)} nightly snapshot(s) kept (max {KEEP})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
