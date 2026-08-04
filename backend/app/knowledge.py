"""Lightweight local knowledge extraction from seed material.

No external graph service: keywords, entities and a short summary give agents
enough grounding to behave plausibly.
"""
import re
from collections import Counter

STOPWORDS = set(
    """the a an and or but if then else of to in for on with as by from at is are was were be been
    it its this that these those i you we they he she them their our your my me him her his
    not no do does did will would can could should shall may might must about into over under
    what which who whom when where why how there here all any both each few more most other some
    such only own same so than too very just also s t dont dong will going go get got one two
    says said say according report reports news new article story has have had being
    """.split()
)


def chunk_text(text: str, size: int = 900, overlap: int = 120) -> list[str]:
    words = re.split(r"\s+", text.strip())
    if not words:
        return []
    chunks: list[str] = []
    i = 0
    while i < len(words):
        chunk = " ".join(words[i:i + size])
        chunks.append(chunk)
        if i + size >= len(words):
            break
        i += size - overlap
    return chunks


def extract_topics(text: str, top_k: int = 12) -> list[dict]:
    """Keyword + capitalized-entity extraction into topic buckets."""
    words = re.findall(r"[A-Za-z][A-Za-z'\-]{2,}|\b[\u4e00-\u9fff]{2,}\b", text.lower())
    counts = Counter(w for w in words if w not in STOPWORDS and len(w) > 2)
    keywords = [w for w, _ in counts.most_common(40)]

    entities = Counter()
    for m in re.finditer(r"\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3}\b", text):
        ent = m.group().strip()
        if 3 <= len(ent) <= 60 and not ent.upper() in {"THE", "AN", "AND", "OR"}:
            entities[ent] += 1

    topics: list[dict] = []
    for word, freq in counts.most_common(top_k):
        if freq < 2 and len(topics) >= top_k // 2:
            break
        topics.append({"keyword": word, "weight": round(min(freq / max(counts.most_common(1)[0][1], 1), 1.0), 2)})
    if len(topics) < 4:
        for ent, freq in entities.most_common(8):
            topics.append({"keyword": ent.lower(), "weight": round(min(freq / max(entities.most_common(1)[0][1], 1), 1.0), 2)})

    return topics[:top_k]


def extract_entities(text: str, top_k: int = 10) -> list[str]:
    entities = Counter()
    for m in re.finditer(r"\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3}\b", text):
        ent = m.group().strip()
        if 3 <= len(ent) <= 60:
            entities[ent] += 1
    return [e for e, _ in entities.most_common(top_k)]


def summarize(text: str, limit: int = 2200) -> str:
    chunks = chunk_text(text)
    if not chunks:
        return ""
    out = " ".join(chunks)
    return out[:limit]
