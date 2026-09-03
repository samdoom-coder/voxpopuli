"""The digital-world simulation engine.

Runs an async loop of rounds. Each round a sample of citizens decide what to
do (post / reply / react / do nothing) using batched LLM calls (fast & cheap),
or a built-in heuristic engine when no LLM is configured. Opinion shifts are
tracked per agent and aggregated into a sentiment time-series.
"""
import asyncio
import json
import logging
import math
import random

from . import db
from .agents import layout_agents
from .config import Config
from .llm import LLMFactory, is_llm_error
from .ws import broadcast

log = logging.getLogger("voxpopuli.sim")

ENGINES: dict[str, "SimulationEngine"] = {}
TASKS: dict[str, asyncio.Task] = {}

HEURISTIC_POSTS_POS = [
    "Finally, real movement on {t}. This is the kind of progress people were waiting for.",
    "Honestly, {t} needed this. I have been saying it for months.",
    "Good to see {t} finally getting the attention it deserves. Encouraging week.",
    "Supporting this wholeheartedly. {t} affects all of us, not just a few.",
]
HEURISTIC_POSTS_NEG = [
    "I have a bad feeling about {t}. Nobody asked for this and the timing is awful.",
    "This whole {t} thing worries me. Short-term thinking again, as always.",
    "Count me opposed. {t} will make things worse for ordinary people.",
    "We should push back on {t} before it is too late. This cannot stand.",
]
HEURISTIC_POSTS_NEU = [
    "Still thinking through {t}. Too early to tell how this plays out.",
    "Watching {t} unfold. Both sides have points, honestly.",
    "Not sure what to make of {t} yet. Need more facts before I judge.",
]
HEURISTIC_REACT = [
    "This exactly. Completely agree with {a}.",
    "Hadn't thought of it that way, but yeah.",
    "Disagree here. {a} is missing the bigger picture.",
    "Interesting take, though I'd push back on parts.",
]


def _clamp(v: float, lo: float = -1.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, v))


def _stddev(vals: list[float]) -> float:
    if not vals:
        return 0.0
    m = sum(vals) / len(vals)
    return math.sqrt(sum((v - m) ** 2 for v in vals) / len(vals))


_POS_WORDS = ["approve", "support", "boost", "rise", "rally", "pass", "good", "growth", "win",
              "increase", "fund", "help", "aid", "deal", "peace", "recover", "positive", "success", "praise"]
_NEG_WORDS = ["fail", "drop", "fall", "cut", "hike", "tax", "ban", "delay", "leak", "scandal", "crash",
              "worry", "worse", "kill", "oppose", "reject", "fine", "risk", "concern", "tension", "attack",
              "threat", "crisis", "lose", "negative", "shock", "fear", "panic"]


def _text_sentiment(text: str) -> float:
    if not text:
        return 0.0
    t = text.lower()
    score = sum(1 for w in _POS_WORDS if w in t) - sum(1 for w in _NEG_WORDS if w in t)
    return _clamp(score / max(abs(score), 1))


def _pick(seq, rng, k=1):
    return [seq[i] for i in rng.sample(range(len(seq)), min(k, len(seq)))]


class SimulationEngine:
    def __init__(self, simulation_id: str, project: dict, config: dict):
        self.sid = simulation_id
        self.project = project
        self.config = config
        self.num_agents = int(config.get("num_agents") or Config.DEFAULT_NUM_AGENTS)
        self.total_rounds = int(config.get("rounds") or Config.DEFAULT_ROUNDS)
        self.speed_ms = int(config.get("speed_ms") or 0)
        self._mode = str(config.get("mode") or "auto")

        self._stop = asyncio.Event()
        self.current_round = 0
        self.pending_event: dict | None = None
        self.active_event: dict | None = None

        self.agents: dict[str, dict] = {}   # agent_id -> row
        self._agent_by_name: dict[str, str] = {}
        self._ctx_messages: list[dict] = []

    # ------------------------------------------------------------------ run

    def mode(self) -> str:
        if self._mode in ("llm", "heuristic"):
            return self._mode
        return "llm" if Config.llm_enabled() else "heuristic"

    async def run(self):
        try:
            self._load_agents()
            db.update_simulation(self.sid, status="running", current_round=0)
            start = self.current_round
            for r in range(start + 1, self.total_rounds + 1):
                if self._stop.is_set():
                    break
                await self._do_round(r)
                self.current_round = r
                db.update_simulation(self.sid, current_round=r)
                if self.speed_ms > 0:
                    await asyncio.sleep(self.speed_ms / 1000)
                else:
                    await asyncio.sleep(0)
            if self._stop.is_set():
                db.update_simulation(self.sid, status="stopped")
                await broadcast(self.sid, {"type": "status", "status": "stopped"})
            else:
                db.update_simulation(self.sid, status="completed")
                await broadcast(self.sid, {"type": "status", "status": "completed"})
                from .report import generate_report
                try:
                    await generate_report(self.sid, self.project)
                    await broadcast(self.sid, {"type": "report_ready"})
                except Exception as exc:  # pragma: no cover
                    log.warning("report generation failed: %s", exc)
        except Exception as exc:
            log.exception("simulation crashed")
            db.update_simulation(self.sid, status="failed", error=str(exc))
            await broadcast(self.sid, {"type": "status", "status": "failed", "error": str(exc)})
        finally:
            TASKS.pop(self.sid, None)
            ENGINES.pop(self.sid, None)

    def stop(self):
        self._stop.set()

    def inject_event(self, content: str, impact: float = 0.5):
        self.pending_event = {"content": content, "impact": _clamp(impact, 0.05, 1.0)}

    # ------------------------------------------------------------ internals

    def _load_agents(self):
        rows = db.get_agents(self.sid)
        for a in rows:
            a["stance"] = float(a["stance"])
            a["mood"] = float(a["mood"])
            a["activity"] = float(a["activity"])
            a["influence"] = float(a["influence"])
            a["x"] = float(a.get("x") or 0.0)
            a["y"] = float(a.get("y") or 0.0)
            self.agents[a["id"]] = a
            self._agent_by_name[a["name"]] = a["id"]

    def _context_lines(self, r: int) -> tuple[list[str], dict[str, dict]]:
        top = db.top_messages(self.sid, r, limit=Config.CONTEXT_RECENT_MESSAGES)
        lines = []
        index = {}
        for i, m in enumerate(top, 1):
            name = self.agents.get(m["agent_id"], {}).get("name", "?")
            text = (m["content"] or "")[:140]
            lines.append(f"[{i}] @{name}: \"{text}\"")
            index[str(i)] = m
        self._ctx_messages = top
        return lines, index

    def _active_agents(self, rng: random.Random, force_all: bool) -> list[str]:
        out = []
        for aid, a in self.agents.items():
            threshold = 0.0 if force_all else (1.0 - a["activity"] * 0.8)
            if rng.random() >= threshold:
                out.append(aid)
        # guarantee at least a few actors
        if len(out) < max(3, int(len(self.agents) * 0.1)):
            extra = _pick([a for a in self.agents if a not in out], rng, max(3, int(len(self.agents) * 0.1) - len(out)))
            out.extend(extra)
        return out

    def _persona_line(self, a: dict) -> str:
        p = a["persona"]
        return (f"{a['name']} ({p.get('age')}, {p.get('occupation')}, {p.get('region')}) - "
                f"{p.get('personality')}; writes in {p.get('style')} style; cares about {p.get('interest')}; "
                f"current stance {a['stance']:+.2f}; influence {a['influence']:.2f}")

    def _round_prompt(self, r: int, active: list[dict], force_event: bool) -> str:
        event_block = ""
        if self.active_event:
            event_block = (
                f"BREAKING NEWS (just happened): \"{self.active_event['content']}\"\n"
                f"This event is the main thing everyone is reacting to right now.\n"
            )
        ctx, _ = self._context_lines(r)
        ctx_block = "\n".join(ctx) if ctx else "(the discussion is just starting - no public posts yet)"
        topics = (self.project.get("topics") or [])
        topics_str = ", ".join(t["keyword"] for t in topics[:6]) or "current events"
        citizens = "\n".join(f"{i}. {self._persona_line(a)}" for i, a in enumerate(active, 1))
        return f"""{event_block}ROUND {r}. What each citizen does next on the social network.

TRENDING SUBJECTS: {topics_str}

RECENT PUBLIC POSTS (id order):
{ctx_block}

CITIZENS TO SIMULATE (one JSON object each, by name):
{citizens}

Rules:
- Each citizen: action is one of "post", "reply", "reply_to_msg_id", "reaction" (target_msg_id + like true/false), or "do_nothing".
- Only a minority should post/reply each round; many do "do_nothing" or quietly react.
- content matches their personality and style. Keep posts under 40 words.
- sentiment: -1 angry/sad, 0 neutral, +1 happy/positive.
- stance_after: how their overall position on the issue moved this round (allow small drift; breakaway only when the event strongly pushes them).
- react/reply to message ids from RECENT PUBLIC POSTS only.

Return ONLY a JSON array with exactly {len(active)} objects (one per citizen, same order), fields:
name, action, content (only when posting/replying), reply_to_msg_id, target_msg_id, like, sentiment, stance_after, reason."""

    async def _do_round(self, r: int):
        if self.pending_event and not self.active_event:
            self.active_event = self.pending_event
            self.pending_event = None
        rng = random.Random(abs(hash(self.sid)) + r * 7919)
        force_event = self.active_event is not None
        active_ids = self._active_agents(rng, force_event)
        active = [self.agents[aid] for aid in active_ids]

        round_actions: list[dict] = []
        mode = self.mode()

        if mode == "llm" and active:
            round_actions = await self._llm_actions(r, active)
        else:
            round_actions = self._heuristic_actions(rng, r, active)

        await self._apply_actions(r, round_actions, mode)

        # social pull: passive citizens drift toward the influential voices
        await self._community_pull(rng, active_ids)

        snap = self._snapshot(r)
        await broadcast(self.sid, {
            "type": "round",
            "round": r,
            "total_rounds": self.total_rounds,
            "mode": mode,
            "sentiment": snap["sentiment"],
            "stance_std": snap["stance_std"],
            "message_count": snap["message_count"],
            "camps": snap["camps"],
            "actions": round_actions,
            "agents": [self._agent_public(a) for a in self.agents.values()],
            "event": self.active_event,
        })

        self.active_event = None  # breaking news settles after one round

    async def _llm_actions(self, r: int, active: list[dict]) -> list[dict]:
        client = LLMFactory.get()
        batches = [active[i:i + Config.LLM_BATCH_SIZE] for i in range(0, len(active), Config.LLM_BATCH_SIZE)]
        prompts = [self._round_prompt(r, b, self.active_event is not None) for b in batches]
        tasks = [
            client.chat_json_array([
                {"role": "system", "content": "You are a realistic social simulation engine. Reply with valid JSON only."},
                {"role": "user", "content": p},
            ], temperature=0.8, max_tokens=3600)
            for p in prompts
        ]
        results = await client.gather(*tasks)

        actions: list[dict] = []
        for batch, res in zip(batches, results):
            if is_llm_error(res):
                log.warning("action batch failed: %s", res)
                for a in batch:
                    actions.append({"name": a["name"], "action": "do_nothing"})
                continue
            parsed = res if isinstance(res, list) else []
            by_name = {str(x.get("name", "")).strip().lower(): x for x in parsed if isinstance(x, dict)}
            for i, a in enumerate(batch):
                item = by_name.get(a["name"].lower())
                if item is None and len(parsed) == len(batch):
                    # index-aligned fallback: LLM kept order but mangled a name
                    item = parsed[i] if isinstance(parsed[i], dict) else None
                if item:
                    actions.append(self._normalize_action(a, item))
                else:
                    actions.append({"name": a["name"], "action": "do_nothing"})
        return actions

    def _normalize_action(self, agent: dict, item: dict) -> dict:
        act = str(item.get("action") or "do_nothing").lower()
        allowed = {"post", "reply", "reaction", "do_nothing"}
        if act not in allowed:
            act = "do_nothing"
        return {
            "name": agent["name"],
            "action": act,
            "content": str(item.get("content") or "").strip()[:240],
            "reply_to": str(item.get("reply_to_msg_id") or "").strip(),
            "target": str(item.get("target_msg_id") or "").strip(),
            "like": bool(item.get("like", True)),
            "sentiment": _clamp(float(item.get("sentiment") or 0.0)),
            "stance_after": _clamp(float(item.get("stance_after") or agent["stance"])),
            "reason": str(item.get("reason") or "").strip()[:120],
        }

    def _heuristic_actions(self, rng: random.Random, r: int, active: list[dict]) -> list[dict]:
        topics = self.project.get("topics") or []
        t = topics[rng.randrange(len(topics))]["keyword"] if topics else "the situation"
        actions: list[dict] = []
        for a in active:
            roll = rng.random()
            stance = a["stance"]
            event = self.active_event
            impact = event["impact"] if event else 0.0
            evt_sent = _text_sentiment(event["content"]) if event else 0.0
            actions.append({
                "name": a["name"],
                "action": "do_nothing",
                "content": "",
                "reply_to": "",
                "target": "",
                "like": True,
                "sentiment": 0.0,
                "stance_after": _clamp(stance + rng.uniform(-0.06, 0.06) + (impact * evt_sent * 0.15 if event else 0)),
                "reason": "",
            })
            act = actions[-1]
            if roll < 0.55 or (event and roll < 0.8):
                act["action"] = "post"
                template = _pick(HEURISTIC_POSTS_POS if stance > 0.3 else (HEURISTIC_POSTS_NEG if stance < -0.3 else HEURISTIC_POSTS_NEU), rng)[0]
                act["content"] = template.format(t=t).capitalize()
                act["sentiment"] = _clamp(stance * 0.7 + rng.uniform(-0.25, 0.25))
                shift = rng.uniform(-0.05, 0.05) + (impact * evt_sent * 0.4 if event else 0)
                act["stance_after"] = _clamp(stance + shift)
            elif roll < 0.78:
                act["action"] = "reaction"
                if self._ctx_messages:
                    target = rng.choice(self._ctx_messages)
                    act["target"] = target["id"]
                    agree = target["sentiment"] * stance > 0 or (target["sentiment"] == 0)
                    act["like"] = agree if rng.random() < 0.75 else (not agree)
                    act["sentiment"] = 1.0 if act["like"] else -1.0
                    act["content"] = _pick(HEURISTIC_REACT, rng)[0].format(a=f"@{self.agents[target['agent_id']]['name']}")
                    act["action"] = "reply" if rng.random() < 0.4 else "reaction"
                    act["reply_to"] = target["id"] if act["action"] == "reply" else ""
            elif roll < 0.9:
                act["action"] = "do_nothing"
                act["reason"] = "just lurking"
        return actions

    async def _apply_actions(self, r: int, actions: list[dict], mode: str):
        applied: list[dict] = []
        for act in actions:
            aid = self._agent_by_name.get(act["name"])
            if not aid:
                continue
            a = self.agents[aid]
            kind = act["action"]
            public = {"agent_id": aid, "agent_name": a["name"], "kind": kind, "round": r,
                      "platform": a.get("platform", "reddit"), "stance": _clamp(act.get("stance_after", a["stance"])),
                      "sentiment": act.get("sentiment", 0.0), "content": act.get("content", ""),
                      "reason": act.get("reason", ""), "action": kind}
            if kind == "post":
                db.insert_message(self.sid, aid, r, "post", a.get("platform", "reddit"),
                                  act["content"], _clamp(act["stance_after"]), act.get("sentiment", 0.0))
                public["content"] = act["content"]
                applied.append(public)
            elif kind == "reply":
                db.insert_message(self.sid, aid, r, "reply", a.get("platform", "reddit"),
                                  act["content"], _clamp(act["stance_after"]), act.get("sentiment", 0.0),
                                  reply_to=act.get("reply_to", ""))
                public["content"] = act["content"]
                applied.append(public)
            elif kind == "reaction":
                target = act.get("target", "")
                like = bool(act.get("like", True))
                db.insert_message(self.sid, aid, r, "reaction", a.get("platform", "reddit"),
                                  "liked this" if like else "disliked this", _clamp(act["stance_after"]),
                                  1.0 if like else -1.0, reply_to=target)
                if target:
                    with db.cursor() as c:
                        c.execute("UPDATE messages SET likes = likes + ? WHERE id=?",
                                  (1 if like else -1, target))
                public["content"] = f"{'liked' if like else 'disliked'} a post"
                public["target"] = target
                applied.append(public)
            # apply stance/mood changes
            a["stance"] = _clamp(act.get("stance_after", a["stance"]))
            a["mood"] = _clamp(a["mood"] * 0.7 + act.get("sentiment", 0.0) * 0.3)
            db.update_agent(self.sid, aid, stance=a["stance"], mood=a["mood"])
        if applied:
            await broadcast(self.sid, {"type": "actions", "actions": applied})

    async def _community_pull(self, rng: random.Random, active_ids: list[str]):
        voices = [a for aid, a in self.agents.items() if aid in active_ids and a["influence"] > 0.5]
        if not voices:
            return
        total = sum(v["influence"] for v in voices)
        pull = sum(v["stance"] * v["influence"] for v in voices) / total if total else 0.0
        for aid, a in self.agents.items():
            if aid in active_ids:
                continue
            if rng.random() < 0.35:
                a["stance"] = _clamp(a["stance"] + (pull - a["stance"]) * 0.04 * a["influence"])
                db.update_agent(self.sid, aid, stance=a["stance"])

    def _snapshot(self, r: int) -> dict:
        stances = [a["stance"] for a in self.agents.values()]
        moods = [a["mood"] for a in self.agents.values()]
        counts = db.message_counts(self.sid)
        sentiment = counts["avg_sentiment"]
        camps = {"support": 0, "neutral": 0, "oppose": 0}
        for s in stances:
            camps["support" if s > 0.25 else ("oppose" if s < -0.25 else "neutral")] += 1
        snap = {
            "sentiment": round(sentiment, 3),
            "stance_std": round(_stddev(stances), 3),
            "message_count": counts["count"],
            "avg_mood": round(sum(moods) / len(moods), 3) if moods else 0.0,
            "camps": camps,
        }
        db.insert_snapshot(self.sid, r, snap["sentiment"], snap["stance_std"], counts["count"],
                           {"avg_mood": snap["avg_mood"], "camps": camps})
        return snap

    def _agent_public(self, a: dict) -> dict:
        return {
            "id": a["id"], "name": a["name"], "stance": round(a["stance"], 3),
            "mood": round(a["mood"], 3), "activity": a["activity"], "influence": a["influence"],
            "x": a["x"], "y": a["y"], "platform": a.get("platform", "reddit"),
        }


# ------------------------------------------------------------------ manager

def start_engine(sid: str) -> SimulationEngine:
    sim = db.get_simulation(sid)
    if not sim:
        raise ValueError("simulation not found")
    project = db.get_project(sim["project_id"])
    if not project:
        raise ValueError("project not found")

    existing = ENGINES.get(sid)
    if existing is not None:
        raise ValueError("simulation is already running")

    agents = db.get_agents(sid)
    if not agents:
        raise ValueError("world not built yet - create agents first")

    engine = SimulationEngine(sid, project, sim["config"])
    ENGINES[sid] = engine
    TASKS[sid] = asyncio.create_task(engine.run())
    return engine


def stop_engine(sid: str) -> bool:
    engine = ENGINES.get(sid)
    if engine is None:
        return False
    engine.stop()
    return True
