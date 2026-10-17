"""Live chat ingest (Slack today, Discord next): store the message in its thread, link what it mentions, and turn
explicit statements into graph changes with history."""

from dataclasses import dataclass

from lore import db
from lore.embeddings import embed_missing
from lore.events import bus
from lore.ingest import apply as A
from lore.ingest import extract as X
from lore.ingest import mentions as M


@dataclass
class ChatMessage:
    source: str           # "slack" | "discord" | "api"
    channel_id: str
    channel_name: str
    thread_id: str        # platform id of the thread root (== message id for top-level messages)
    message_id: str
    text: str
    ts: int               # epoch ms
    url: str | None = None
    author_id: str | None = None   # graph Person id, if known
    author_name: str = "someone"


def node_id(msg: ChatMessage, kind: str, platform_id: str) -> str:
    return f"{msg.source[:2].upper()}{kind}-{msg.channel_id}-{platform_id}"


def knowledge_topic(tenant: str) -> str:
    return f"knowledge:{tenant}"


def store(g, msg: ChatMessage, mentioned: list[dict]) -> dict:
    thread_id, message_id = node_id(msg, "T", msg.thread_id), node_id(msg, "M", msg.message_id)
    channel = f"#{msg.channel_name.lstrip('#')}"
    db.write(g, """
        MERGE (t:Entity:Thread {id: $tid})
        ON CREATE SET t.name = $channel + ': ' + $title, t.channel = $channel, t.title = $title, t.ts = $ts,
                      t.url = $url, t.source = $source
        MERGE (m:Entity:Message {id: $mid})
        SET m.name = $author + ' in ' + $channel, m.text = $text, m.ts = $ts, m.url = $url, m.source = $source,
            m.author_name = $author
        MERGE (m)-[:IN_THREAD]->(t)
        WITH m
        OPTIONAL MATCH (p:Person {id: $pid})
        FOREACH (_ IN CASE WHEN p IS NULL THEN [] ELSE [1] END | MERGE (p)-[:AUTHORED {ts: $ts}]->(m))
        WITH DISTINCT m
        UNWIND (CASE WHEN size($mentions) = 0 THEN [null] ELSE $mentions END) AS eid
        OPTIONAL MATCH (e:Entity {id: eid})
        FOREACH (_ IN CASE WHEN e IS NULL OR e = m THEN [] ELSE [1] END | MERGE (m)-[:MENTIONS]->(e))
        """,
             {"tid": thread_id, "mid": message_id, "channel": channel, "title": msg.text[:60], "ts": msg.ts,
              "url": msg.url, "source": msg.source, "author": msg.author_name, "text": msg.text,
              "pid": msg.author_id or "", "mentions": [m["id"] for m in mentioned]})
    return {"id": message_id, "thread_id": thread_id, "ts": msg.ts, "url": msg.url, "author": msg.author_id}


async def ingest(tenant: str, msg: ChatMessage) -> dict:
    g = db.brain(tenant)
    mentioned = M.link(g, msg.text)
    source = store(g, msg, mentioned)
    facts = await X.extract(g, tenant.capitalize(), msg.author_id or msg.author_name, msg.text, mentioned)
    changes = A.apply(g, facts, source)
    await embed_missing(g)
    result = {"message_id": source["id"], "mentions": [m["id"] for m in mentioned], "facts": facts,
              "changes": changes}
    bus.publish(knowledge_topic(tenant), {"type": "knowledge", "source": msg.source, "channel": msg.channel_name,
                                          "author": msg.author_id or msg.author_name, **result})
    return result
