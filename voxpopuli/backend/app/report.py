"""Smart prediction report generation after a simulation completes."""
import logging

from . import db
from .config import Config
from .llm import LLMFactory

log = logging.getLogger("voxpopuli.report")


def _camps(agents: list[dict]) -> dict:
    camps = {"support": [], "neutral": [], "oppose": []}
    for a in agents:
        s = a["stance"]
        if s > 0.25:
            camps["support"].append(a)
        elif s < -0.25:
            camps["oppose"].append(a)
        else:
            camps["neutral"].append(a)
    return camps


def _snapshot_rows(sid: str) -> str:
    snaps = db.get_snapshots(sid)
    if not snaps:
        return "(no snapshots recorded)"
    rows = []
    for s in snaps:
        rows.append(f"round {s['round']}: sentiment {s['sentiment']:+.3f}, opinion-spread {s['stance_std']:.3f}, posts {s['message_count']}")
    return "\n".join(rows)


def _events_rows(sid: str) -> str:
    evs = db.get_events(sid)
    if not evs:
        return "(no injected events)"
    return "\n".join(f"round {e['round']}: \"{e['content']}\" (impact {e['impact']})" for e in evs)


def _top_posts_rows(sid: str) -> str:
    top = db.top_messages(sid, None, limit=8)
    if not top:
        return "(no posts)"
    return "\n".join(f"- \"{m['content'][:160]}\" by agent id {m['agent_id']} (sentiment {m['sentiment']:+.2f}, likes {m['likes']})" for m in top)


def _heuristic_report(sid: str, project: dict, agents: list[dict], snaps: list[dict], evs: list[dict], counts: dict) -> str:
    camps = _camps(agents)
    camps_text = (
        f"- **Supporting the story's direction ({len(camps['support'])} citizens):** "
        f"{', '.join(a['name'] for a in camps['support'][:5]) or 'nobody'}\n"
        f"- **Neutral / undecided ({len(camps['neutral'])} citizens):** "
        f"{', '.join(a['name'] for a in camps['neutral'][:5]) or 'nobody'}\n"
        f"- **Opposing the story's direction ({len(camps['oppose'])} citizens):** "
        f"{', '.join(a['name'] for a in camps['oppose'][:5]) or 'nobody'}"
    )
    trend = "stable"
    if len(snaps) > 1:
        first, last = snaps[0]["sentiment"], snaps[-1]["sentiment"]
        delta = last - first
        trend = f"moved from {first:+.2f} to {last:+.2f} (net {delta:+.2f})"
    events_text = "\n".join(f"- round {e['round']}: \"{e['content']}\" (impact {e['impact']})" for e in evs) or "- none"
    top = _top_posts_rows(sid)
    final_sentiment = snaps[-1]["sentiment"] if snaps else 0.0
    return f"""# Public Opinion Prediction Report

## Executive summary
The simulated community reacted to the story over {len(snaps)} rounds with {counts['count']} public actions.
Overall sentiment {trend}. The simulation was run by the built-in heuristic engine (no LLM key configured).

## How public opinion moved
{_snapshot_rows(sid)}

## Opinion camps
{camps_text}

## Key turning points
{events_text}

## Most popular posts
{top}

## What to watch next
Monitor whether the neutral camp (the largest swing group) is pulled toward either side.
The trend direction at round {len(snaps)} is the strongest near-term signal.

## Scenarios
- **Base:** gradual drift continues in the direction of the final sentiment ({final_sentiment:+.2f}).
- **Optimistic:** supportive voices keep engagement high and convert neutrals.
- **Pessimistic:** a counter-event flips the current majority and opinion polarizes further.

> Bottom line: the public is leaning {trend.split('(')[0].strip()}; expect the dominant camp to keep growing unless a new event disrupts it."""


def build_digest(project: dict, agents: list[dict], sid: str) -> str:
    camps = _camps(agents)
    camps_text = (
        f"- support camp ({len(camps['support'])}): {', '.join(a['name'] for a in camps['support'][:6]) or 'none'}\n"
        f"- neutral camp ({len(camps['neutral'])}): {', '.join(a['name'] for a in camps['neutral'][:6]) or 'none'}\n"
        f"- oppose camp ({len(camps['oppose'])}): {', '.join(a['name'] for a in camps['oppose'][:6]) or 'none'}"
    )
    return f"""PREDICTION QUESTION: {project.get('requirement') or 'What happens next?'}

SIMULATION SNAPSHOTS (round by round):
{_snapshot_rows(sid)}

INJECTED EVENTS:
{_events_rows(sid)}

FINAL OPINION CAMPS:
{camps_text}

MOST POPULAR POSTS:
{_top_posts_rows(sid)}"""


async def generate_report(sid: str, project: dict):
    agents = db.get_agents(sid)
    snaps = db.get_snapshots(sid)
    evs = db.get_events(sid)
    counts = db.message_counts(sid)
    digest = build_digest(project, agents, sid)

    client = LLMFactory.get()
    if client is None:
        content = _heuristic_report(sid, project, agents, snaps, evs, counts)
    else:
        prompt = f"""You are a data-driven public opinion analyst. Based ONLY on the simulation data below, write a concise Markdown prediction report answering the PREDICTION QUESTION.

Structure it with these sections:
## Executive Summary
## How public opinion moved
## Opinion camps
## Key turning points
## What to watch next
## Scenarios (base / optimistic / pessimistic)

Keep it sharp and grounded in the numbers. Cite rounds, sentiment values and specific posts when relevant. End with a one-line bottom-line prediction.

DATA:
{digest}"""
        try:
            content = await client.chat_text(
                [{"role": "user", "content": prompt}],
                temperature=0.5, max_tokens=2600,
            )
        except Exception as exc:
            log.warning("llm report failed, falling back: %s", exc)
            content = _heuristic_report(project, agents, snaps, evs, counts)

    db.save_report(sid, content)
    return content
