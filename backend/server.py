import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from db import client  # noqa: E402
import routes_auth  # noqa: E402
import routes_players  # noqa: E402
import routes_events  # noqa: E402
import routes_evaluations  # noqa: E402
import routes_development  # noqa: E402
import routes_media  # noqa: E402
import routes_reports  # noqa: E402

app = FastAPI(title="PBG Scout API", docs_url=None, redoc_url=None)

api_router = APIRouter(prefix="/api")


@api_router.get("/")
async def root():
    return {"app": "PBG Scout", "tagline": "Identify. Evaluate. Develop. Connect.", "status": "ok"}


api_router.include_router(routes_auth.router)
api_router.include_router(routes_players.router)
api_router.include_router(routes_events.router)
api_router.include_router(routes_evaluations.router)
api_router.include_router(routes_development.router)
api_router.include_router(routes_media.router)
api_router.include_router(routes_reports.router)

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
