"""Load a Dataset into a tenant's brain graph, then derive graph-computed relationships."""

from collections import defaultdict

from falkordb import Graph

from lore.schema import ensure_brain_schema
from lore.seed.build import Dataset

BATCH = 500
STRONG_TIE = 4


def _chunks(items: list, n: int = BATCH):
    for i in range(0, len(items), n):
        yield items[i : i + n]


def load(graph: Graph, ds: Dataset, *, reset: bool = True) -> dict:
    if reset:
        try:
            graph.delete()
        except Exception:
            pass
    ensure_brain_schema(graph)

    by_label: dict[str, list] = defaultdict(list)
    for n in ds.nodes:
        by_label[n["label"]].append({"id": n["id"], "props": n["props"]})
    for label, items in by_label.items():
        for chunk in _chunks(items):
            graph.query(
                f"UNWIND $rows AS row CREATE (n:Entity:{label} {{id: row.id}}) SET n += row.props",
                {"rows": chunk},
            )

    by_type: dict[str, list] = defaultdict(list)
    for e in ds.edges:
        by_type[e["type"]].append({"src": e["src"], "dst": e["dst"], "props": e["props"]})
    for rtype, items in by_type.items():
        for chunk in _chunks(items):
            graph.query(
                f"UNWIND $rows AS row MATCH (a:Entity {{id: row.src}}), (b:Entity {{id: row.dst}}) "
                f"CREATE (a)-[r:{rtype}]->(b) SET r += row.props",
                {"rows": chunk},
            )

    derive(graph)
    stats = graph.ro_query("MATCH (n) RETURN count(n)").result_set[0][0], graph.ro_query(
        "MATCH ()-[r]->() RETURN count(r)"
    ).result_set[0][0]
    return {"nodes": stats[0], "edges": stats[1]}


def derive(graph: Graph) -> None:
    """Materialize the people collaboration graph (code review + shared threads) used by the algorithms."""
    graph.query("MATCH ()-[c:COLLABORATES]->() DELETE c")
    graph.query("MATCH ()-[w:WORKS_CLOSELY]->() DELETE w")
    graph.query(
        """
        MATCH (a:Person)-[:AUTHORED]->(:PR)<-[rv:REVIEWED]-(b:Person)
        WHERE a <> b
        WITH a, b, count(rv) AS w
        MERGE (a)-[c:COLLABORATES]->(b)
        ON CREATE SET c.reviews = w, c.threads = 0
        ON MATCH SET c.reviews = c.reviews + w
        """
    )
    graph.query(
        """
        MATCH (a:Person)-[:AUTHORED]->(:Message)-[:IN_THREAD]->(t:Thread)<-[:IN_THREAD]-(:Message)<-[:AUTHORED]-(b:Person)
        WHERE a <> b
        WITH a, b, count(DISTINCT t) AS w
        MERGE (a)-[c:COLLABORATES]->(b)
        ON CREATE SET c.threads = w, c.reviews = 0
        ON MATCH SET c.threads = c.threads + w
        """
    )
    # Make the relation symmetric so direction-sensitive algorithms see both sides.
    graph.query(
        """
        MATCH (a:Person)-[c:COLLABORATES]->(b:Person)
        WHERE NOT (b)-[:COLLABORATES]->(a)
        CREATE (b)-[:COLLABORATES {reviews: c.reviews, threads: c.threads}]->(a)
        """
    )
    graph.query("MATCH ()-[c:COLLABORATES]->() SET c.weight = c.reviews * 2 + c.threads")
    # Strong ties only: used for community detection so incidental Q&A doesn't merge every team.
    graph.query(
        "MATCH (a:Person)-[c:COLLABORATES]->(b:Person) WHERE c.weight >= $th "
        "CREATE (a)-[:WORKS_CLOSELY {weight: c.weight}]->(b)",
        {"th": STRONG_TIE},
    )
