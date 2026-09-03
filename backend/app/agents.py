"""Digital world construction: personas for the simulated public."""
import json
import logging
import random
import re

from .config import Config
from .llm import LLMFactory, is_llm_error

log = logging.getLogger("voxpopuli.agents")


def _pick_names(n: int, seed: int) -> list[str]:
    first = ["Maya", "Diego", "Aisha", "Kenji", "Lena", "Omar", "Priya", "Felix", "Nina", "Tomas",
             "Sana", "Marcus", "Ivy", "Raj", "Zoe", "Elias", "Hana", "Leo", "Yara", "Noah",
             "Amara", "Ravi", "Cleo", "Mateo", "Ingrid", "Shen", "Freya", "Bruno", "Ari", "Mei"]
    last = ["Chen", "Garcia", "Khan", "Tanaka", "Vogel", "Hassan", "Patel", "Weber", "Silva", "Kim",
            "Nowak", "Brown", "Novak", "Sharma", "Bianchi", "Moss", "Ito", "Lopez", "Berg", "Choi"]
    rng = random.Random(seed)
    seen = set()
    out = []
    while len(out) < n:
        name = f"{rng.choice(first)} {rng.choice(last)}"
        if name not in seen:
            seen.add(name)
            out.append(name)
    return out


def _heuristic_personas(seed: int, topics: list[dict], num: int) -> list[dict]:
    rng = random.Random(seed)
    occupations = ["journalist", "university student", "software engineer", "small business owner",
                   "teacher", "retired nurse", "startup founder", "policy analyst", "barista",
                   "lawyer", "high school student", "marketing manager", "doctor", "artist",
                   "union organizer", "freelance writer", "retail manager", "data scientist",
                   "unemployed recent grad", "bank teller", "climate activist", "smallholder farmer"]
    personalities = ["cautious and evidence-driven", "impulsive and expressive", "deeply empathetic",
                     "contrarian and witty", "pragmatic and quiet", "community-minded and vocal",
                     "skeptical of institutions", "optimistic and hopeful", "anxious and risk-averse",
                     "independent and unconventional", "loyal and traditional", "curious and open-minded"]
    styles = ["short punchy posts", "long thoughtful essays", "sarcastic one-liners with memes",
              "calm measured statements", "data-heavy analysis", "personal storytelling",
              "sharp rhetorical questions", "blunt honesty"]
    platforms = ["twitter", "reddit"]

    topics_str = ", ".join(t["keyword"] for t in topics[:5]) or "the current situation"
    agents = []
    for i, name in enumerate(_pick_names(num, rng.randint(0, 1 << 30))):
        stance = round(min(max(rng.gauss(0.0, 0.55), -1.0), 1.0), 2)
        agents.append({
            "name": name,
            "persona": {
                "age": rng.randint(19, 68),
                "occupation": rng.choice(occupations),
                "region": rng.choice(["urban metro", "suburbs", "small town", "coastal city", "rural area"]),
                "personality": rng.choice(personalities),
                "style": rng.choice(styles),
                "interest": topics_str,
                "bio": f"A {rng.choice(['quiet observer', 'natural talker', 'opinionated regular', 'careful thinker', 'passionate newcomer'])} who follows news about {topics_str}.",
            },
            "stance": stance,
            "activity": round(min(max(rng.gauss(0.5, 0.2), 0.1), 0.95), 2),
            "influence": round(min(max(rng.gauss(0.4, 0.2), 0.05), 0.95), 2),
            "platform": rng.choice(platforms),
            "mood": 0.0,
        })
    return agents


def _extract_personas_from_llm(payload: dict) -> list[dict]:
    raw = payload.get("agents")
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        try:
            stance = round(min(max(float(item.get("stance", 0.0)), -1.0), 1.0), 2)
        except (TypeError, ValueError):
            stance = 0.0
        try:
            activity = round(min(max(float(item.get("activity", 0.5)), 0.05), 0.95), 2)
        except (TypeError, ValueError):
            activity = 0.5
        try:
            influence = round(min(max(float(item.get("influence", 0.4)), 0.05), 0.95), 2)
        except (TypeError, ValueError):
            influence = 0.4
        persona = {
            "age": item.get("age", "adult"),
            "occupation": str(item.get("occupation") or "local resident"),
            "region": str(item.get("region") or "the region"),
            "personality": str(item.get("personality") or "thoughtful"),
            "style": str(item.get("style") or "plain and clear"),
            "interest": str(item.get("interest") or "local and world news"),
            "bio": str(item.get("bio") or ""),
        }
        out.append({
            "name": name,
            "persona": persona,
            "stance": stance,
            "activity": activity,
            "influence": influence,
            "platform": "twitter" if str(item.get("platform", "reddit")).lower().startswith("t") else "reddit",
            "mood": 0.0,
        })
    return out


def _persona_batch_prompt(world_brief: str, requirement: str, batch_size: int) -> str:
    return f"""You are building a digital twin of a community reacting to a real-world story.

WORLD BACKGROUND (source material):
{world_brief}

PREDICTION QUESTION the simulation must answer:
{requirement}

Create exactly {batch_size} distinct people who would plausibly be part of this public debate.
Each person must have a believable opinion distribution (mix of support, opposition, and neutral).
Return ONLY a JSON array of {batch_size} objects, each with fields:
- name (full name)
- age (integer)
- occupation
- region
- personality (2-4 words)
- style (how they write online)
- interest (what they care about)
- bio (one sentence)
- stance (number -1 = strongly opposes the story's direction, 0 = neutral, +1 = strongly supports)
- activity (number 0-1, how often they post)
- influence (number 0-1, how much others listen to them)
- platform ("twitter" or "reddit")
Make the group diverse. No object may have an empty name."""


async def generate_world(simulation_id: str, seed_text: str, topics: list[dict], requirement: str, num: int, seed: int = 7) -> tuple[list[dict], str]:
    """Returns (agents, mode). mode is 'llm' or 'heuristic'."""
    world_brief = seed_text[:1400] if seed_text else "The community is discussing a developing story."
    if len(world_brief) < 200:
        world_brief = ("Recent local news context: " + world_brief) if world_brief else "Recent local news context: an event is unfolding."

    client = LLMFactory.get()
    if client is None:
        agents = _heuristic_personas(seed, topics, num)
        return agents, "heuristic"

    agents: list[dict] = []
    tasks = []
    remaining = num
    while remaining > 0:
        batch = min(Config.LLM_BATCH_SIZE, remaining)
        prompt = _persona_batch_prompt(world_brief, requirement, batch)
        tasks.append(client.chat_json_array([
            {"role": "system", "content": "You create realistic, diverse personas. Reply with valid JSON only."},
            {"role": "user", "content": prompt},
        ], temperature=0.9, max_tokens=4000))
        remaining -= batch

    results = await client.gather(*tasks)
    for r in results:
        if is_llm_error(r):
            log.warning("persona batch failed: %s", r)
            continue
        agents.extend(_extract_personas_from_llm({"agents": r}))

    if len(agents) < num:
        fill = _heuristic_personas(seed + 999983, topics, num - len(agents))
        agents.extend(fill)
    return agents[:num], "llm"


def layout_agents(agents: list[dict], seed: int = 7):
    """2D layout: x maps to stance (camps split left/right), y scatters."""
    rng = random.Random(seed)
    for a in agents:
        a["x"] = round(min(max(a["stance"] * 0.72 + rng.uniform(-0.1, 0.1), -0.9), 0.9), 3)
        a["y"] = round(rng.uniform(-0.82, 0.82), 3)
    return agents
