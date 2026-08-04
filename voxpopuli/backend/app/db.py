"""SQLite persistence layer. Self-contained, no external services."""
import json
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

from .config import Config

_local = threading.local()
_lock = threading.RLock()


def _conn():
    conn = getattr(_local, "conn", None)
    if conn is None:
        Config.ensure_dirs()
        conn = sqlite3.connect(Config.DB_PATH, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        _local.conn = conn
    return conn


@contextmanager
def cursor():
    with _lock:
        c = _conn().cursor()
        try:
            yield c
            _conn().commit()
        finally:
            c.close()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def init_db():
    with cursor() as c:
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                seed_text TEXT,
                requirement TEXT,
                source_files TEXT DEFAULT '[]',
                topics TEXT DEFAULT '[]',
                created_at TEXT NOT NULL
            )
            """
        )
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS simulations (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                name TEXT NOT NULL,
                config TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'created',
                world TEXT DEFAULT '{}',
                current_round INTEGER DEFAULT 0,
                total_rounds INTEGER DEFAULT 0,
                error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS agents (
                id TEXT PRIMARY KEY,
                simulation_id TEXT NOT NULL,
                name TEXT NOT NULL,
                avatar TEXT DEFAULT '',
                persona TEXT NOT NULL,
                stance REAL DEFAULT 0,
                initial_stance REAL DEFAULT 0,
                mood REAL DEFAULT 0,
                activity REAL DEFAULT 0.5,
                influence REAL DEFAULT 0.5,
                x REAL DEFAULT 0,
                y REAL DEFAULT 0
            )
            """
        )
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                simulation_id TEXT NOT NULL,
                agent_id TEXT NOT NULL,
                round INTEGER NOT NULL,
                kind TEXT NOT NULL,
                platform TEXT NOT NULL,
                content TEXT NOT NULL,
                stance REAL DEFAULT 0,
                sentiment REAL DEFAULT 0,
                likes INTEGER DEFAULT 0,
                replies INTEGER DEFAULT 0,
                reply_to TEXT DEFAULT '',
                created_at TEXT NOT NULL
            )
            """
        )
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS events (
                id TEXT PRIMARY KEY,
                simulation_id TEXT NOT NULL,
                round INTEGER NOT NULL,
                content TEXT NOT NULL,
                impact REAL DEFAULT 0.5
            )
            """
        )
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS snapshots (
                id TEXT PRIMARY KEY,
                simulation_id TEXT NOT NULL,
                round INTEGER NOT NULL,
                sentiment REAL DEFAULT 0,
                stance_std REAL DEFAULT 0,
                message_count INTEGER DEFAULT 0,
                data TEXT DEFAULT '{}'
            )
            """
        )
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS reports (
                id TEXT PRIMARY KEY,
                simulation_id TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        c.execute(
            "CREATE INDEX IF NOT EXISTS idx_msg_sim ON messages(simulation_id, round)"
        )
        c.execute(
            "CREATE INDEX IF NOT EXISTS idx_agent_sim ON agents(simulation_id)"
        )


# ---------------------------------------------------------------- projects

def create_project(name: str, seed_text: str, requirement: str, source_files=None) -> dict:
    pid = new_id("proj")
    topics = json.dumps([], ensure_ascii=False)
    with cursor() as c:
        c.execute(
            "INSERT INTO projects (id, name, seed_text, requirement, source_files, topics, created_at) VALUES (?,?,?,?,?,?,?)",
            (pid, name, seed_text, requirement, json.dumps(source_files or []), topics, now_iso()),
        )
    return get_project(pid)


def get_project(pid: str) -> dict | None:
    with cursor() as c:
        row = c.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
    if not row:
        return None
    d = dict(row)
    d["source_files"] = json.loads(d.get("source_files") or "[]")
    d["topics"] = json.loads(d.get("topics") or "[]")
    return d


def list_projects() -> list[dict]:
    with cursor() as c:
        rows = c.execute("SELECT * FROM projects ORDER BY created_at DESC").fetchall()
    return [dict(r) for r in rows]


def update_project_topics(pid: str, topics: list[dict]):
    with cursor() as c:
        c.execute("UPDATE projects SET topics=? WHERE id=?", (json.dumps(topics, ensure_ascii=False), pid))


# ------------------------------------------------------------- simulations

def create_simulation(project_id: str, name: str, config: dict) -> dict:
    sid = new_id("sim")
    ts = now_iso()
    with cursor() as c:
        c.execute(
            "INSERT INTO simulations (id, project_id, name, config, status, current_round, total_rounds, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (sid, project_id, name, json.dumps(config), "created", 0, int(config.get("rounds", 0)), ts, ts),
        )
    return get_simulation(sid)


def get_simulation(sid: str) -> dict | None:
    with cursor() as c:
        row = c.execute("SELECT * FROM simulations WHERE id=?", (sid,)).fetchone()
    if not row:
        return None
    d = dict(row)
    d["config"] = json.loads(d.get("config") or "{}")
    d["world"] = json.loads(d.get("world") or "{}")
    return d


def list_simulations() -> list[dict]:
    with cursor() as c:
        rows = c.execute("SELECT * FROM simulations ORDER BY created_at DESC").fetchall()
    return [dict(r) for r in rows]


def update_simulation(sid: str, **fields):
    if not fields:
        return
    encoded = {k: (json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v)
               for k, v in fields.items()}
    sets = ", ".join(f"{k}=?" for k in encoded)
    vals = list(encoded.values())
    with cursor() as c:
        c.execute(f"UPDATE simulations SET {sets}, updated_at=? WHERE id=?", (*vals, now_iso(), sid))


# ----------------------------------------------------------------- agents

def insert_agents(simulation_id: str, agents: list[dict]):
    with cursor() as c:
        for a in agents:
            c.execute(
                "INSERT INTO agents (id, simulation_id, name, avatar, persona, stance, initial_stance, mood, activity, influence, x, y) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    a["id"], simulation_id, a["name"], a.get("avatar", ""),
                    json.dumps(a.get("persona", {}), ensure_ascii=False),
                    a.get("stance", 0.0), a.get("initial_stance", 0.0), a.get("mood", 0.0),
                    a.get("activity", 0.5), a.get("influence", 0.5),
                    a.get("x", 0.0), a.get("y", 0.0),
                ),
            )


def get_agents(simulation_id: str) -> list[dict]:
    with cursor() as c:
        rows = c.execute("SELECT * FROM agents WHERE simulation_id=? ORDER BY name", (simulation_id,)).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["persona"] = json.loads(d["persona"])
        out.append(d)
    return out


def delete_agents(simulation_id: str):
    with cursor() as c:
        c.execute("DELETE FROM agents WHERE simulation_id=?", (simulation_id,))
        c.execute("DELETE FROM messages WHERE simulation_id=?", (simulation_id,))
        c.execute("DELETE FROM snapshots WHERE simulation_id=?", (simulation_id,))
        c.execute("DELETE FROM events WHERE simulation_id=?", (simulation_id,))
        c.execute("DELETE FROM reports WHERE simulation_id=?", (simulation_id,))


def update_agent(simulation_id: str, agent_id: str, **fields):
    sets = ", ".join(f"{k}=?" for k in fields)
    vals = list(fields.values())
    with cursor() as c:
        c.execute(f"UPDATE agents SET {sets} WHERE simulation_id=? AND id=?", (*vals, simulation_id, agent_id))


def agent_stats(simulation_id: str) -> dict:
    with cursor() as c:
        row = c.execute(
            "SELECT COUNT(*) AS n, AVG(stance) AS avg_stance, AVG(mood) AS avg_mood FROM agents WHERE simulation_id=?",
            (simulation_id,),
        ).fetchone()
    d = dict(row) if row else {"n": 0, "avg_stance": 0, "avg_mood": 0}
    return {"count": d["n"] or 0, "avg_stance": d["avg_stance"] or 0.0, "avg_mood": d["avg_mood"] or 0.0}


# --------------------------------------------------------------- messages

def insert_message(simulation_id: str, agent_id: str, round_: int, kind: str, platform: str,
                   content: str, stance: float, sentiment: float, likes: int = 0, replies: int = 0,
                   reply_to: str = "") -> str:
    mid = new_id("msg")
    with cursor() as c:
        c.execute(
            "INSERT INTO messages (id, simulation_id, agent_id, round, kind, platform, content, stance, sentiment, likes, replies, reply_to, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (mid, simulation_id, agent_id, round_, kind, platform, content, stance, sentiment, likes, replies, reply_to, now_iso()),
        )
    return mid


def recent_messages(simulation_id: str, limit: int = 30) -> list[dict]:
    with cursor() as c:
        rows = c.execute(
            "SELECT * FROM messages WHERE simulation_id=? ORDER BY round DESC, created_at DESC LIMIT ?",
            (simulation_id, limit),
        ).fetchall()
    return [dict(r) for r in rows]


def top_messages(simulation_id: str, round_: int | None, limit: int = 12) -> list[dict]:
    with cursor() as c:
        if round_ is not None:
            rows = c.execute(
                "SELECT * FROM messages WHERE simulation_id=? AND round<=? ORDER BY likes DESC LIMIT ?",
                (simulation_id, round_, limit),
            )
        else:
            rows = c.execute(
                "SELECT * FROM messages WHERE simulation_id=? ORDER BY likes DESC LIMIT ?",
                (simulation_id, limit),
            )
        return [dict(r) for r in rows.fetchall()]


def agent_messages(simulation_id: str, agent_id: str, limit: int = 200) -> list[dict]:
    with cursor() as c:
        rows = c.execute(
            "SELECT * FROM messages WHERE simulation_id=? AND agent_id=? ORDER BY round DESC, created_at DESC LIMIT ?",
            (simulation_id, agent_id, limit),
        ).fetchall()
    return [dict(r) for r in rows]


def message_counts(simulation_id: str) -> dict:
    with cursor() as c:
        row = c.execute(
            "SELECT COUNT(*) AS n, AVG(sentiment) AS avg_sentiment, SUM(CASE WHEN kind='post' THEN 1 ELSE 0 END) AS posts, SUM(CASE WHEN kind='reaction' THEN 1 ELSE 0 END) AS reactions FROM messages WHERE simulation_id=?",
            (simulation_id,),
        ).fetchone()
    d = dict(row) if row else {}
    return {
        "count": d.get("n") or 0,
        "avg_sentiment": d.get("avg_sentiment") or 0.0,
        "posts": d.get("posts") or 0,
        "reactions": d.get("reactions") or 0,
    }


# ----------------------------------------------------------------- events

def insert_event(simulation_id: str, round_: int, content: str, impact: float = 0.5) -> str:
    eid = new_id("evt")
    with cursor() as c:
        c.execute(
            "INSERT INTO events (id, simulation_id, round, content, impact) VALUES (?,?,?,?,?)",
            (eid, simulation_id, round_, content, impact),
        )
    return eid


def get_events(simulation_id: str) -> list[dict]:
    with cursor() as c:
        rows = c.execute("SELECT * FROM events WHERE simulation_id=? ORDER BY round", (simulation_id,)).fetchall()
    return [dict(r) for r in rows]


# -------------------------------------------------------------- snapshots

def insert_snapshot(simulation_id: str, round_: int, sentiment: float, stance_std: float, message_count: int, data: dict):
    with cursor() as c:
        c.execute(
            "INSERT INTO snapshots (id, simulation_id, round, sentiment, stance_std, message_count, data) VALUES (?,?,?,?,?,?,?)",
            (new_id("snap"), simulation_id, round_, sentiment, stance_std, message_count, json.dumps(data, ensure_ascii=False)),
        )


def get_snapshots(simulation_id: str) -> list[dict]:
    with cursor() as c:
        rows = c.execute("SELECT * FROM snapshots WHERE simulation_id=? ORDER BY round", (simulation_id,)).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["data"] = json.loads(d["data"])
        out.append(d)
    return out


# ----------------------------------------------------------------- report

def save_report(simulation_id: str, content: str) -> str:
    rid = new_id("rep")
    with cursor() as c:
        c.execute(
            "INSERT INTO reports (id, simulation_id, content, created_at) VALUES (?,?,?,?)",
            (rid, simulation_id, content, now_iso()),
        )
    return rid


def get_report(simulation_id: str) -> dict | None:
    with cursor() as c:
        row = c.execute(
            "SELECT * FROM reports WHERE simulation_id=? ORDER BY created_at DESC LIMIT 1",
            (simulation_id,),
        ).fetchone()
    return dict(row) if row else None
