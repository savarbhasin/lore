"""Graph write tools for the agent: changes it makes in the real world are recorded in the brain, so the graph
stays current (the next question about pool.py will find the PR Lore opened)."""

import re

from falkordb import Graph

from lore import blackboard as BB
from lore.db import now_ms, rows, write


def record_pull_request(g: Graph, url: str, title: str, summary: str, files: list[str] | None = None,
                        fixes_incident: str | None = None, reverts_pr: str | None = None,
                        *, tenant: str, agent: str) -> dict:
    """Record a pull request you opened on GitHub in the company graph. files = repo-relative paths changed;
    fixes_incident = incident id it fixes; reverts_pr = graph id of the PR it reverts/corrects (e.g. PR-482)."""
    m = re.search(r"/pull/(\d+)", url)
    if not m:
        return {"error": "url must be a GitHub pull request URL (…/pull/<number>)"}
    number = int(m.group(1))
    pid = f"GH-PR-{number}"
    write(
        g,
        """
        MERGE (p:Entity:PR {id: $id})
        SET p.name = 'PR #' + toString($n) + ' (opened by Lore)', p.number = $n, p.title = $title, p.text = $summary,
            p.url = $url, p.state = 'open', p.ts = $ts, p.opened_by = $agent
        WITH p
        OPTIONAL MATCH (f:File) WHERE f.path IN $files
        FOREACH (_ IN CASE WHEN f IS NULL THEN [] ELSE [1] END | MERGE (p)-[:TOUCHES]->(f))
        WITH DISTINCT p
        OPTIONAL MATCH (p)-[:TOUCHES]->(:File)-[:PART_OF]->(s:Service)
        FOREACH (_ IN CASE WHEN s IS NULL THEN [] ELSE [1] END | MERGE (p)-[:MODIFIES]->(s))
        WITH DISTINCT p
        OPTIONAL MATCH (i:Incident {id: $inc})
        FOREACH (_ IN CASE WHEN i IS NULL THEN [] ELSE [1] END | MERGE (p)-[:FIXES]->(i))
        WITH DISTINCT p
        OPTIONAL MATCH (old:PR {id: $old})
        FOREACH (_ IN CASE WHEN old IS NULL THEN [] ELSE [1] END | MERGE (p)-[:REVERTS]->(old))
        """,
        {"id": pid, "n": number, "title": title, "summary": summary, "url": url, "ts": now_ms(), "agent": agent,
         "files": [f.removeprefix("file:") for f in files or []], "inc": fixes_incident or "", "old": reverts_pr or ""},
    )
    if fixes_incident and rows(g, "MATCH (i:Incident {id: $i}) RETURN i.id", {"i": fixes_incident}):
        BB.log_event(g, tenant, fixes_incident, agent, "pr_opened", f"opened {url}: {title}", {"url": url, "pr_id": pid})
    return {"pr_id": pid, "url": url}
