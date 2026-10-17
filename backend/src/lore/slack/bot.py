"""Lore in Slack (Socket Mode). Runs inside the API process so it shares the live event bus with the web app:
an incident opened on the web gets a Slack card, and an approval clicked in Slack shows up in the incident room.

  @Lore <question> / DM          -> threaded answer with cited sources + link to the evidence graph
  /lore ask <question>           -> same, in the channel
  /lore incident <service> <title> -> opens an incident; the card lives in #incidents with Approve buttons
  /lore iam <person-id>          -> link your Slack user to a person in the org graph
  /lore whoami | help
  any channel message the bot can see -> stored in the graph; ownership changes and decisions applied with history
"""

import asyncio
import logging
import re

from slack_bolt.adapter.socket_mode.async_handler import AsyncSocketModeHandler
from slack_bolt.async_app import AsyncApp
from slack_sdk.errors import SlackApiError
from slack_sdk.web.async_client import AsyncWebClient

from lore import db
from lore.agents.ask import ask, new_answer_id
from lore.alerts import intake
from lore.config import settings
from lore.events import bus
from lore.slack import format as F
from lore.slack import identity, incidents
from lore.slack import ingest as slack_ingest

log = logging.getLogger(__name__)

MENTION = re.compile(r"<@[A-Z0-9]+>\s*")
PROGRESS_EVERY_S = 1.5
HELP = """*Lore* — the company brain for {tenant}
• `@Lore <question>` or DM me — who owns/knows what, why things are the way they are, what changed. I can also
  clone the code and work on it in my sandbox.
• `/lore ask <question>`
• `/lore incident <service> <title>` — open an incident; I'll post a live card in #{channel}
• `/lore iam <person-id>` — link your Slack account to a person in the graph (needed for approvals)
• `/lore whoami`"""

state: dict = {"handler": None, "client": None}


def enabled() -> bool:
    return bool(settings.slack_bot_token and settings.slack_app_token)


def client() -> AsyncWebClient | None:
    return state["client"]


async def answer_in_thread(web: AsyncWebClient, channel: str, thread_ts: str, slack_user: str, question: str) -> None:
    tenant = settings.slack_tenant
    person = await identity.resolve(web, tenant, slack_user)
    placeholder = await web.chat_postMessage(channel=channel, thread_ts=thread_ts, text="Looking into it…",
                                             blocks=F.progress_blocks(["thinking"]))
    answer_id = new_answer_id()

    async def progress():
        lines: list[str] = []
        last = 0.0
        loop = asyncio.get_running_loop()
        async for e in bus.subscribe(f"ask:{answer_id}"):
            line = F.status_line(e)
            if not line:
                continue
            lines.append(line)
            if loop.time() - last >= PROGRESS_EVERY_S:
                last = loop.time()
                try:
                    await web.chat_update(channel=channel, ts=placeholder["ts"], text=line, blocks=F.progress_blocks(lines))
                except Exception:
                    log.debug("progress update failed", exc_info=True)

    watcher = asyncio.create_task(progress())
    try:
        record = await ask(tenant, identity.lore_user(person, slack_user), question,
                           session_id=f"slack:{channel}:{thread_ts}", surface="slack", answer_id=answer_id)
    except Exception as e:
        log.exception("slack ask failed")
        await web.chat_update(channel=channel, ts=placeholder["ts"], text=f"Sorry — that failed: {e}", blocks=[])
        return
    finally:
        watcher.cancel()
    await web.chat_update(channel=channel, ts=placeholder["ts"], text=F.answer_text(record),
                          blocks=F.answer_blocks(record))


async def open_incident(web: AsyncWebClient, service_id: str, title: str, opener: str) -> str:
    tenant = settings.slack_tenant
    g = db.brain(tenant)
    if not db.rows(g, "MATCH (s:Service {id: $id}) RETURN s.id", {"id": service_id}):
        raise ValueError(f"unknown service `{service_id}`")
    return await intake.start(tenant, service_id, title, f"{title} (opened from Slack by {opener})", "SEV2",
                              alert={"source": "slack"})


def build_app() -> AsyncApp:
    app = AsyncApp(token=settings.slack_bot_token)

    @app.event("app_mention")
    async def on_mention(event, client):
        question = MENTION.sub("", event.get("text", "")).strip()
        if not question:
            return
        thread = event.get("thread_ts") or event["ts"]
        incidents.spawn(answer_in_thread(client, event["channel"], thread, event["user"], question))

    @app.event("message")
    async def on_message(event, client, context):
        if slack_ingest.should_ingest(event):
            incidents.spawn(slack_ingest.ingest_event(client, event, context.get("team_domain")))
            return
        if event.get("channel_type") != "im" or event.get("bot_id") or event.get("subtype"):
            return
        thread = event.get("thread_ts") or event["ts"]
        incidents.spawn(answer_in_thread(client, event["channel"], thread, event["user"], event.get("text", "")))

    @app.command("/lore")
    async def on_command(ack, command, client, respond):
        await ack()
        tenant = settings.slack_tenant
        text = (command.get("text") or "").strip()
        verb, _, rest = text.partition(" ")
        user, channel = command["user_id"], command["channel_id"]
        if verb == "iam":
            person = identity.link(tenant, user, rest.strip().lower())
            await respond(f"Linked you to *{person['name']}* (`{person['id']}`)." if person else
                          f"No person `{rest.strip()}` in the graph.")
        elif verb == "whoami":
            person = identity.person_for(tenant, user)
            await respond(f"You are *{person['name']}* (`{person['id']}`) in {tenant}'s graph." if person else
                          "Not linked yet — use `/lore iam <person-id>`.")
        elif verb == "ask" and rest.strip():
            root = await client.chat_postMessage(channel=channel, text=f"<@{user}> asked: {rest.strip()}")
            incidents.spawn(answer_in_thread(client, channel, root["ts"], user, rest.strip()))
        elif verb == "incident" and rest.strip():
            service, _, title = rest.strip().partition(" ")
            try:
                iid = await open_incident(client, service, title or f"{service} alert", f"<@{user}>")
                await respond(f"Opened *{iid}* — follow it in #{settings.slack_incident_channel}.")
            except (ValueError, SlackApiError) as e:
                await respond(f"Couldn't open the incident: {e}")
        else:
            await respond(HELP.format(tenant=tenant, channel=settings.slack_incident_channel))

    @app.action("lore_approve")
    async def on_approve(ack, body, client):
        await ack()
        await incidents.decide(client, settings.slack_tenant, body["user"]["id"], body["channel"]["id"],
                               body["actions"][0]["value"], True)

    @app.action("lore_reject")
    async def on_reject(ack, body, client):
        await ack()
        await incidents.decide(client, settings.slack_tenant, body["user"]["id"], body["channel"]["id"],
                               body["actions"][0]["value"], False)

    return app


async def start() -> None:
    if not enabled():
        log.info("Slack bot disabled (set SLACK_BOT_TOKEN and SLACK_APP_TOKEN)")
        return
    app = build_app()
    handler = AsyncSocketModeHandler(app, settings.slack_app_token)
    await handler.connect_async()
    state.update(handler=handler, client=app.client)
    incidents.register_executors(app.client)
    intake.on_opened(on_incident_opened)
    log.info("Slack bot connected (tenant %s, incidents in #%s)", settings.slack_tenant, settings.slack_incident_channel)


async def stop() -> None:
    if state["handler"]:
        await state["handler"].close_async()
        state.update(handler=None, client=None)


async def on_incident_opened(tenant: str, iid: str) -> None:
    """Incidents opened elsewhere (web, alert webhook) also get a live Slack card."""
    web = client()
    if web and tenant == settings.slack_tenant:
        try:
            await incidents.announce(web, tenant, iid)
        except Exception:
            log.exception("could not post incident card to Slack")
