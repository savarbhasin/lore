"""The incident team. Agents coordinate only through the blackboard in the graph:

    Triage ──add_hypothesis──▶ board ◀──claim/post_finding── Investigators (parallel)
                                 │
    Responder ◀──confirmed finding┘──propose_action──▶ humans approve (graph-authorized)
    Scribe (on resolve) ──record_procedure──▶ procedural memory used by the next Triage
"""

import asyncio
import json
import logging

from lore import blackboard as BB
from lore import db
from lore.agents.runtime import run_agent
from lore.embeddings import embed_missing
from lore.events import bus
from lore.mcp_server import create_server

log = logging.getLogger(__name__)

READ = {"search_entities", "get_entity", "who_owns", "who_knows", "blast_radius", "recent_changes",
        "trace_decision", "explain_path", "similar_incidents", "run_cypher", "get_incident"}
TRIAGE_TOOLS = {"search_entities", "get_entity", "blast_radius", "recent_changes", "similar_incidents",
                "get_incident", "add_hypothesis"}
INVESTIGATOR_TOOLS = READ | {"post_finding"}
RESPONDER_TOOLS = {"who_knows", "who_owns", "get_entity", "trace_decision", "get_incident", "propose_action"}
SCRIBE_TOOLS = {"get_incident", "get_entity", "trace_decision", "record_procedure"}

COMMON = """You are part of Lore's incident team for {org}, working on {iid}. Coordinate only through the
incident board tools. Use entity ids exactly as tools return them. Be decisive and brief; do not narrate.
Efficiency matters: every tool call is counted. When you already have an id (from the alert, the board or a
previous result), call the specific tool directly — never search_entities for it. Prefer recent_changes,
trace_decision and similar_incidents, which return a lot in one call."""

TRIAGE = COMMON + """
You are TRIAGE. Scope the incident and put testable hypotheses on the board.
1. Check recent_changes for the alerted service (include dependencies, last 24h) and similar_incidents.
2. Call add_hypothesis for the {n} most likely causes, most likely first. Phrase each as a candidate CAUSE
   ("X caused the alert because ..."), never as "X is unrelated". Each must name the concrete entity ids
   involved (PR, deploy, service, file) so an investigator can test it.
Then stop with a one-line summary."""

PLAYBOOK = """
A procedure learned from a past incident matches this alert. Follow it — verify its first steps directly and,
if they fit, add just ONE hypothesis built from it:
{procedure}"""

INVESTIGATOR = COMMON + """
You are {agent}. Test exactly this hypothesis ({hid}): "{statement}"
Gather only the evidence you need (aim for 3-5 calls): recent_changes / trace_decision / similar_incidents /
get_entity on the ids in the hypothesis.
Then call post_finding exactly once with hypothesis_id="{hid}", a verdict (confirmed / rejected / inconclusive),
a confidence 0-1, a 1-2 sentence summary with the decisive facts, and evidence_ids (the PRs, deploys, files,
decisions, incidents that prove it). Then stop."""

RESPONDER = COMMON + """
You are RESPONDER. The confirmed finding is {fid}: "{summary}" (evidence: {evidence}).
Propose actions with propose_action (finding_id="{fid}"), then stop:
1. kind="page": the best AVAILABLE expert for the affected code (use who_knows on the file or service; skip anyone
   out of office). target = person id.
2. kind="open_pr": revert or fix the change that caused it. target = the PR id to revert. reviewers = the
   available experts / decision owners (person ids). summary = what the PR does and why, citing the decision.
3. kind="post_message": target = the owning team's Slack channel (use who_owns). summary = 2-3 line status
   update with the root cause and next step."""

SCRIBE = COMMON + """
You are SCRIBE. The incident is resolved. Read the board with get_incident, then call record_procedure once:
a reusable playbook another team could follow next time. symptoms = alert symptoms in plain words;
root_cause_pattern = the general pattern (not just this PR); steps = 3-5 concrete checks in order, naming the
tools/entities to look at; fix_recipe = the fix that worked. Then stop."""


def _org(tenant: str) -> str:
    return tenant.capitalize()


async def run_incident(tenant: str, incident_id: str, *, investigators: int = 3) -> None:
    g = db.brain(tenant)
    topic = BB.topic(tenant, incident_id)
    total_calls = 0

    def emit(e: dict):
        bus.publish(topic, e)

    async def agent_run(name: str, system: str, task: str, allowed: set[str], steps: int = 10):
        nonlocal total_calls
        BB.log_event(g, tenant, incident_id, name, "agent_start", f"{name} started")
        r = await run_agent(create_server(tenant, agent=name), agent=name, system=system, task=task,
                            allowed=allowed, max_steps=steps, emit=emit)
        total_calls += r.tool_calls
        BB.add_tool_calls(g, incident_id, r.tool_calls)
        return r

    try:
        board = BB.get_incident(g, incident_id)
        inc = board["incident"]
        service = inc["services"][0]
        fmt = {"org": _org(tenant), "iid": incident_id}

        # --- Triage (procedural memory first) -------------------------------------------------------
        procs = [p for p in await BB.match_procedures(g, service, f"{inc['title']} {inc.get('text', '')}")
                 if p["similarity"] >= BB.PROCEDURE_MATCH]
        system = TRIAGE.format(**fmt, n=3)
        if procs:
            p = procs[0]
            BB.use_procedure(g, p["id"])
            BB.log_event(g, tenant, incident_id, "triage", "procedure_match",
                         f"matched {p['id']} ({p['similarity']:.0%} similar): {p['title']}",
                         {"procedure_id": p["id"], "similarity": p["similarity"]})
            system = TRIAGE.format(**fmt, n=1) + PLAYBOOK.format(procedure=json.dumps(p, default=str))
        await agent_run("triage", system,
                        f"ALERT on {service}: {inc['title']}. {inc.get('text', '')}", TRIAGE_TOOLS, steps=8)

        # --- Investigators in parallel ----------------------------------------------------------------
        async def investigate(k: int):
            name = f"investigator-{k}"
            h = BB.claim_hypothesis(g, incident_id, tenant=tenant, agent=name)
            if not h:
                return
            await agent_run(name, INVESTIGATOR.format(**fmt, agent=name, hid=h["id"], statement=h["statement"]),
                            f"Investigate hypothesis {h['id']} for {incident_id}.", INVESTIGATOR_TOOLS, steps=10)
            done = db.rows(g, "MATCH (h:Hypothesis {id: $id}) RETURN h.status AS s", {"id": h["id"]})
            if done and done[0]["s"] == "claimed":
                BB.post_finding(g, incident_id, h["id"], "inconclusive", 0.0, f"{name} ran out of steps",
                                [], tenant=tenant, agent=name)

        n_open = len([h for h in BB.get_incident(g, incident_id)["hypotheses"] if h["status"] == "open"])
        await asyncio.gather(*(investigate(k + 1) for k in range(min(investigators, n_open))))

        # --- Responder ------------------------------------------------------------------------------
        findings = [f for f in BB.get_incident(g, incident_id)["findings"] if f["verdict"] == "confirmed"]
        if not findings:
            BB.set_status(g, tenant, incident_id, "needs_human")
            BB.log_event(g, tenant, incident_id, "system", "escalate", "no hypothesis confirmed — escalating to humans")
        else:
            best = max(findings, key=lambda f: f["confidence"])
            BB.set_status(g, tenant, incident_id, "root_cause_found")
            await agent_run("responder", RESPONDER.format(**fmt, fid=best["id"], summary=best["summary"],
                                                          evidence=", ".join(best["evidence"])),
                            f"Propose the response actions for {incident_id}.", RESPONDER_TOOLS, steps=10)
            BB.set_status(g, tenant, incident_id, "awaiting_approval")
        BB.log_event(g, tenant, incident_id, "system", "team_done", f"team finished in {total_calls} tool calls",
                     {"tool_calls": total_calls})
    except Exception as e:  # keep the board consistent and tell subscribers
        log.exception("incident run failed")
        BB.log_event(g, tenant, incident_id, "system", "error", f"team run failed: {e}")
        bus.publish(topic, {"type": "error", "error": str(e)})


async def resolve_incident(tenant: str, incident_id: str) -> None:
    g = db.brain(tenant)
    BB.set_status(g, tenant, incident_id, "resolved")
    learned = db.rows(g, "MATCH (p:Procedure)-[:LEARNED_FROM]->(:Incident {id: $id}) RETURN p.id AS id",
                      {"id": incident_id})
    used = db.rows(g, "MATCH (e:Event {kind: 'procedure_match'})-[:IN]->(:Incident {id: $id}) RETURN e.seq AS s",
                   {"id": incident_id})
    if not learned and not used:
        r = await run_agent(create_server(tenant, agent="scribe"), agent="scribe",
                            system=SCRIBE.format(org=_org(tenant), iid=incident_id),
                            task=f"Write the procedure for {incident_id}.", allowed=SCRIBE_TOOLS, max_steps=6,
                            emit=lambda e: bus.publish(BB.topic(tenant, incident_id), e))
        BB.add_tool_calls(g, incident_id, r.tool_calls)
    await embed_missing(g)  # the resolved incident and any new procedure become searchable memory
    bus.publish(BB.topic(tenant, incident_id), {"type": "done", "incident_id": incident_id})
