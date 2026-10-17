"""The demo depends on these graph facts. Runs against a throwaway tenant on the local FalkorDB."""

import asyncio

import pytest

from lore import db
from lore.seed.build import build
from lore.seed.load import load
from lore.tools import graph as G

TENANT = "pytest"


@pytest.fixture(scope="module")
def g():
    graph = db.brain(TENANT)
    load(graph, build(db.now_ms()))
    yield graph
    graph.delete()


def test_recent_changes_flags_pr_482(g):
    changes = G.recent_changes(g, "checkout", hours=6)["data"]["changes"]
    pr = next(c for c in changes if c["pr"] == "PR-482")
    assert pr["service"] == "payments-api" and pr["governing_decisions"] == ["D-17"]
    assert any("D-17" in f and "none of its owners" in f for f in pr["risk_flags"])


def test_decision_lineage(g):
    d = G.trace_decision(g, "PR-482")["data"]["decisions"][0]
    assert (d["id"], d["adr"], d["incident"]) == ("D-17", "ADR-012", "INC-203")
    assert d["key_quotes"]


def test_expert_routing_skips_ooo_owner(g):
    experts = G.who_knows(g, "file:services/payments_api/db/pool.py")["data"]["experts"]
    assert experts[0]["id"] == "priya" and not experts[0]["available"]
    assert next(e for e in experts if e["available"])["id"] == "arjun"


def test_similar_incident_shares_files(g):
    inc = asyncio.run(G.similar_incidents(g, "checkout", symptoms="checkout p99 latency", compare_pr="PR-482"))["data"]["incidents"][0]
    assert inc["id"] == "INC-203" and "services/payments_api/db/pool.py" in inc["files_shared_with_compare_pr"]


def test_ownership_history(g):
    assert G.who_owns(g, "notifications")["data"]["owner"]["team"] == "team-growth"
    past = G.who_owns(g, "notifications", at="2000-01-01")["data"]
    assert past["owner"] is None and len(past["history"]) == 2


def test_tenant_isolation(g):
    other = db.brain("pytest-other")
    try:
        assert asyncio.run(G.search_entities(other, "payments"))["data"] == []
    finally:
        try:
            other.delete()
        except Exception:
            pass


def test_run_cypher_is_read_only(g):
    assert "error" in G.run_cypher(g, "MATCH (n) DETACH DELETE n")["data"]
