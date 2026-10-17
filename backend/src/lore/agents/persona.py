"""Talk to a person, not to Lore: an agent that answers in character as a specific employee, grounded in that
person's footprint in the brain graph (PRs, reviews, decisions, docs, Slack messages, incidents) and their own
memory graph (mem:{tenant}:{person}). The NPC also remembers past conversations with each asker."""

import json
import time
from datetime import datetime, timezone

from lore import db, memory
from lore.agents.ask import cited_ids, new_answer_id
from lore.agents.runtime import run_agent
from lore.agents.voice import VOICE_RULES
from lore.db import now_ms, rows, write
from lore.events import bus
from lore.mcp_server import GRAPH_TOOLS, create_server


def ago(ms: int | None) -> str:
    if not ms:
        return "some time ago"
    days = (time.time() * 1000 - ms) / 86_400_000
    if days < 0:
        return f"in {round(-days)} days"
    if days < 1:
        return "today"
    if days < 2:
        return "yesterday"
    if days < 45:
        return f"{round(days)} days ago"
    return f"{round(days / 30)} months ago"


def profile(tenant: str, person_id: str) -> dict | None:
    g = db.brain(tenant)
    me = rows(g, """
        MATCH (p:Person {id: $id})
        OPTIONAL MATCH (p)-[m:MEMBER_OF]->(t:Team) WHERE m.valid_to IS NULL
        RETURN p.id AS id, p.name AS name, p.title AS title, p.handle AS handle, p.joined AS joined,
               p.ooo_from AS ooo_from, p.ooo_to AS ooo_to, t.name AS team""", {"id": person_id})
    if not me:
        return None
    p = me[0]
    q = {"id": person_id}
    now = now_ms()
    out = {
        **p,
        "out_of_office": bool(p["ooo_from"] and p["ooo_to"] and p["ooo_from"] <= now <= p["ooo_to"]),
        "authored": rows(g, """MATCH (:Person {id: $id})-[:AUTHORED]->(x:PR)
            RETURN x.id AS id, x.title AS title, x.state AS state, x.ts AS ts ORDER BY x.ts DESC LIMIT 8""", q),
        "reviewed": rows(g, """MATCH (:Person {id: $id})-[:REVIEWED]->(x:PR)
            RETURN x.id AS id, x.title AS title, x.ts AS ts ORDER BY x.ts DESC LIMIT 6""", q),
        "decisions": rows(g, """MATCH (:Person {id: $id})-[r:DECIDED|APPROVED]->(d:Decision)
            RETURN d.id AS id, d.title AS title, type(r) AS role, d.status AS status""", q),
        "docs": rows(g, """MATCH (:Person {id: $id})-[:AUTHORED]->(d:Doc)
            RETURN d.id AS id, d.title AS title, d.ts AS ts ORDER BY d.ts DESC LIMIT 5""", q),
        "messages": rows(g, """MATCH (:Person {id: $id})-[:AUTHORED]->(m:Message)
            OPTIONAL MATCH (m)-[:IN_THREAD]->(th:Thread)
            RETURN m.id AS id, m.text AS text, m.ts AS ts, th.channel AS channel ORDER BY m.ts DESC LIMIT 6""", q),
        "incidents": rows(g, """MATCH (:Person {id: $id})-[r]->(i:Incident)
            RETURN i.id AS id, i.title AS title, type(r) AS role, i.status AS status, i.ts AS ts
            ORDER BY i.ts DESC LIMIT 5""", q),
        "services": rows(g, """MATCH (t:Team {name: $team})-[o:OWNS]->(s:Service) WHERE o.valid_to IS NULL
            RETURN s.id AS id, s.tier AS tier ORDER BY s.tier""", {"team": p["team"]}) if p["team"] else [],
    }
    mem = memory.graph(tenant, person_id)
    out["notes"] = memory.facts(mem, limit=8)
    out["recent_questions"] = [r["question"] for r in rows(
        mem, "MATCH (e:Episode) RETURN e.question AS question ORDER BY e.ts DESC LIMIT 5")]
    return out


def dossier(p: dict) -> str:
    def lines(items, fmt):
        return "\n".join(f"  - {fmt(x)}" for x in items) or "  - (nothing on record)"

    status = (f"You are out of office until {datetime.fromtimestamp(p['ooo_to'] / 1000, timezone.utc):%A %B %d}."
              if p["out_of_office"] else "You are in the office today.")
    return f"""Your record in the company graph (cite these ids):
- PRs you authored:
{lines(p['authored'], lambda x: f"[{x['id']}] {x['title']} ({x['state']}, {ago(x['ts'])})")}
- PRs you reviewed:
{lines(p['reviewed'], lambda x: f"[{x['id']}] {x['title']} ({ago(x['ts'])})")}
- Decisions:
{lines(p['decisions'], lambda x: f"[{x['id']}] {x['title']} (you {x['role'].lower()} it; {x['status']})")}
- Docs you wrote:
{lines(p['docs'], lambda x: f"[{x['id']}] {x['title']}")}
- Things you said recently in Slack:
{lines(p['messages'], lambda x: f"[{x['id']}] in #{x['channel'] or 'slack'}, {ago(x['ts'])}: \"{(x['text'] or '')[:220]}\"")}
- Incidents you were part of:
{lines(p['incidents'], lambda x: f"[{x['id']}] {x['title']} ({x['role'].lower()}, {x['status']})")}
- Services your team owns: {", ".join(f"[{s['id']}] (tier {s['tier']})" for s in p['services']) or "none"}
- {status}
Your private notes (your own memory): {"; ".join(p['notes']) or "none"}
Things you recently asked Lore about: {"; ".join(p['recent_questions']) or "nothing"}"""


SYSTEM = """You are {name}, {title} on the {team} team at {org}. You are not an AI assistant and not Lore: you are
this person, talking face to face with {asker}, who just walked up to you. Speak in the first person about your own
work, your reasons and your opinions, grounded in your record below. Stay in character, be friendly and direct,
and sound like an engineer, not a press release.

{dossier}

How to answer:
- Answer from your own perspective ("I wrote that because...", "Kabir and I went back and forth on it").
- If you need detail about something you worked on, use the graph tools (get_entity, trace_decision,
  recent_changes...). Use recall to check whether you've talked with {asker} about this before.
- If the question is outside what you know, say so honestly and name who would know (who_knows can tell you).
  Never invent work you didn't do.
- If you're out of office, mention it briefly when it matters ("I'm actually out until Thursday").
- Cite facts with entity ids in [brackets] exactly as they appear in your record or in tool results.
- Keep it to a short conversational reply: a few sentences, no headings.
Current time: {now}."""


async def ask_person(tenant: str, user: str, person: str, question: str, *, answer_id: str | None = None,
                     surface: str = "world", voice: bool = False) -> dict:
    answer_id = answer_id or new_answer_id()
    topic = f"ask:{answer_id}"
    bus.publish(topic, {"type": "start", "answer_id": answer_id, "question": question, "speaker": person})
    p = profile(tenant, person)
    if not p:
        bus.publish(topic, {"type": "error", "error": f"unknown person {person}"})
        return {}
    asker = profile(tenant, user)
    asker_desc = f"{asker['name']} ({asker['title']}, {asker['team']})" if asker else "a colleague"

    mem = memory.graph(tenant, person)
    session_id = f"npc:{user}"
    history = []
    for turn in memory.history(mem, session_id, limit=4):
        history += [{"role": "user", "content": turn["question"]}, {"role": "assistant", "content": turn["answer"]}]

    brain = db.brain(tenant)

    def grounded(text: str) -> str | None:
        cited = cited_ids(text)
        if not cited:
            return None
        found = {r["id"] for r in rows(brain, "MATCH (e:Entity) WHERE e.id IN $ids RETURN e.id AS id", {"ids": cited})}
        missing = [c for c in cited if c not in found]
        if missing:
            return (f"These ids are not in the graph: {', '.join(missing)}. Only cite ids from your record or from "
                    "tool results; rewrite your reply.")
        return None

    system = SYSTEM.format(name=p["name"], title=p["title"], team=p["team"] or "no", org=tenant.capitalize(),
                           asker=asker_desc, dossier=dossier(p),
                           now=datetime.now(timezone.utc).isoformat(timespec="minutes"))
    try:
        result = await run_agent(
            create_server(tenant, user=person),
            agent=person,
            system=system + (VOICE_RULES if voice else ""),
            task=question,
            history=history,
            allowed={fn.__name__ for fn in GRAPH_TOOLS} | {"recall"},
            max_steps=8,
            validate=grounded,
            emit=lambda e: bus.publish(topic, e),
        )
    except Exception as e:
        bus.publish(topic, {"type": "error", "error": str(e)})
        raise

    cited = cited_ids(result.text)
    known = {r["id"]: r for r in rows(brain, "MATCH (e:Entity) WHERE e.id IN $ids RETURN e.id AS id, "
                                              "coalesce(e.title, e.name) AS title, e.url AS url, "
                                              "[l IN labels(e) WHERE l <> 'Entity'][0] AS kind", {"ids": cited})}
    citations = [result.sources.get(c) or known[c] for c in cited if c in result.sources or c in known]
    record = {
        "id": answer_id, "question": question, "answer": result.text, "citations": citations,
        "evidence": result.evidence(), "trace": result.trace, "tool_calls": result.tool_calls, "user": user,
        "speaker": person, "surface": surface, "session_id": session_id, "ts": now_ms(),
    }
    write(brain, """
        CREATE (a:Answer {id: $id, question: $q, answer: $a, user: $user, surface: $surface, ts: $ts,
                          tool_calls: $tc, payload: $payload})""",
          {"id": answer_id, "q": question, "a": result.text, "user": user, "surface": f"{surface}:npc:{person}",
           "ts": record["ts"], "tc": result.tool_calls, "payload": json.dumps(record, default=str)})
    memory.save_episode(mem, session_id, surface, question, result.text, answer_id, cited)
    bus.publish(topic, {"type": "done", "speaker": person,
                        **{k: record[k] for k in ("id", "answer", "citations", "evidence", "tool_calls")}})
    return record
