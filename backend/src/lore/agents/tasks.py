"""Approved incident actions become tasks for the same Lore agent (no special-purpose fixer): it gets the incident
context and its sandbox, and works it out itself. Output streams into the incident room."""

from lore import actions
from lore import blackboard as BB
from lore import db
from lore.agents.ask import ask

OPEN_PR_TASK = """Incident {iid} ({title}) — {approver} approved this action: "{summary}"
Confirmed finding ({confidence:.0%}): {finding}
Evidence ids: {evidence}
Suggested reviewers: {reviewers}

Do it for real: use the graph for context (decisions, history, who owns it), then in your sandbox clone the repo,
reproduce the failure with the project's tests, make the fix, show the tests passing, push a branch and open a
pull request against main. Record the PR with record_pull_request (fixes_incident="{iid}"{reverts}). Reply with
the PR link and the before/after test results."""


async def open_pr(tenant: str, action: dict) -> dict:
    g = db.brain(tenant)
    ctx = db.rows(g, """
        MATCH (a:Action {id: $aid})-[:FOR]->(i:Incident)
        OPTIONAL MATCH (a)-[:JUSTIFIED_BY]->(f:Finding)
        OPTIONAL MATCH (f)-[:EVIDENCED_BY]->(e:Entity)
        RETURN i.id AS iid, i.title AS title, f.summary AS finding, f.confidence AS confidence,
               collect(e.id) AS evidence""", {"aid": action["id"]})
    c = ctx[0] if ctx else {}
    iid = c.get("iid")
    approver = action.get("decided_by") or "a human"
    target = action.get("target", "")
    task = OPEN_PR_TASK.format(
        iid=iid, title=c.get("title"), approver=approver, summary=action.get("summary"),
        finding=c.get("finding") or "(none)", confidence=c.get("confidence") or 0.0,
        evidence=", ".join(c.get("evidence") or []), reviewers=", ".join(action.get("reviewers") or []) or "owners",
        reverts=f', reverts_pr="{target}"' if target.startswith("PR-") else "",
    )
    BB.log_event(g, tenant, iid, "lore", "agent_start", "lore started working on the fix in a sandbox")
    result = await ask(tenant, approver if approver != "a human" else "system", task,
                       session_id=f"incident:{iid}", surface="incident", mirror_topic=BB.topic(tenant, iid),
                       max_steps=40)
    BB.add_tool_calls(g, iid, result["tool_calls"])
    return {"answer_id": result["id"], "pull_requests": result["pull_requests"], "summary": result["answer"][:1200]}


actions.register("open_pr", open_pr)
