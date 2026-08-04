"""VoxPopuli FastAPI application."""
import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import db
from .config import Config
from .routes import router, ws_router

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

Config.ensure_dirs()
db.init_db()

app = FastAPI(title="VoxPopuli", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
app.include_router(ws_router)

DIST = os.path.join(Config.ROOT, "frontend", "dist")
if os.path.isdir(DIST):
    app.mount("/", StaticFiles(directory=DIST, html=True), name="static")


@app.on_event("startup")
async def startup():
    logging.getLogger("voxpopuli").info(
        "VoxPopuli started in %s mode",
        "LLM" if Config.llm_enabled() else "heuristic (no LLM key)",
    )
