"""Qwen3 embeddings (Fireworks) stored on graph nodes as `embedding` vectors, indexed by FalkorDB's HNSW vector
indexes. Vectors are cached on disk by text hash so re-seeding doesn't re-embed."""

import hashlib
import json
import logging
import sqlite3
from functools import lru_cache
from pathlib import Path

from falkordb import Graph

from lore import db, llm
from lore.config import settings

log = logging.getLogger(__name__)

EMBEDDABLE = ["Doc", "Decision", "Message", "PR", "Ticket", "Incident", "Procedure", "Service"]
BATCH = 64
CACHE_PATH = Path(__file__).resolve().parents[2] / ".cache" / "embeddings.sqlite"


@lru_cache(maxsize=1)
def cache() -> sqlite3.Connection:
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(CACHE_PATH, check_same_thread=False)
    conn.execute("CREATE TABLE IF NOT EXISTS vectors (key TEXT PRIMARY KEY, vector TEXT)")
    return conn


def cache_key(text: str) -> str:
    return hashlib.sha1(f"{settings.embed_model}|{settings.embed_dims}|{text}".encode()).hexdigest()


def text_for(row: dict) -> str:
    parts = [row.get("title") or row.get("name") or "", row.get("text") or ""]
    return " — ".join(p for p in parts if p).strip()[:4000]


async def embed_texts(texts: list[str]) -> list[list[float]]:
    keys = [cache_key(t) for t in texts]
    conn = cache()
    found = {}
    for i in range(0, len(keys), 500):
        chunk = keys[i : i + 500]
        q = f"SELECT key, vector FROM vectors WHERE key IN ({','.join('?' * len(chunk))})"
        found.update({k: json.loads(v) for k, v in conn.execute(q, chunk)})
    missing = [(k, t) for k, t in zip(keys, texts) if k not in found]
    for i in range(0, len(missing), BATCH):
        batch = missing[i : i + BATCH]
        vectors = await llm.embed([t for _, t in batch])
        found.update({k: v for (k, _), v in zip(batch, vectors)})
        conn.executemany("INSERT OR REPLACE INTO vectors VALUES (?, ?)", [(k, json.dumps(v)) for (k, _), v in zip(batch, vectors)])
        conn.commit()
    return [found[k] for k in keys]


async def embed_query(text: str) -> list[float] | None:
    try:
        return (await embed_texts([text[:4000]]))[0]
    except Exception:
        log.warning("embedding unavailable; falling back to text-only matching", exc_info=True)
        return None


async def embed_missing(g: Graph, labels: list[str] | None = None) -> int:
    """Embed every embeddable node that has no vector yet. Returns how many were embedded."""
    rows = db.rows(g, """
        MATCH (n:Entity)
        WHERE n.embedding IS NULL AND any(l IN labels(n) WHERE l IN $labels)
        RETURN n.id AS id, n.title AS title, n.name AS name, n.text AS text""", {"labels": labels or EMBEDDABLE})
    rows = [r for r in rows if text_for(r)]
    if not rows:
        return 0
    try:
        vectors = await embed_texts([text_for(r) for r in rows])
    except Exception:
        log.warning("could not embed %d nodes", len(rows), exc_info=True)
        return 0
    payload = [{"id": r["id"], "v": v} for r, v in zip(rows, vectors)]
    for i in range(0, len(payload), 200):
        db.write(g, "UNWIND $rows AS r MATCH (n:Entity {id: r.id}) SET n.embedding = vecf32(r.v)",
                 {"rows": payload[i : i + 200]})
    return len(payload)
