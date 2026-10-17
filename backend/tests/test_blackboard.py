"""Blackboard coordination guarantees, without any LLM in the loop."""

import asyncio
from concurrent.futures import ThreadPoolExecutor

import pytest

from lore import blackboard as BB
from lore import db
from lore.seed.build import build
from lore.seed.load import load

T = "pytest-bb"


@pytest.fixture(scope="module")
def g():
    graph = db.brain(T)
    load(graph, build(db.now_ms()))
    yield graph
    graph.delete()


def test_concurrent_claims_never_collide(g):
    iid = BB.open_incident(g, T, "checkout", "p99 latency", "test")
    for i in range(3):
        BB.add_hypothesis(g, iid, f"cause {i}", "r", tenant=T, agent="triage")
    with ThreadPoolExecutor(12) as pool:
        claims = list(pool.map(lambda k: BB.claim_hypothesis(g, iid, tenant=T, agent=f"inv-{k}"), range(12)))
    won = [c["id"] for c in claims if c]
    assert len(won) == 3 and len(set(won)) == 3
    seqs = [e["seq"] for e in BB.events(g, iid)]
    assert seqs == list(range(1, len(seqs) + 1))  # event sequence stays gap-free under concurrent writes


def test_graph_decides_who_can_approve(g):
    iid = BB.open_incident(g, T, "checkout", "p99 latency", "test")
    h = BB.add_hypothesis(g, iid, "PR-482 shrank the pool", "r", tenant=T, agent="triage")["hypothesis_id"]
    f = BB.post_finding(g, iid, h, "confirmed", 0.9, "pool 4 < 24", ["PR-482", "D-17"], tenant=T, agent="inv")
    a = BB.propose_action(g, iid, "open_pr", "PR-482", "revert", f["finding_id"], ["arjun"], tenant=T, agent="resp")
    assert {"arjun", "priya", "lena"} <= set(a["approvers"]) and "kabir" not in a["approvers"]
    assert not BB.decide_action(g, T, a["action_id"], "kabir", True)["ok"]
    assert BB.decide_action(g, T, a["action_id"], "arjun", True)["status"] == "approved"
    assert not BB.decide_action(g, T, a["action_id"], "lena", True)["ok"]  # already decided


def test_procedures_are_found_for_dependent_services(g):
    iid = BB.open_incident(g, T, "checkout", "p99 latency", "test")
    BB.record_procedure(g, iid, "pool exhaustion", "checkout p99 latency payments capture slow", "pool below floor",
                        ["check recent deploys"], "revert", tenant=T, agent="scribe")
    procs = asyncio.run(BB.match_procedures(g, "checkout", "checkout p99 latency spike"))
    assert procs and procs[0]["id"]
