"""VoxPopuli FastAPI application."""
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import db
from .config import Config
from .routes import router, ws_router

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

Config.ensure_dirs()
db.init_db()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.getLogger("voxpopuli").info(
        "VoxPopuli started in %s mode",
        "LLM" if Config.llm_enabled() else "heuristic (no LLM key)",
    )
    yield
    # clean up shared LLM HTTP client on shutdown (avoids unclosed-client warnings)
    try:
        from .llm import LLMFactory

        client = LLMFactory._client
        if client is not None:
            await client.close()
    except Exception:
        pass


app = FastAPI(title="VoxPopuli", version="1.0.0", lifespan=lifespan)

# Tightened CORS: same-origin by default. Set CORS_ORIGINS="https://app.example.com,https://x"
# to allow extra origins (comma-separated). "*" still allowed explicitly for local dev.
_cors_env = os.environ.get("CORS_ORIGINS", "").strip()
_allow_origins = (
    [o.strip() for o in _cors_env.split(",") if o.strip()]
    if _cors_env
    else ["http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:8787"]
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    allow_credentials=False,
)

app.include_router(router)
app.include_router(ws_router)

DIST = os.path.join(Config.ROOT, "frontend", "dist")
if os.path.isdir(DIST):
    app.mount("/", StaticFiles(directory=DIST, html=True), name="static")
