"""FalkorDB access. Every tenant gets its own graph; every user gets a private memory graph.

Graph keys:
  brain:{tenant}          org knowledge graph (people, code, decisions, incidents, blackboard)
  mem:{tenant}:{user}     a user's private agent memory
"""

import re
import time
from functools import lru_cache
from typing import Any

from falkordb import Edge, FalkorDB, Graph, Node, Path

from lore.config import settings

_SAFE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,62}$")


def _check(part: str) -> str:
    if not _SAFE.match(part):
        raise ValueError(f"invalid tenant/user id: {part!r}")
    return part


def brain_key(tenant: str) -> str:
    return f"brain:{_check(tenant)}"


def memory_key(tenant: str, user: str) -> str:
    return f"mem:{_check(tenant)}:{_check(user)}"


@lru_cache(maxsize=1)
def client() -> FalkorDB:
    return FalkorDB(
        host=settings.falkordb_host,
        port=settings.falkordb_port,
        username=settings.falkordb_username,
        password=settings.falkordb_password,
    )


def brain(tenant: str | None = None) -> Graph:
    return client().select_graph(brain_key(tenant or settings.default_tenant))


def memory(tenant: str, user: str) -> Graph:
    return client().select_graph(memory_key(tenant, user))


def now_ms() -> int:
    return int(time.time() * 1000)


def to_py(value: Any) -> Any:
    """Convert FalkorDB result values into plain JSON-friendly Python."""
    if isinstance(value, Node):
        return {"_labels": [l for l in value.labels if l != "Entity"], **value.properties}
    if isinstance(value, Edge):
        return {"_type": value.relation, **value.properties}
    if isinstance(value, Path):
        nodes = value.nodes()
        ids = {n.id: n.properties.get("id") for n in nodes}
        return {
            "nodes": [to_py(n) for n in nodes],
            "edges": [
                {"from": ids.get(e.src_node), "to": ids.get(e.dest_node), **to_py(e)} for e in value.edges()
            ],
        }
    if isinstance(value, list):
        return [to_py(v) for v in value]
    if isinstance(value, dict):
        return {k: to_py(v) for k, v in value.items()}
    return value


def rows(graph: Graph, cypher: str, params: dict | None = None, *, read_only: bool = True) -> list[dict]:
    """Run a query and return rows as dicts keyed by column alias."""
    if read_only:
        res = graph.ro_query(cypher, params or {}, timeout=settings.query_timeout_ms)
    else:
        res = graph.query(cypher, params or {}, timeout=settings.query_timeout_ms)
    cols = [h[1] if isinstance(h, (list, tuple)) else h for h in res.header]
    return [dict(zip(cols, r)) for r in res.result_set]


def write(graph: Graph, cypher: str, params: dict | None = None) -> list[dict]:
    return rows(graph, cypher, params, read_only=False)
