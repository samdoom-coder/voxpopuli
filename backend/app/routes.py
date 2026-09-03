"""HTTP API routes."""
import logging

from fastapi import APIRouter, File, Form, UploadFile, WebSocket
from fastapi.responses import JSONResponse

from . import db
from .agents import generate_world, layout_agents
from .config import Config
from .knowledge import extract_topics, summarize
from .report import generate_report
from .simulation import ENGINES, start_engine, stop_engine
from .ws import connect

log = logging.getLogger("voxpopuli.api")
router = APIRouter(prefix="/api")
ws_router = APIRouter()

TEXT_EXTS = {".txt", ".md", ".markdown", ".csv", ".json", ".html", ".log", ".text"}


# ------------------------------------------------------------------- health

@router.get("/health")
async def health():
    return {
        "ok": True,
        "llm_mode": "llm" if Config.llm_enabled() else "heuristic",
        "model": Config.LLM_MODEL_NAME if Config.llm_enabled() else "built-in heuristic",
    }


# ---------------------------------------------------------------- projects

@router.post("/projects")
async def create_project(
    name: str = Form(...),
    requirement: str = Form("What happens next?"),
    seed_text: str = Form(""),
    files: list[UploadFile] = File(default=[]),
):
    text = seed_text
    saved = []
    for f in files:
        ext = "." + (f.filename or "").rsplit(".", 1)[-1].lower()
        if ext not in TEXT_EXTS:
            continue
        raw = await f.read()
        try:
            decoded = raw.decode("utf-8", errors="ignore")
        except Exception:
            decoded = ""
        text = f"{text}\n\n{decoded}"
        saved.append(f.filename)
    if not text.strip():
        return JSONResponse({"success": False, "error": "No seed material provided"}, status_code=400)
    proj = db.create_project(name.strip(), text, requirement, saved)
    topics = extract_topics(text)
    db.update_project_topics(proj["id"], topics)
    proj = db.get_project(proj["id"])
    return {"success": True, "data": proj}


@router.get("/projects")
async def list_projects():
    return {"success": True, "data": db.list_projects()}


@router.get("/projects/{pid}")
async def get_project(pid: str):
    proj = db.get_project(pid)
    if not proj:
        return JSONResponse({"success": False, "error": "project not found"}, status_code=404)
    return {"success": True, "data": proj}


@router.post("/projects/{pid}/extract")
async def extract(pid: str):
    proj = db.get_project(pid)
    if not proj:
        return JSONResponse({"success": False, "error": "project not found"}, status_code=404)
    topics = extract_topics(proj.get("seed_text") or "")
    db.update_project_topics(pid, topics)
    return {"success": True, "data": topics}


# ------------------------------------------------------------- simulations

@router.post("/simulations")
async def create_simulation(payload: dict):
    pid = payload.get("project_id")
    if not pid:
        return JSONResponse({"success": False, "error": "project_id required"}, status_code=400)
    proj = db.get_project(pid)
    if not proj:
        return JSONResponse({"success": False, "error": "project not found"}, status_code=404)
    try:
        num = int(payload.get("num_agents") or Config.DEFAULT_NUM_AGENTS)
        rounds = int(payload.get("rounds") or Config.DEFAULT_ROUNDS)
    except (TypeError, ValueError):
        return JSONResponse({"success": False, "error": "invalid numbers"}, status_code=400)
    num = max(2, min(num, Config.MAX_AGENTS))
    rounds = max(1, min(rounds, Config.MAX_ROUNDS))
    config = {
        "num_agents": num,
        "rounds": rounds,
        "speed_ms": max(0, int(payload.get("speed_ms") or 0)),
        "mode": payload.get("mode") or "auto",
    }
    sim = db.create_simulation(pid, payload.get("name") or proj["name"], config)
    return {"success": True, "data": sim}


@router.get("/simulations")
async def list_simulations():
    sims = db.list_simulations()
    out = []
    for s in sims:
        s["project_name"] = (db.get_project(s["project_id"]) or {}).get("name", "")
        out.append(s)
    return {"success": True, "data": out}


@router.get("/simulations/{sid}")
async def get_simulation(sid: str):
    sim = db.get_simulation(sid)
    if not sim:
        return JSONResponse({"success": False, "error": "simulation not found"}, status_code=404)
    sim["project_name"] = (db.get_project(sim["project_id"]) or {}).get("name", "")
    sim["agent_count"] = db.agent_stats(sid)["count"]
    return {"success": True, "data": sim}


@router.post("/simulations/{sid}/build")
async def build_world(sid: str):
    sim = db.get_simulation(sid)
    if not sim:
        return JSONResponse({"success": False, "error": "simulation not found"}, status_code=404)
    if sid in ENGINES:
        return JSONResponse({"success": False, "error": "simulation is running"}, status_code=400)
    proj = db.get_project(sim["project_id"])
    config = sim["config"]
    num = config["num_agents"]
    db.delete_agents(sid)
    agents, mode = await generate_world(sid, proj.get("seed_text") or "", proj.get("topics") or [],
                                        proj.get("requirement") or "", num)
    agents = layout_agents(agents, seed=abs(hash(sid)) % (1 << 31))
    for a in agents:
        a["id"] = db.new_id("agt")
    db.insert_agents(sid, agents)
    db.update_simulation(sid, status="ready", world={"mode": mode, "agent_count": len(agents)})
    return {"success": True, "data": {"agent_count": len(agents), "mode": mode, "agents": agents}}


@router.post("/simulations/{sid}/run")
async def run_simulation(sid: str):
    sim = db.get_simulation(sid)
    if not sim:
        return JSONResponse({"success": False, "error": "simulation not found"}, status_code=404)
    if sid in ENGINES:
        return JSONResponse({"success": False, "error": "simulation is already running"}, status_code=400)
    if db.agent_stats(sid)["count"] == 0:
        return JSONResponse({"success": False, "error": "build the world first"}, status_code=400)
    start_engine(sid)
    return {"success": True, "data": {"status": "running"}}


@router.post("/simulations/{sid}/stop")
async def stop_simulation(sid: str):
    stopped = stop_engine(sid)
    if not stopped:
        sim = db.get_simulation(sid)
        if sim and sim["status"] == "running":
            db.update_simulation(sid, status="stopped")
        return {"success": True, "data": {"status": "stopped"}}
    return {"success": True, "data": {"status": "stopping"}}


@router.post("/simulations/{sid}/events")
async def inject_event(sid: str, payload: dict):
    sim = db.get_simulation(sid)
    if not sim:
        return JSONResponse({"success": False, "error": "simulation not found"}, status_code=404)
    content = str(payload.get("content") or "").strip()
    if not content:
        return JSONResponse({"success": False, "error": "event content required"}, status_code=400)
    impact = min(max(float(payload.get("impact") or 0.5), 0.05), 1.0)
    engine = ENGINES.get(sid)
    round_ = (engine.current_round if engine else sim["current_round"]) + 1
    db.insert_event(sid, round_, content, impact)
    if engine:
        engine.inject_event(content, impact)
    return {"success": True, "data": {"round": round_, "impact": impact}}


@router.get("/simulations/{sid}/agents")
async def get_agents(sid: str):
    return {"success": True, "data": db.get_agents(sid)}


@router.get("/simulations/{sid}/messages")
async def get_messages(sid: str, limit: int = 60):
    msgs = db.recent_messages(sid, limit=limit)
    name_map = {a["id"]: a["name"] for a in db.get_agents(sid)}
    for m in msgs:
        m["agent_name"] = name_map.get(m["agent_id"], "?")
    return {"success": True, "data": msgs}


@router.get("/simulations/{sid}/agents/{aid}/messages")
async def get_agent_messages(sid: str, aid: str, limit: int = 12):
    limit = max(1, min(limit, 200))
    msgs = db.agent_messages(sid, aid, limit=limit)
    name_map = {a["id"]: a["name"] for a in db.get_agents(sid)}
    for m in msgs:
        m["agent_name"] = name_map.get(m["agent_id"], "?")
    return {"success": True, "data": msgs}


@router.get("/simulations/{sid}/snapshots")
async def get_snapshots(sid: str):
    return {"success": True, "data": db.get_snapshots(sid)}


@router.get("/simulations/{sid}/events")
async def get_events(sid: str):
    return {"success": True, "data": db.get_events(sid)}


@router.get("/simulations/{sid}/report")
async def get_report(sid: str):
    rep = db.get_report(sid)
    if not rep:
        return JSONResponse({"success": False, "error": "report not ready"}, status_code=404)
    return {"success": True, "data": rep}


@router.post("/simulations/{sid}/report")
async def regen_report(sid: str):
    sim = db.get_simulation(sid)
    if not sim:
        return JSONResponse({"success": False, "error": "simulation not found"}, status_code=404)
    proj = db.get_project(sim["project_id"])
    content = await generate_report(sid, proj)
    return {"success": True, "data": {"content": content}}


@router.get("/simulations/{sid}/analysis")
async def analysis(sid: str):
    agents = db.get_agents(sid)
    snaps = db.get_snapshots(sid)
    camps = {"support": [], "neutral": [], "oppose": []}
    for a in agents:
        key = "support" if a["stance"] > 0.25 else ("oppose" if a["stance"] < -0.25 else "neutral")
        camps[key].append({"id": a["id"], "name": a["name"], "stance": a["stance"],
                           "influence": a["influence"], "mood": a["mood"]})
    for key in camps:
        camps[key].sort(key=lambda x: -x["influence"])
    return {"success": True, "data": {
        "camps": {k: {"count": len(v), "members": v[:12]} for k, v in camps.items()},
        "sentiment_series": [{"round": s["round"], "sentiment": s["sentiment"], "stance_std": s["stance_std"],
                              "messages": s["message_count"]} for s in snaps],
    }}


# ---------------------------------------------------------------- websocket

@ws_router.websocket("/ws/{sid}")
async def ws_endpoint(sid: str, ws: WebSocket):
    await connect(sid, ws)
