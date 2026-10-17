"""Explainability plumbing: every tool runs its queries through a Trace, which records the Cypher it ran
and harvests the nodes/edges it touched so the UI can light up the exact subgraph behind an answer."""

from typing import Any

from falkordb import Edge, Graph, Node, Path

from lore.config import settings
from lore.db import to_py

SOURCE_LABELS = {"PR", "Doc", "Message", "Thread", "Ticket", "Incident", "Decision", "Deploy", "File", "Source"}


class Trace:
    def __init__(self, graph: Graph):
        self.graph = graph
        self.queries: list[str] = []
        self._nodes: dict[int, Node] = {}
        self._edges: dict[int, Edge] = {}

    def q(self, cypher: str, params: dict | None = None, *, highlight: bool = True) -> list[dict]:
        self.queries.append(" ".join(cypher.split()))
        try:
            res = self.graph.ro_query(cypher, params or {}, timeout=settings.query_timeout_ms)
        except Exception as e:
            if "empty key" in str(e):  # tenant graph not created yet: nothing to find
                return []
            raise
        cols = [h[1] if isinstance(h, (list, tuple)) else h for h in res.header]
        out = []
        for raw in res.result_set:
            if highlight:
                for v in raw:
                    self._harvest(v)
            out.append({c: to_py(v) for c, v in zip(cols, raw)})
        return out

    def _harvest(self, v: Any) -> None:
        if isinstance(v, Node):
            self._nodes[v.id] = v
        elif isinstance(v, Edge):
            self._edges[v.id] = v
        elif isinstance(v, Path):
            for n in v.nodes():
                self._nodes[n.id] = n
            for e in v.edges():
                self._edges[e.id] = e
        elif isinstance(v, list):
            for x in v:
                self._harvest(x)

    def evidence(self) -> dict:
        ids = {i: n.properties.get("id") for i, n in self._nodes.items()}
        nodes = [
            {
                "id": n.properties.get("id"),
                "label": next((l for l in n.labels if l != "Entity"), "Entity"),
                "name": n.properties.get("name") or n.properties.get("title") or n.properties.get("id"),
            }
            for n in self._nodes.values()
        ]
        edges = [
            {"from": ids[e.src_node], "to": ids[e.dest_node], "type": e.relation}
            for e in self._edges.values()
            if e.src_node in ids and e.dest_node in ids
        ]
        return {"nodes": nodes, "edges": edges}

    def sources(self) -> list[dict]:
        out = []
        for n in self._nodes.values():
            label = next((l for l in n.labels if l != "Entity"), None)
            url = n.properties.get("url")
            if label in SOURCE_LABELS and url:
                out.append({
                    "id": n.properties.get("id"),
                    "kind": label,
                    "title": n.properties.get("title") or n.properties.get("name"),
                    "url": url,
                })
        return out

    def result(self, data: Any) -> dict:
        return {"data": data, "evidence": self.evidence(), "sources": self.sources(), "cypher": self.queries}
