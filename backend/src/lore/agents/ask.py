"""Ask Lore: one question from any surface (web, Slack, Discord) -> a sourced answer with its evidence subgraph."""

import json
import re
import uuid
from datetime import datetime, timezone

from lore import db, memory
from lore import sandbox as SB
from lore.agents.runtime import run_agent
from lore.agents.voice import VOICE_RULES
from lore.db import now_ms, rows, write
from lore.embeddings import embed_missing
from lore.events import bus
from lore.mcp_server import create_server

BRACKET = re.compile(r"\[([^\[\]\n]{1,160})\]")
ID = re.compile(r"^[A-Za-z][\w:./-]*$")
PR_URL = re.compile(r"https://github\.com/[\w.-]+/[\w.-]+/pull/\d+")


def cited_ids(text: str) -> list[str]:
    """Ids cited as [X] or [X, Y]; ignores bracketed prose and markdown links."""
    out = []
    for m in BRACKET.finditer(text):
        if text[m.end():m.end() + 1] == "(":  # markdown link [label](url)
            continue
        for part in m.group(1).split(","):
            part = part.strip()
            if ID.match(part):
                out.append(part)
    return list(dict.fromkeys(out))

SYSTEM = """You are Lore, the company brain for {org}, and an engineer who can act. You answer questions about the
engineering org — who owns and knows what, why things are the way they are, what changed, what depends on what —
using the graph tools, and you can do real work in your own Linux sandbox: clone the code, read it, run it, test
it, fix it, push branches and open pull requests.

Code repositories (from the graph): {repos}

How to work:
- Graph first: find where to look, why it is that way (decisions, incidents) and who owns/knows it. Then use the
  sandbox to check the code itself whenever the question is about behaviour, or when you are asked to change it.
- For changes: clone into /home/user, branch from main, reproduce the problem with a test first, make the minimal
  fix the decisions call for, re-run the tests, then commit, push and open a PR (GitHub REST API via curl with
  $GH_TOKEN, or install gh). Put the evidence in the PR body: root cause, governing decision, before/after test
  results, and who should review. Then call record_pull_request so the graph knows about it.
- Never push to main and never merge. Don't print secrets.

Rules for your final answer:
- Use tools before answering. Never invent ids, people or facts. If the graph has nothing, say so.
- Facts you verified yourself in the sandbox (files you read, command output) don't need graph citations; say
  where they came from ("the README says...", "the tests show...") and cite graph ids for anything else.
- Cite every factual claim with entity ids in square brackets exactly as the tools return them, one id per
  bracket, e.g. [PR-482] [ADR-012] [D-17] [priya]. Only cite ids you saw in tool results; never cite tool names.
- Answer first in 1-2 sentences, then up to 5 short evidence bullets (include links to any PR you opened).
  No preamble.
- When someone may need a human, name the best *available* person (skip anyone out of office).
- Use `remember` only for durable facts about the user (their team, role, preferences). Use `recall` when the
  user refers to earlier conversations.
Current time: {now}.{facts}"""


def _topic(answer_id: str) -> str:
    return f"ask:{answer_id}"


def new_answer_id() -> str:
    return f"ANS-{uuid.uuid4().hex[:10]}"


async def ask(tenant: str, user: str, question: str, *, session_id: str | None = None, surface: str = "web",
              answer_id: str | None = None, mirror_topic: str | None = None, max_steps: int = 30,
              voice: bool = False) -> dict:
    """Run the Lore agent on a question or task. Events stream to ask:{answer_id} (and mirror_topic, e.g. an
    incident room). The sandbox is keyed by session, so follow-ups reuse the same machine."""
    answer_id = answer_id or new_answer_id()
    session_id = session_id or f"{surface}:{answer_id}"
    topic = _topic(answer_id)

    worked = {"sandbox": False}

    def publish(e: dict) -> None:
        if e.get("type") == "sandbox_cmd":
            worked["sandbox"] = True
        bus.publish(topic, e)
        if mirror_topic:
            bus.publish(mirror_topic, {**e, "agent": e.get("agent", "lore")})
    mem = memory.graph(tenant, user)
    known = memory.facts(mem)
    facts = ("\nWhat you know about this user:\n- " + "\n- ".join(known)) if known else ""
    history = []
    for turn in memory.history(mem, session_id):
        history += [{"role": "user", "content": turn["question"]}, {"role": "assistant", "content": turn["answer"]}]
    org = tenant.capitalize()
    publish({"type": "start", "answer_id": answer_id, "question": question})

    brain = db.brain(tenant)
    repos = ", ".join(f"{r['name']} ({r['url']})" for r in rows(brain, "MATCH (r:Repo) RETURN r.name AS name, r.url AS url")) or "none"
    sandbox = SB.session(f"{tenant}:{session_id}", emit=publish)

    def grounded(text: str) -> str | None:
        """Every cited id must exist in this tenant's graph; otherwise send the model back to the tools."""
        cited = cited_ids(text)
        if not cited:
            if worked["sandbox"]:
                return None  # grounded in what it read and ran in the sandbox
            return "Your answer has no citations. Use the tools and cite entity ids in [brackets]."
        found = {r["id"] for r in rows(brain, "MATCH (e:Entity) WHERE e.id IN $ids RETURN e.id AS id", {"ids": cited})}
        missing = [c for c in cited if c not in found]
        if missing:
            return (f"These cited ids do not exist in the graph: {', '.join(missing)}. Do not guess — use tools to "
                    "verify every claim, then rewrite the answer citing only ids the tools returned.")
        return None

    try:
        result = await run_agent(
            create_server(tenant, user=user, sandbox=sandbox),
            agent="lore",
            system=SYSTEM.format(org=org, now=datetime.now(timezone.utc).isoformat(timespec="minutes"), facts=facts,
                                 repos=repos) + (VOICE_RULES if voice else ""),
            task=question,
            history=history,
            max_steps=max_steps,
            require_tool=True,
            validate=grounded,
            emit=publish,
        )
    except Exception as e:
        publish({"type": "error", "error": str(e)})
        raise

    cited = cited_ids(result.text)
    known = {r["id"]: r for r in rows(brain, "MATCH (e:Entity) WHERE e.id IN $ids RETURN e.id AS id, "
                                              "coalesce(e.title, e.name) AS title, e.url AS url, "
                                              "[l IN labels(e) WHERE l <> 'Entity'][0] AS kind", {"ids": cited})}
    citations = [result.sources.get(c) or known[c] for c in cited if c in result.sources or c in known]
    evidence = result.evidence()
    record = {
        "id": answer_id, "question": question, "answer": result.text, "citations": citations,
        "evidence": evidence, "trace": result.trace, "tool_calls": result.tool_calls, "user": user,
        "surface": surface, "session_id": session_id, "ts": now_ms(),
    }
    write(
        db.brain(tenant),
        """
        CREATE (a:Answer {id: $id, question: $q, answer: $a, user: $user, surface: $surface, ts: $ts,
                          tool_calls: $tc, payload: $payload})
        WITH a
        UNWIND $cited AS cid
        MATCH (e:Entity {id: cid})
        CREATE (a)-[:ABOUT]->(e)
        """,
        {"id": answer_id, "q": question, "a": result.text, "user": user, "surface": surface, "ts": record["ts"],
         "tc": result.tool_calls, "payload": json.dumps(record, default=str), "cited": cited},
    )
    memory.save_episode(mem, session_id, surface, question, result.text, answer_id, cited)
    await embed_missing(brain)  # e.g. a PR the agent just recorded
    record["pull_requests"] = sorted(set(PR_URL.findall(result.text)))
    done = {"type": "done", **{k: record[k] for k in ("id", "answer", "citations", "evidence", "tool_calls", "pull_requests")}}
    bus.publish(topic, done)
    if mirror_topic:  # don't end the incident stream; tell it the task finished
        bus.publish(mirror_topic, {**done, "type": "agent_done", "agent": "lore", "text": result.text})
    return record


def get_answer(tenant: str, answer_id: str) -> dict | None:
    r = rows(db.brain(tenant), "MATCH (a:Answer {id: $id}) RETURN a.payload AS p", {"id": answer_id})
    return json.loads(r[0]["p"]) if r else None
