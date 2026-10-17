"""Lore API: the single backend every surface (web, Slack, Discord) talks to."""

import asyncio
import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from lore import actions, db, stt, tts
from lore import blackboard as BB
from lore.agents import tasks  # noqa: F401  (registers action executors)
from lore.agents.ask import ask, get_answer, new_answer_id
from lore.agents.incident import resolve_incident
from lore.agents.persona import ask_person, profile
from lore.alerts import adapters, intake
from lore.config import settings
from lore.events import bus
from lore.ingest.pipeline import ChatMessage, ingest, knowledge_topic
from lore.slack import bot as slack_bot

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await slack_bot.start()
    spawn(stt.warm())
    yield
    await slack_bot.stop()


app = FastAPI(title="Lore API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

running_tasks: set[asyncio.Task] = set()


def spawn(coro) -> None:
    task = asyncio.create_task(coro)
    running_tasks.add(task)
    task.add_done_callback(running_tasks.discard)


def tenant_graph(tenant: str):
    try:
        db.brain_key(tenant)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return db.brain(tenant)


async def sse(events):
    async for e in events:
        yield f"data: {json.dumps(e, default=str)}\n\n"


# ---- meta ------------------------------------------------------------------------------------

@app.get("/api/health")
def health():
    return {"ok": True, "graphs": db.client().list_graphs(), "slack": slack_bot.client() is not None}


@app.get("/api/tenants")
def tenants():
    return [g.split(":", 1)[1] for g in db.client().list_graphs() if g.startswith("brain:")]


@app.get("/api/people")
def people(tenant: str = "northwind"):
    return db.rows(tenant_graph(tenant), """
        MATCH (p:Person)-[m:MEMBER_OF]->(t:Team) WHERE m.valid_to IS NULL
        RETURN p.id AS id, p.name AS name, p.title AS title, t.name AS team ORDER BY team, name""")


@app.get("/api/services")
def services(tenant: str = "northwind"):
    return db.rows(tenant_graph(tenant), """
        MATCH (s:Service) OPTIONAL MATCH (t:Team)-[o:OWNS]->(s) WHERE o.valid_to IS NULL
        RETURN s.id AS id, s.tier AS tier, t.name AS team ORDER BY tier, id""")


@app.post("/api/seed")
async def seed(tenant: str = "northwind"):
    from lore.seed.tenant import seed as seed_tenant

    tenant_graph(tenant)
    result = await seed_tenant(tenant)
    # Incident ids restart after a reset; stale replay history would end new streams immediately.
    bus.forget(BB.topic(tenant, ""))
    return result


# ---- ask -------------------------------------------------------------------------------------

class AskIn(BaseModel):
    tenant: str = "northwind"
    user: str = "guest"
    question: str
    session_id: str | None = None
    surface: str = "web"
    voice: bool = False  # spoken conversation: short, list-free answers that sound right read aloud


@app.post("/api/ask")
async def post_ask(body: AskIn):
    tenant_graph(body.tenant)
    answer_id = new_answer_id()
    spawn(ask(body.tenant, body.user, body.question, session_id=body.session_id, surface=body.surface,
               answer_id=answer_id, voice=body.voice))
    return {"answer_id": answer_id}


class AskPersonIn(BaseModel):
    tenant: str = "northwind"
    user: str = "guest"
    person: str
    question: str
    surface: str = "world"
    voice: bool = True


@app.post("/api/ask_person")
async def post_ask_person(body: AskPersonIn):
    """Ask a specific employee; they answer in character from their own record and memory graph."""
    tenant_graph(body.tenant)
    if not profile(body.tenant, body.person):
        raise HTTPException(404, f"unknown person {body.person}")
    answer_id = new_answer_id()
    spawn(ask_person(body.tenant, body.user, body.person, body.question, answer_id=answer_id, surface=body.surface,
                     voice=body.voice))
    return {"answer_id": answer_id}


@app.get("/api/people/{person_id}/profile")
def person_profile(person_id: str, tenant: str = "northwind"):
    tenant_graph(tenant)
    p = profile(tenant, person_id)
    if not p:
        raise HTTPException(404, "unknown person")
    return {**p, "voice": tts.voice_for(person_id)}


@app.post("/api/stt")
async def post_stt(audio: UploadFile = File(...), tenant: str = Form("northwind")):
    """Transcribe a short push-to-talk recording with local Whisper."""
    tenant_graph(tenant)
    data = await audio.read()
    if len(data) > 15_000_000:
        raise HTTPException(413, "recording too long")
    try:
        return {"text": await stt.transcribe(data, tenant)}
    except Exception as e:
        raise HTTPException(422, f"could not transcribe: {e}")


class TtsIn(BaseModel):
    text: str
    speaker: str | None = None  # "lore" or a person id; picks the voice


@app.post("/api/tts")
async def post_tts(body: TtsIn):
    text = body.text.strip()[:800]
    if not text:
        raise HTTPException(400, "empty text")
    try:
        return await tts.synthesize(text, tts.voice_for(body.speaker))
    except Exception as e:
        raise HTTPException(502, f"tts failed: {e}")


@app.get("/api/answers/{answer_id}/stream")
async def stream_answer(answer_id: str):
    return StreamingResponse(sse(bus.subscribe(f"ask:{answer_id}")), media_type="text/event-stream")


@app.get("/api/answers/{answer_id}")
def answer(answer_id: str, tenant: str = "northwind"):
    tenant_graph(tenant)
    a = get_answer(tenant, answer_id)
    if not a:
        raise HTTPException(404, "answer not found (yet)")
    return a


# ---- incidents -------------------------------------------------------------------------------

class IncidentIn(BaseModel):
    tenant: str = "northwind"
    service_id: str
    title: str
    text: str = ""
    severity: str = "SEV2"


@app.post("/api/incidents")
async def open_incident(body: IncidentIn):
    g = tenant_graph(body.tenant)
    if not db.rows(g, "MATCH (s:Service {id: $id}) RETURN s.id", {"id": body.service_id}):
        raise HTTPException(404, f"unknown service {body.service_id}")
    iid = await intake.start(body.tenant, body.service_id, body.title, body.text, body.severity,
                             alert={"source": "web"})
    return {"incident_id": iid}


@app.get("/api/incidents")
def list_incidents(tenant: str = "northwind", limit: int = 20):
    return db.rows(tenant_graph(tenant), """
        MATCH (i:Incident) OPTIONAL MATCH (i)-[:AFFECTS]->(s:Service)
        RETURN i.id AS id, i.title AS title, i.severity AS severity, i.status AS status, i.ts AS ts,
               i.tool_calls AS tool_calls, collect(s.id) AS services
        ORDER BY ts DESC LIMIT $n""", {"n": limit})


@app.get("/api/incidents/{incident_id}")
def incident(incident_id: str, tenant: str = "northwind"):
    g = tenant_graph(tenant)
    board = BB.get_incident(g, incident_id)
    if "error" in board:
        raise HTTPException(404, board["error"])
    return {**board, "events": BB.events(g, incident_id)}


@app.get("/api/incidents/{incident_id}/stream")
async def stream_incident(incident_id: str, tenant: str = "northwind"):
    g = tenant_graph(tenant)
    topic = BB.topic(tenant, incident_id)

    async def events():
        if not bus._history.get(topic):  # e.g. after a restart: replay what the graph remembers
            for e in BB.events(g, incident_id):
                yield e
        async for e in bus.subscribe(topic):
            yield e

    return StreamingResponse(sse(events()), media_type="text/event-stream")


class DecisionIn(BaseModel):
    tenant: str = "northwind"
    person_id: str
    approve: bool = True


@app.post("/api/actions/{action_id}/decide")
async def decide(action_id: str, body: DecisionIn):
    r = BB.decide_action(tenant_graph(body.tenant), body.tenant, action_id, body.person_id, body.approve)
    if not r["ok"]:
        raise HTTPException(403, r)
    if r["status"] == "approved":
        spawn(actions.execute(body.tenant, {**r["action"], "decided_by": body.person_id}))
    return r


@app.post("/api/incidents/{incident_id}/resolve")
async def resolve(incident_id: str, tenant: str = "northwind"):
    tenant_graph(tenant)
    spawn(resolve_incident(tenant, incident_id))
    return {"ok": True}


# ---- monitoring webhooks --------------------------------------------------------------------

@app.post("/api/webhooks/{source}")
async def alert_webhook(source: str, request: Request, tenant: str = "northwind", token: str | None = None):
    """Sentry / Grafana / Alertmanager / Datadog / generic JSON -> incident (or dedupe/recovery on an open one)."""
    if settings.webhook_token and token != settings.webhook_token:
        raise HTTPException(401, "bad or missing ?token=")
    tenant_graph(tenant)
    try:
        payload = await request.json()
    except ValueError:
        raise HTTPException(400, "expected a JSON body")
    if source == "sentry" and request.headers.get("sentry-hook-resource") == "installation":
        return {"status": "ok"}  # Sentry internal-integration install ping
    try:
        alert = adapters.parse(source, payload if isinstance(payload, dict) else {},
                               request.headers.get("sentry-hook-resource"))
    except ValueError as e:
        raise HTTPException(400, str(e))
    result = await intake.receive(tenant, alert)
    log.info("webhook %s -> %s", source, result)
    return result


# ---- live knowledge ---------------------------------------------------------------------------

class MessageIn(BaseModel):
    tenant: str = "northwind"
    text: str
    author_id: str | None = None
    channel: str = "general"
    thread_id: str | None = None
    source: str = "api"


@app.post("/api/ingest/message")
async def ingest_message(body: MessageIn):
    tenant_graph(body.tenant)
    ts = db.now_ms()
    msg = ChatMessage(source=body.source, channel_id=body.channel, channel_name=body.channel,
                      thread_id=body.thread_id or str(ts), message_id=str(ts), text=body.text, ts=ts,
                      author_id=body.author_id, author_name=body.author_id or "api")
    return await ingest(body.tenant, msg)


@app.get("/api/knowledge/stream")
async def stream_knowledge(tenant: str = "northwind"):
    return StreamingResponse(sse(bus.subscribe(knowledge_topic(tenant), replay=False)), media_type="text/event-stream")


# ---- graph for the UI ------------------------------------------------------------------------

@app.get("/api/graph/subgraph")
def subgraph(ids: str, tenant: str = "northwind", expand: int = 0):
    """Nodes for the given ids (plus 1-hop neighbours when expand=1) and the relationships among them."""
    g = tenant_graph(tenant)
    id_list = [i for i in ids.split(",") if i][:200]
    if expand:
        id_list = list({*id_list, *[r["id"] for r in db.rows(g, """
            MATCH (n:Entity)-[r]-(m:Entity) WHERE n.id IN $ids AND NOT type(r) IN ['COLLABORATES', 'WORKS_CLOSELY']
            RETURN DISTINCT m.id AS id LIMIT 150""", {"ids": id_list})]})
    nodes = db.rows(g, """
        MATCH (n:Entity) WHERE n.id IN $ids
        RETURN n.id AS id, [l IN labels(n) WHERE l <> 'Entity'][0] AS label,
               coalesce(n.title, n.name, n.id) AS name, n.url AS url""", {"ids": id_list})
    edges = db.rows(g, """
        MATCH (a:Entity)-[r]->(b:Entity) WHERE a.id IN $ids AND b.id IN $ids
          AND NOT type(r) IN ['COLLABORATES', 'WORKS_CLOSELY']
        RETURN a.id AS `from`, b.id AS `to`, type(r) AS type""", {"ids": id_list})
    return {"nodes": nodes, "edges": edges}


def main():
    import uvicorn

    logging.basicConfig(level=logging.INFO)
    uvicorn.run("lore.api:app", host="0.0.0.0", port=8000, reload=False)
