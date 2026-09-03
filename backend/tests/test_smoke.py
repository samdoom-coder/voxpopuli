"""Smoke tests for the VoxPopuli API (heuristic mode, no LLM key needed)."""
import os
import tempfile
import time

os.environ.pop("LLM_API_KEY", None)

from app.config import Config

_tmp = tempfile.mkdtemp(prefix="voxpopuli_test_")
Config.DB_PATH = os.path.join(_tmp, "test.db")

import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import app

SEED = (
    "The government announced a new AI regulation bill today. The bill proposes strict licensing "
    "for AI companies, mandatory safety audits, and fines for violations. Industry leaders are "
    "divided. Consumer advocates say it does not go far enough. Tech lobbyists warn it will kill "
    "innovation and push startups offshore."
)


@pytest.fixture(scope="session", autouse=True)
def clean_db():
    Config.ensure_dirs()
    db.init_db()
    yield


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


def make_project(client):
    r = client.post("/api/projects", data={
        "name": "Test scenario",
        "requirement": "Will the AI regulation pass? How will opinion shift?",
        "seed_text": SEED,
    })
    assert r.status_code == 200, r.text
    return r.json()["data"]


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert r.json()["llm_mode"] == "heuristic"


def test_project_creation_extracts_topics(client):
    proj = make_project(client)
    assert len(proj["topics"]) >= 3
    assert proj["seed_text"]


def test_full_simulation_flow(client):
    proj = make_project(client)
    r = client.post("/api/simulations", json={
        "project_id": proj["id"], "num_agents": 8, "rounds": 3, "speed_ms": 0, "mode": "auto",
    })
    assert r.status_code == 200, r.text
    sid = r.json()["data"]["id"]

    r = client.post(f"/api/simulations/{sid}/build")
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["agent_count"] == 8
    assert data["mode"] == "heuristic"

    r = client.get(f"/api/simulations/{sid}/agents")
    assert len(r.json()["data"]) == 8
    agent = r.json()["data"][0]
    assert -1 <= agent["stance"] <= 1

    r = client.post(f"/api/simulations/{sid}/run")
    assert r.status_code == 200, r.text

    # inject an event shortly after start
    time.sleep(0.6)
    r = client.post(f"/api/simulations/{sid}/events", json={
        "content": "A leaked memo says the bill will be shelved for two years.", "impact": 0.8,
    })
    assert r.status_code == 200, r.text
    assert r.json()["data"]["impact"] == 0.8

    for _ in range(60):
        s = client.get(f"/api/simulations/{sid}").json()["data"]["status"]
        if s in ("completed", "stopped", "failed"):
            break
        time.sleep(0.25)
    assert s == "completed", f"simulation did not complete: {s}"

    r = client.get(f"/api/simulations/{sid}/messages")
    msgs = r.json()["data"]
    assert len(msgs) > 0

    # per-agent messages route serves only that citizen's posts
    aid = msgs[0]["agent_id"]
    r = client.get(f"/api/simulations/{sid}/agents/{aid}/messages?limit=5")
    assert r.status_code == 200, r.text
    amsgs = r.json()["data"]
    assert len(amsgs) > 0
    assert all(m["agent_id"] == aid for m in amsgs)

    r = client.get(f"/api/simulations/{sid}/snapshots")
    snaps = r.json()["data"]
    assert len(snaps) == 3
    assert all(-1 <= s["sentiment"] <= 1 for s in snaps)
    # camp history is recorded on every snapshot
    assert all(sum(s["data"]["camps"].values()) == 8 for s in snaps)

    r = client.get(f"/api/simulations/{sid}/events")
    assert len(r.json()["data"]) >= 1

    r = client.get(f"/api/simulations/{sid}/report")
    assert r.status_code == 200
    assert "Executive summary" in r.json()["data"]["content"]

    r = client.get(f"/api/simulations/{sid}/analysis")
    camps = r.json()["data"]["camps"]
    assert sum(c["count"] for c in camps.values()) == 8


def test_run_without_build_fails(client):
    proj = make_project(client)
    r = client.post("/api/simulations", json={"project_id": proj["id"], "num_agents": 5, "rounds": 2})
    sid = r.json()["data"]["id"]
    r = client.post(f"/api/simulations/{sid}/run")
    assert r.status_code == 400
