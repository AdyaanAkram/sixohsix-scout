import logging
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from config import settings  # noqa: E402
from db import client  # noqa: E402
from indexes import ensure_indexes  # noqa: E402
import routes_auth  # noqa: E402
import routes_players  # noqa: E402
import routes_events  # noqa: E402
import routes_evaluations  # noqa: E402
import routes_development  # noqa: E402
import routes_media  # noqa: E402
import routes_reports  # noqa: E402
import routes_athlete  # noqa: E402
import routes_programs  # noqa: E402
import routes_notifications  # noqa: E402
import routes_metrics  # noqa: E402
import routes_awards  # noqa: E402
import routes_drills  # noqa: E402

logging.basicConfig(
    level=getattr(logging, settings.log_level, logging.INFO),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("app")


def _init_sentry():
    if not settings.sentry_dsn:
        return
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration

        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            environment=settings.app_env,
            integrations=[FastApiIntegration()],
            traces_sample_rate=0.1 if settings.app_env == "production" else 0.0,
        )
        logger.info("Sentry initialized")
    except Exception as e:
        logger.warning("Sentry init skipped: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    _init_sentry()
    # Ping Mongo — log loudly but don't crash the process (Render exit code 3 on lifespan failure).
    try:
        await client.admin.command("ping")
        await ensure_indexes()
        logger.info("API ready env=%s db=%s", settings.app_env, settings.db_name)
    except Exception as e:
        logger.error(
            "Mongo unavailable at startup (%s). Check MONGO_URL and Atlas Network Access (0.0.0.0/0). "
            "/ready will stay 503 until DB is reachable.",
            e,
        )
    yield
    client.close()
    logger.info("API shutdown complete")


app = FastAPI(
    title="60'6\" Athletics Scout API",
    version="1.1.0",
    docs_url="/docs" if settings.app_env != "production" else None,
    redoc_url="/redoc" if settings.app_env != "production" else None,
    lifespan=lifespan,
)

api_router = APIRouter(prefix="/api")


@app.get("/health")
async def health():
    """Liveness — process is up."""
    return {"status": "ok", "env": settings.app_env}


@app.get("/ready")
async def ready():
    """Readiness — Mongo reachable."""
    try:
        await client.admin.command("ping")
        return {"status": "ready", "db": settings.db_name}
    except Exception as e:
        return JSONResponse(status_code=503, content={"status": "not_ready", "detail": str(e)})


@app.get("/debug/mongo")
async def debug_mongo():
    """Safe Mongo config probe (DEMO_HOSTING only) — no secrets."""
    if not settings.demo_hosting:
        return JSONResponse(status_code=404, content={"detail": "Not found"})
    from urllib.parse import urlparse

    raw = (settings.mongo_url or "").strip()
    host = None
    scheme = None
    if raw:
        try:
            # mongodb+srv://user:pass@host/...
            parsed = urlparse(raw.replace("mongodb+srv://", "https://").replace("mongodb://", "https://"))
            host = parsed.hostname
            scheme = "mongodb+srv" if raw.startswith("mongodb+srv://") else "mongodb"
        except Exception:
            host = "(unparseable)"
    err = None
    ok = False
    try:
        await client.admin.command("ping")
        ok = True
    except Exception as e:
        err = str(e)[:400]
    hint = None
    if err and "TLSV1_ALERT_INTERNAL_ERROR" in err:
        hint = (
            "Atlas is rejecting TLS from this host — almost always Network Access. "
            "In Atlas → Network Access → Allow Access from Anywhere (0.0.0.0/0), wait ~1 min, retry."
        )
    return {
        "mongo_configured": bool(raw),
        "scheme": scheme,
        "host": host,
        "db_name": settings.db_name,
        "ping_ok": ok,
        "error": err,
        "hint": hint,
    }


@api_router.get("/")
async def root():
    return {
        "app": "60'6\" Athletics Scout",
        "tagline": "Identify. Evaluate. Develop. Train.",
        "status": "ok",
        "version": "1.1.0",
    }


api_router.include_router(routes_auth.router)
api_router.include_router(routes_players.router)
api_router.include_router(routes_events.router)
api_router.include_router(routes_evaluations.router)
api_router.include_router(routes_development.router)
api_router.include_router(routes_media.router)
api_router.include_router(routes_reports.router)
api_router.include_router(routes_athlete.router)
api_router.include_router(routes_programs.router)
api_router.include_router(routes_notifications.router)
api_router.include_router(routes_metrics.router)
api_router.include_router(routes_awards.router)
api_router.include_router(routes_drills.router)

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=settings.cors_origins,
    # Demo / preview hosts (Surge + Cloudflare quick tunnels)
    allow_origin_regex=r"https://.*\.(surge\.sh|trycloudflare\.com)",
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    expose_headers=["X-Request-ID"],
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    rid = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    request.state.request_id = rid
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("unhandled path=%s rid=%s", request.url.path, rid)
        raise
    response.headers["X-Request-ID"] = rid
    # Don't log health spam
    if request.url.path not in ("/health", "/ready"):
        ms = (time.perf_counter() - started) * 1000
        logger.info("%s %s → %s %.0fms rid=%s", request.method, request.url.path, response.status_code, ms, rid)
    return response


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors(), "request_id": getattr(request.state, "request_id", None)},
    )


@app.exception_handler(Exception)
async def unhandled_handler(request: Request, exc: Exception):
    from fastapi import HTTPException

    if isinstance(exc, HTTPException):
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    logger.exception("unhandled error rid=%s", getattr(request.state, "request_id", None))
    detail = str(exc) if settings.app_env != "production" else "Internal server error"
    return JSONResponse(
        status_code=500,
        content={"detail": detail, "request_id": getattr(request.state, "request_id", None)},
    )
