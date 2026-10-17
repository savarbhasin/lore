"""The incident blackboard: shared state that agents coordinate through, stored in the tenant's brain graph.

    (:Incident:Entity)<-[:FOR]-(:Hypothesis)<-[:SUPPORTS]-(:Finding)-[:EVIDENCED_BY]->(:Entity)
    (:Incident)<-[:FOR]-(:Action)-[:JUSTIFIED_BY]->(:Finding)
    (:Incident)<-[:IN]-(:Event)                       ordered timeline (seq is incremented atomically)
    (:Procedure:Entity)-[:LEARNED_FROM]->(:Incident)  procedural memory, shared across the org

Each write is a single Cypher query, so it is atomic, and FalkorDB serializes writes per graph: two
investigators racing to claim the same hypothesis cannot both win.
"""

import json
import uuid

from falkordb import Graph

from lore.db import now_ms, rows, to_py, write
from lore.embeddings import embed_query
from lore.events import bus

VERDICTS = {"confirmed", "rejected", "inconclusive"}
ACTION_KINDS = {"page", "open_pr", "post_message"}


def _uid(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:6]}"


def topic(tenant: str, incident_id: str) -> str:
    return f"incident:{tenant}:{incident_id}"


def log_event(g: Graph, tenant: str, incident_id: str, agent: str, kind: str, text: str, data: dict | None = None) -> dict:
    r = write(
        g,
        """
        MATCH (i:Incident {id: $iid})
        SET i.seq = coalesce(i.seq, 0) + 1
        CREATE (e:Event {seq: i.seq, ts: $ts, agent: $agent, kind: $kind, text: $text, data: $data})-[:IN]->(i)
        RETURN e.seq AS seq
        """,
        {"iid": incident_id, "ts": now_ms(), "agent": agent, "kind": kind, "text": text,
         "data": json.dumps(data or {}, default=str)},
    )
    event = {"type": "event", "seq": r[0]["seq"] if r else None, "agent": agent, "kind": kind, "text": text,
             "data": data or {}, "ts": now_ms()}
    bus.publish(topic(tenant, incident_id), event)
    return event


def open_incident(g: Graph, tenant: str, service_id: str, title: str, text: str, severity: str = "SEV2",
                  alert: dict | None = None) -> str:
    last = rows(g, "MATCH (i:Incident) RETURN max(toInteger(substring(i.id, 4))) AS n")
    iid = f"INC-{(last[0]['n'] or 300) + 1 if last else 301}"
    write(
        g,
        """
        MATCH (s:Service {id: $sid})
        CREATE (i:Entity:Incident {id: $iid, name: $iid, title: $title, text: $text, severity: $sev,
                                   status: 'investigating', ts: $ts, seq: 0, tool_calls: 0,
                                   url: 'https://incidents.northwind.dev/' + $iid})-[:AFFECTS]->(s)
        CREATE (a:Alert {id: $aid, title: $title, text: $text, ts: $ts})-[:PART_OF]->(i)
        SET a += $alert
        """,
        {"sid": service_id, "iid": iid, "aid": _uid("ALERT"), "title": title, "text": text, "sev": severity,
         "ts": now_ms(), "alert": alert or {"source": "manual"}},
    )
    source = (alert or {}).get("source", "manual")
    log_event(g, tenant, iid, source if source != "manual" else "system", "opened", f"{iid} opened: {title}",
              {"service": service_id, "source": source, "url": (alert or {}).get("url")})
    return iid


def add_tool_calls(g: Graph, incident_id: str, n: int) -> None:
    write(g, "MATCH (i:Incident {id: $iid}) SET i.tool_calls = coalesce(i.tool_calls, 0) + $n",
          {"iid": incident_id, "n": n})


def set_status(g: Graph, tenant: str, incident_id: str, status: str, agent: str = "system") -> None:
    write(g, "MATCH (i:Incident {id: $iid}) SET i.status = $s" + (", i.resolved_at = $ts" if status == "resolved" else ""),
          {"iid": incident_id, "s": status, "ts": now_ms()})
    log_event(g, tenant, incident_id, agent, "status", f"status → {status}")


# ---- agent-facing blackboard tools ------------------------------------------------------------
# `tenant` and `agent` are injected by the runtime; the model never chooses them.

def add_hypothesis(g: Graph, incident_id: str, statement: str, rationale: str, *, tenant: str, agent: str) -> dict:
    """Add a testable hypothesis about the incident's cause to the shared board."""
    hid = _uid("H")
    write(
        g,
        """
        MATCH (i:Incident {id: $iid})
        CREATE (h:Hypothesis {id: $hid, statement: $st, rationale: $ra, status: 'open', ts: $ts, by: $agent})-[:FOR]->(i)
        """,
        {"iid": incident_id, "hid": hid, "st": statement, "ra": rationale, "ts": now_ms(), "agent": agent},
    )
    log_event(g, tenant, incident_id, agent, "hypothesis", statement, {"hypothesis_id": hid, "rationale": rationale})
    return {"hypothesis_id": hid}


def claim_hypothesis(g: Graph, incident_id: str, *, tenant: str, agent: str) -> dict | None:
    """Atomically claim the oldest open hypothesis. Returns None when nothing is left to claim."""
    r = write(
        g,
        """
        MATCH (h:Hypothesis {status: 'open'})-[:FOR]->(:Incident {id: $iid})
        WITH h ORDER BY h.ts LIMIT 1
        SET h.status = 'claimed', h.claimed_by = $agent
        RETURN h.id AS id, h.statement AS statement, h.rationale AS rationale
        """,
        {"iid": incident_id, "agent": agent},
    )
    if not r:
        return None
    log_event(g, tenant, incident_id, agent, "claim", f"claimed: {r[0]['statement']}", {"hypothesis_id": r[0]["id"]})
    return r[0]


def post_finding(g: Graph, incident_id: str, hypothesis_id: str, verdict: str, confidence: float, summary: str,
                 evidence_ids: list[str], *, tenant: str, agent: str) -> dict:
    """Record the result of testing a hypothesis: verdict (confirmed/rejected/inconclusive), confidence 0-1,
    a short summary and the entity ids that support it."""
    if verdict not in VERDICTS:
        return {"error": f"verdict must be one of {sorted(VERDICTS)}"}
    fid = _uid("F")
    write(
        g,
        """
        MATCH (h:Hypothesis {id: $hid})-[:FOR]->(i:Incident {id: $iid})
        SET h.status = $verdict
        CREATE (f:Finding {id: $fid, verdict: $verdict, confidence: $conf, summary: $summary, ts: $ts, by: $agent})
        CREATE (f)-[:SUPPORTS]->(h), (f)-[:FOR]->(i)
        WITH f
        UNWIND $ev AS eid
        MATCH (e:Entity {id: eid})
        CREATE (f)-[:EVIDENCED_BY]->(e)
        """,
        {"hid": hypothesis_id, "iid": incident_id, "fid": fid, "verdict": verdict, "conf": float(confidence),
         "summary": summary, "ts": now_ms(), "agent": agent, "ev": evidence_ids or []},
    )
    # UNWIND over an empty list produces no rows, so the finding still exists; confirm it was created.
    if not rows(g, "MATCH (f:Finding {id: $fid}) RETURN f.id AS id", {"fid": fid}):
        return {"error": f"unknown hypothesis {hypothesis_id} for {incident_id}"}
    log_event(g, tenant, incident_id, agent, "finding", f"[{verdict}, {confidence:.0%}] {summary}",
              {"finding_id": fid, "hypothesis_id": hypothesis_id, "verdict": verdict, "evidence": evidence_ids})
    return {"finding_id": fid}


def _required_approvers(g: Graph, incident_id: str, finding_id: str | None) -> list[str]:
    """Who may approve an action, decided by the graph: current members of the team that owns the service the
    evidence points at (falling back to the incident's services), plus the people who made or approved any
    decision governing that evidence."""
    p = {"iid": incident_id, "fid": finding_id or ""}
    svcs = [r["id"] for r in rows(g, """
        MATCH (:Finding {id: $fid})-[:EVIDENCED_BY]->(e:Entity)
        OPTIONAL MATCH (e)-[:MODIFIES|PART_OF|OF]->(s:Service)
        WITH CASE WHEN 'Service' IN labels(e) THEN e ELSE s END AS svc
        WHERE svc IS NOT NULL
        RETURN DISTINCT svc.id AS id
        """, p)]
    if not svcs:
        svcs = [r["id"] for r in rows(g, "MATCH (:Incident {id: $iid})-[:AFFECTS]->(s:Service) RETURN s.id AS id", p)]
    members = rows(g, """
        MATCH (s:Service)<-[o:OWNS]-(:Team)<-[m:MEMBER_OF]-(p:Person)
        WHERE s.id IN $svcs AND o.valid_to IS NULL AND m.valid_to IS NULL
        RETURN DISTINCT p.id AS id
        """, {"svcs": svcs})
    owners = rows(g, """
        MATCH (:Finding {id: $fid})-[:EVIDENCED_BY]->(e:Entity)
        MATCH (e)-[:TOUCHES*0..1]->(x:Entity)<-[:GOVERNS*0..1]-(d:Decision)<-[:DECIDED|APPROVED]-(p:Person)
        RETURN DISTINCT p.id AS id
        """, p)
    return sorted({r["id"] for r in members + owners})


def propose_action(g: Graph, incident_id: str, kind: str, target: str, summary: str, finding_id: str,
                   reviewers: list[str] | None = None, *, tenant: str, agent: str) -> dict:
    """Propose an action for human approval. kind: 'page' (target = person id), 'open_pr' (target = PR id to
    revert or file to fix; reviewers = person ids), 'post_message' (target = Slack channel). The required
    approvers are computed from the graph, not chosen by the agent."""
    if kind not in ACTION_KINDS:
        return {"error": f"kind must be one of {sorted(ACTION_KINDS)}"}
    approvers = _required_approvers(g, incident_id, finding_id)
    aid = _uid("A")
    write(
        g,
        """
        MATCH (i:Incident {id: $iid})
        CREATE (a:Action {id: $aid, kind: $kind, target: $target, summary: $summary, reviewers: $reviewers,
                          approvers: $approvers, status: 'proposed', ts: $ts, by: $agent})-[:FOR]->(i)
        WITH a
        OPTIONAL MATCH (f:Finding {id: $fid})
        FOREACH (_ IN CASE WHEN f IS NULL THEN [] ELSE [1] END | CREATE (a)-[:JUSTIFIED_BY]->(f))
        """,
        {"iid": incident_id, "aid": aid, "kind": kind, "target": target, "summary": summary,
         "reviewers": reviewers or [], "approvers": approvers, "ts": now_ms(), "agent": agent, "fid": finding_id or ""},
    )
    log_event(g, tenant, incident_id, agent, "action_proposed", f"{kind} → {target}: {summary}",
              {"action_id": aid, "kind": kind, "target": target, "reviewers": reviewers or [], "approvers": approvers})
    return {"action_id": aid, "approvers": approvers}


def decide_action(g: Graph, tenant: str, action_id: str, person_id: str, approve: bool) -> dict:
    """A human approves/rejects. Allowed only if the graph lists them as an approver."""
    r = rows(g, "MATCH (a:Action {id: $aid})-[:FOR]->(i:Incident) RETURN a, i.id AS iid", {"aid": action_id})
    if not r:
        return {"ok": False, "error": "unknown action"}
    a, iid = to_py(r[0]["a"]), r[0]["iid"]
    if a["status"] != "proposed":
        return {"ok": False, "error": f"action already {a['status']}"}
    if person_id not in (a.get("approvers") or []):
        return {"ok": False, "error": f"{person_id} is not an approver for this action",
                "approvers": a.get("approvers")}
    status = "approved" if approve else "rejected"
    write(
        g,
        """
        MATCH (a:Action {id: $aid}), (p:Person {id: $pid})
        SET a.status = $status, a.decided_by = $pid, a.decided_at = $ts
        CREATE (p)-[:DECIDED_ACTION {approve: $approve, ts: $ts}]->(a)
        """,
        {"aid": action_id, "pid": person_id, "status": status, "ts": now_ms(), "approve": approve},
    )
    log_event(g, tenant, iid, person_id, f"action_{status}", f"{person_id} {status} {a['kind']} → {a['target']}",
              {"action_id": action_id})
    return {"ok": True, "status": status, "action": a, "incident_id": iid}


def mark_executing(g: Graph, tenant: str, action_id: str) -> None:
    r = write(g, "MATCH (a:Action {id: $aid})-[:FOR]->(i:Incident) SET a.status = 'executing' "
                 "RETURN i.id AS iid, a.kind AS kind, a.target AS target", {"aid": action_id})
    if r:
        log_event(g, tenant, r[0]["iid"], "system", "action_executing", f"executing {r[0]['kind']} → {r[0]['target']}",
                  {"action_id": action_id})


def mark_executed(g: Graph, tenant: str, action_id: str, result: dict) -> None:
    r = write(g, "MATCH (a:Action {id: $aid})-[:FOR]->(i:Incident) SET a.status = 'executed', a.result = $res "
                 "RETURN i.id AS iid, a.kind AS kind, a.target AS target",
              {"aid": action_id, "res": json.dumps(result, default=str)})
    if r:
        log_event(g, tenant, r[0]["iid"], "system", "action_executed", f"executed {r[0]['kind']} → {r[0]['target']}",
                  {"action_id": action_id, "result": result})


def get_incident(g: Graph, incident_id: str) -> dict:
    """Current board state: incident, hypotheses, findings, proposed actions."""
    inc = rows(g, "MATCH (i:Incident {id: $iid}) OPTIONAL MATCH (i)-[:AFFECTS]->(s:Service) "
                  "RETURN i, collect(s.id) AS services", {"iid": incident_id})
    if not inc:
        return {"error": f"unknown incident {incident_id}"}
    hyps = rows(g, "MATCH (h:Hypothesis)-[:FOR]->(:Incident {id: $iid}) RETURN h ORDER BY h.ts", {"iid": incident_id})
    finds = rows(g, "MATCH (f:Finding)-[:FOR]->(:Incident {id: $iid}) OPTIONAL MATCH (f)-[:EVIDENCED_BY]->(e) "
                    "OPTIONAL MATCH (f)-[:SUPPORTS]->(h:Hypothesis) "
                    "RETURN f, h.id AS hypothesis_id, collect(e.id) AS evidence ORDER BY f.ts", {"iid": incident_id})
    acts = rows(g, "MATCH (a:Action)-[:FOR]->(:Incident {id: $iid}) RETURN a ORDER BY a.ts", {"iid": incident_id})
    return {
        "incident": {**to_py(inc[0]["i"]), "services": inc[0]["services"]},
        "hypotheses": [to_py(h["h"]) for h in hyps],
        "findings": [{**to_py(f["f"]), "hypothesis_id": f["hypothesis_id"], "evidence": f["evidence"]} for f in finds],
        "actions": [to_py(a["a"]) for a in acts],
    }


def events(g: Graph, incident_id: str) -> list[dict]:
    r = rows(g, "MATCH (e:Event)-[:IN]->(:Incident {id: $iid}) RETURN e ORDER BY e.seq", {"iid": incident_id})
    out = []
    for x in r:
        e = to_py(x["e"])
        e["data"] = json.loads(e.get("data") or "{}")
        out.append({"type": "event", **{k: v for k, v in e.items() if not k.startswith("_")}})
    return out


# ---- procedural memory -------------------------------------------------------------------------

def record_procedure(g: Graph, incident_id: str, title: str, symptoms: str, root_cause_pattern: str,
                     steps: list[str], fix_recipe: str, *, tenant: str, agent: str) -> dict:
    """Save a reusable playbook learned from a resolved incident, linked to the services it applies to."""
    n = rows(g, "MATCH (p:Procedure) RETURN count(p) AS n")[0]["n"]
    pid = f"P-{n + 1}"
    write(
        g,
        """
        MATCH (i:Incident {id: $iid})
        CREATE (p:Entity:Procedure {id: $pid, name: $pid, title: $title, text: $symptoms, root_cause: $rc,
                                    steps: $steps, fix_recipe: $fix, uses: 0, ts: $ts, by: $agent})
        CREATE (p)-[:LEARNED_FROM]->(i)
        WITH p, i
        MATCH (i)-[:AFFECTS]->(s:Service)
        CREATE (p)-[:APPLIES_TO]->(s)
        """,
        {"iid": incident_id, "pid": pid, "title": title, "symptoms": symptoms, "rc": root_cause_pattern,
         "steps": steps, "fix": fix_recipe, "ts": now_ms(), "agent": agent},
    )
    log_event(g, tenant, incident_id, agent, "procedure", f"learned {pid}: {title}", {"procedure_id": pid})
    return {"procedure_id": pid}


PROCEDURE_MATCH = 0.78  # cosine similarity; same failure mode ≈ 0.8+, unrelated ≤ 0.72 (measured)


async def match_procedures(g: Graph, service_id: str, symptoms: str, limit: int = 3) -> list[dict]:
    """Procedures learned from past incidents on this service (or the services it depends on), ranked by
    embedding similarity between their symptoms and these symptoms."""
    vector = await embed_query(symptoms)
    r = rows(
        g,
        """
        MATCH (s:Service {id: $sid})-[:DEPENDS_ON*0..2]->(x:Service)<-[:APPLIES_TO]-(p:Procedure)
        WITH DISTINCT p
        RETURN p.id AS id, p.title AS title, p.text AS symptoms, p.root_cause AS root_cause, p.steps AS steps,
               p.fix_recipe AS fix_recipe, p.uses AS uses,
               CASE WHEN $v IS NULL OR p.embedding IS NULL THEN 0.0
                    ELSE 1 - vec.cosineDistance(p.embedding, vecf32($v)) END AS similarity
        ORDER BY similarity DESC LIMIT $limit
        """,
        {"sid": service_id, "limit": limit, "v": vector},
    )
    for p in r:
        p["similarity"] = round(p["similarity"], 3)
    return r


def use_procedure(g: Graph, procedure_id: str) -> None:
    write(g, "MATCH (p:Procedure {id: $id}) SET p.uses = coalesce(p.uses, 0) + 1", {"id": procedure_id})
