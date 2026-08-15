"""Central configuration with fail-fast validation for production."""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")


@dataclass(frozen=True)
class Settings:
    mongo_url: str
    db_name: str
    jwt_secret: str
    cors_origins: list[str]
    app_env: str  # development | staging | production
    app_public_url: str
    sentry_dsn: str | None
    mail_provider: str
    mail_from: str
    resend_api_key: str | None
    log_level: str
    storage_backend: str  # local | s3
    s3_bucket: str | None
    s3_region: str | None
    s3_endpoint_url: str | None
    s3_access_key: str | None
    s3_secret_key: str | None
    demo_hosting: bool = False
    openai_api_key: str | None = None
    openai_model: str = "gpt-4o-mini"


def _split_origins(raw: str) -> list[str]:
    parts = [p.strip() for p in (raw or "").split(",") if p.strip()]
    return parts or ["http://localhost:3000"]


def load_settings() -> Settings:
    app_env = (os.environ.get("APP_ENV") or "development").lower().strip()
    mongo_url = os.environ.get("MONGO_URL", "").strip()
    db_name = os.environ.get("DB_NAME", "").strip()
    jwt_secret = os.environ.get("JWT_SECRET", "").strip()
    cors_raw = os.environ.get("CORS_ORIGINS", "http://localhost:3000")
    app_public_url = (os.environ.get("APP_PUBLIC_URL") or "http://localhost:3000").rstrip("/")
    sentry_dsn = (os.environ.get("SENTRY_DSN") or "").strip() or None
    mail_provider = (os.environ.get("MAIL_PROVIDER") or "stdout").lower().strip()
    mail_from = (os.environ.get("MAIL_FROM") or "noreply@606athletics.local").strip()
    resend_api_key = (os.environ.get("RESEND_API_KEY") or "").strip() or None
    log_level = (os.environ.get("LOG_LEVEL") or "INFO").upper().strip()

    storage_backend = (os.environ.get("STORAGE_BACKEND") or "local").lower().strip()
    s3_bucket = (os.environ.get("S3_BUCKET") or "").strip() or None
    s3_region = (os.environ.get("S3_REGION") or "auto").strip() or "auto"
    s3_endpoint_url = (os.environ.get("S3_ENDPOINT_URL") or "").strip() or None
    s3_access_key = (os.environ.get("S3_ACCESS_KEY") or os.environ.get("AWS_ACCESS_KEY_ID") or "").strip() or None
    s3_secret_key = (os.environ.get("S3_SECRET_KEY") or os.environ.get("AWS_SECRET_ACCESS_KEY") or "").strip() or None

    errors: list[str] = []
    if not mongo_url:
        errors.append("MONGO_URL is required")
    if not db_name:
        errors.append("DB_NAME is required")
    demo_hosting = os.environ.get("DEMO_HOSTING", "").strip() in ("1", "true", "yes")
    if not jwt_secret:
        if demo_hosting:
            jwt_secret = "demo-hosting-only-jwt-secret-change-me-32b"
            print("[config] WARNING: JWT_SECRET missing — using demo default (DEMO_HOSTING=1)", file=sys.stderr)
        else:
            errors.append("JWT_SECRET is required")
    elif app_env == "production":
        weak = {
            "pbg-scout-dev-secret-change-in-prod",
            "local-dev-only-rotate-before-any-real-data",
            "changeme",
            "secret",
            "ci-test-secret-not-for-production-use",
            "demo-hosting-only-jwt-secret-change-me-32b",
        }
        if jwt_secret in weak and not demo_hosting:
            errors.append("JWT_SECRET must be a strong unique secret in production")
        if len(jwt_secret) < 32 and not demo_hosting:
            errors.append("JWT_SECRET must be at least 32 characters in production")
        if "*" in cors_raw.split(",") or cors_raw.strip() == "*":
            errors.append("CORS_ORIGINS must not be '*' in production")
        if mail_provider != "resend":
            if demo_hosting and mail_provider == "stdout":
                print(
                    "[config] WARNING: DEMO_HOSTING=1 — MAIL_PROVIDER=stdout "
                    "(invite emails will not send; use bootstrap_admin / known passwords)",
                    file=sys.stderr,
                )
            else:
                errors.append("MAIL_PROVIDER must be 'resend' in production (or DEMO_HOSTING=1 with stdout)")
        if not resend_api_key and not (demo_hosting and mail_provider == "stdout"):
            errors.append("RESEND_API_KEY is required in production")
        if ("localhost" in mail_from or mail_from.endswith(".local")) and not demo_hosting:
            errors.append("MAIL_FROM must be a real domain address in production")
        if storage_backend not in ("local", "s3"):
            errors.append("STORAGE_BACKEND must be 'local' or 's3'")
        if storage_backend == "s3":
            if not s3_bucket:
                errors.append("S3_BUCKET is required when STORAGE_BACKEND=s3")
            if not s3_access_key or not s3_secret_key:
                errors.append("S3_ACCESS_KEY and S3_SECRET_KEY are required when STORAGE_BACKEND=s3")
        elif storage_backend == "local":
            # Allowed for single-VPS camp deploys with a persistent volume
            print("[config] WARNING: STORAGE_BACKEND=local in production — use a persistent volume or switch to S3/R2", file=sys.stderr)
        looks_local_mongo = (
            "mongodb://mongo:" in mongo_url
            or ("localhost" in mongo_url and "mongodb+srv" not in mongo_url)
            or ("127.0.0.1" in mongo_url and "mongodb+srv" not in mongo_url)
        )
        if looks_local_mongo and os.environ.get("ALLOW_COMPOSE_MONGO") != "1":
            print("[config] WARNING: MONGO_URL looks local — prefer MongoDB Atlas for real camps", file=sys.stderr)

    if storage_backend == "s3" and app_env != "production":
        if not s3_bucket or not s3_access_key or not s3_secret_key:
            errors.append("S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY required when STORAGE_BACKEND=s3")

    if errors:
        for e in errors:
            print(f"[config] ERROR: {e}", file=sys.stderr)
        raise SystemExit(1)

    return Settings(
        mongo_url=mongo_url,
        db_name=db_name,
        jwt_secret=jwt_secret,
        cors_origins=_split_origins(cors_raw),
        app_env=app_env,
        app_public_url=app_public_url,
        sentry_dsn=sentry_dsn,
        mail_provider=mail_provider,
        mail_from=mail_from,
        resend_api_key=resend_api_key,
        log_level=log_level,
        storage_backend=storage_backend,
        s3_bucket=s3_bucket,
        s3_region=s3_region,
        s3_endpoint_url=s3_endpoint_url,
        s3_access_key=s3_access_key,
        s3_secret_key=s3_secret_key,
        demo_hosting=demo_hosting,
        openai_api_key=(os.environ.get("OPENAI_API_KEY") or "").strip() or None,
        openai_model=(os.environ.get("OPENAI_MODEL") or "gpt-4o-mini").strip(),
    )


settings = load_settings()
