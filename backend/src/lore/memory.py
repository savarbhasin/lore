"""Per-user agent memory, one FalkorDB graph per (tenant, user): mem:{tenant}:{user}.

    (:Session {id, surface})-[:HAS]->(:Episode {question, answer, answer_id, ts})-[:MENTIONS]->(:Ref {id})
    (:Fact {text, kind, ts})-[:LEARNED_IN]->(:Episode)

Episodic memory = past exchanges (and which brain entities they touched). Semantic memory = durable facts
and preferences about the user. Procedural memory lives in the shared brain graph (see blackboard.py).
"""

import uuid

from falkordb import Graph

from lore import db
from lore.db import now_ms, rows, write

_ready: set[str] = set()


def graph(tenant: str, user: str) -> Graph:
    g = db.memory(tenant, user)
    if g.name not in _ready:
        for cypher in [
            "CREATE INDEX FOR (s:Session) ON (s.id)",
            "CREATE INDEX FOR (e:Episode) ON (e.id)",
            "CREATE INDEX FOR (r:Ref) ON (r.id)",
            "CREATE FULLTEXT INDEX FOR (e:Episode) ON (e.question, e.answer)",
            "CREATE FULLTEXT INDEX FOR (f:Fact) ON (f.text)",
        ]:
            try:
                g.query(cypher)
            except Exception:
                pass
        _ready.add(g.name)
    return g


def history(g: Graph, session_id: str, limit: int = 6) -> list[dict]:
    """Recent turns of this conversation, oldest first."""
    r = rows(
        g,
        """
        MATCH (:Session {id: $sid})-[:HAS]->(e:Episode)
        RETURN e.question AS question, e.answer AS answer, e.ts AS ts ORDER BY e.ts DESC LIMIT $n
        """,
        {"sid": session_id, "n": limit},
    )
    return list(reversed(r))


def facts(g: Graph, limit: int = 12) -> list[str]:
    return [r["text"] for r in rows(g, "MATCH (f:Fact) RETURN f.text AS text ORDER BY f.ts DESC LIMIT $n", {"n": limit})]


def save_episode(g: Graph, session_id: str, surface: str, question: str, answer: str, answer_id: str,
                 mentions: list[str]) -> str:
    eid = f"E-{uuid.uuid4().hex[:8]}"
    write(
        g,
        """
        MERGE (s:Session {id: $sid}) ON CREATE SET s.surface = $surface, s.ts = $ts
        CREATE (e:Episode {id: $eid, question: $q, answer: $a, answer_id: $aid, ts: $ts})
        CREATE (s)-[:HAS]->(e)
        WITH e
        UNWIND $mentions AS m
        MERGE (r:Ref {id: m})
        CREATE (e)-[:MENTIONS]->(r)
        """,
        {"sid": session_id, "surface": surface, "eid": eid, "q": question, "a": answer, "aid": answer_id,
         "ts": now_ms(), "mentions": mentions},
    )
    return eid


# ---- agent-facing memory tools (user and tenant are bound by the runtime) ------------------------

def remember(g: Graph, fact: str, kind: str = "fact") -> dict:
    """Save a durable fact or preference about the current user (e.g. 'works on the Payments team',
    'prefers short answers'). Use only for things worth knowing in future conversations."""
    write(g, "CREATE (:Fact {id: $id, text: $text, kind: $kind, ts: $ts})",
          {"id": f"FACT-{uuid.uuid4().hex[:6]}", "text": fact, "kind": kind, "ts": now_ms()})
    return {"saved": fact}


def recall(g: Graph, query: str, limit: int = 5) -> dict:
    """Search this user's past conversations and saved facts."""
    terms = " | ".join(w for w in query.split() if len(w) > 2) or query
    out: dict = {"facts": [], "episodes": []}
    try:
        out["facts"] = rows(g, "CALL db.idx.fulltext.queryNodes('Fact', $q) YIELD node RETURN node.text AS text LIMIT $n",
                            {"q": terms, "n": limit})
        out["episodes"] = rows(
            g,
            """
            CALL db.idx.fulltext.queryNodes('Episode', $q) YIELD node, score
            OPTIONAL MATCH (node)-[:MENTIONS]->(r:Ref)
            RETURN node.question AS question, node.answer AS answer, node.answer_id AS answer_id,
                   collect(r.id) AS mentioned, score
            ORDER BY score DESC LIMIT $n
            """,
            {"q": terms, "n": limit},
        )
    except Exception:
        pass
    return out
