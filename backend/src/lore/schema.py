"""Brain graph schema: every node carries the shared `Entity` label plus its own type label.

`Entity.id` is globally unique within a tenant, so tools can address any node generically.
Timestamps are epoch milliseconds (FalkorDB has no temporal arithmetic), and time-bounded
relationships carry `valid_from` / `valid_to` (absent `valid_to` = still true).
"""

from falkordb import Graph

from lore.config import settings

NODE_LABELS = [
    "Person", "Team", "Service", "Repo", "File", "Function",
    "PR", "Deploy", "Ticket", "Thread", "Message", "Doc", "Decision",
    "Incident", "Alert", "Hypothesis", "Finding", "Action", "Source",
    "SandboxRun", "Patch", "TestRun",
]

FULLTEXT_FIELDS = ["name", "title", "text"]
VECTOR_LABELS = ["Entity", "Incident", "Procedure"]


def try_create(graph: Graph, cypher: str) -> None:
    try:
        graph.query(cypher)
    except Exception as e:  # index/constraint already exists
        if "already" not in str(e).lower():
            raise


def ensure_brain_schema(graph: Graph) -> None:
    try_create(graph, "CREATE INDEX FOR (n:Entity) ON (n.id)")
    for label in NODE_LABELS:
        try_create(graph, f"CREATE INDEX FOR (n:{label}) ON (n.id)")
    for label in ["PR", "Deploy", "Message", "Incident", "Alert"]:
        try_create(graph, f"CREATE INDEX FOR (n:{label}) ON (n.ts)")
    try:
        graph.create_node_unique_constraint("Entity", "id")
    except Exception as e:
        if "already" not in str(e).lower() and "exists" not in str(e).lower():
            raise
    try_create(graph, "CREATE FULLTEXT INDEX FOR (n:Entity) ON (" + ", ".join(f"n.{f}" for f in FULLTEXT_FIELDS) + ")")
    # HNSW vector indexes: Entity for global semantic search, Incident/Procedure for memory matching.
    for label in VECTOR_LABELS:
        try_create(graph, f"CREATE VECTOR INDEX FOR (n:{label}) ON (n.embedding) "
                    f"OPTIONS {{dimension: {settings.embed_dims}, similarityFunction: 'cosine'}}")
