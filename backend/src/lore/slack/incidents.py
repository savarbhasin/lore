"""Incident cards in Slack: one message per incident, kept in sync with the blackboard as agents work, with
Approve/Reject buttons that go through the same graph authorization as the web app."""

import asyncio
import logging

from slack_sdk.errors import SlackApiError
from slack_sdk.web.async_client import AsyncWebClient

from lore import actions, db
from lore import blackboard as BB
from lore.config import settings
from lore.events import bus
from lore.slack import format as F
from lore.slack import identity

log = logging.getLogger(__name__)

REFRESH_DELAY_S = 1.2
watchers: dict[str, asyncio.Task] = {}
background: set[asyncio.Task] = set()


def spawn(coro) -> asyncio.Task:
    task = asyncio.create_task(coro)
    background.add(task)
    task.add_done_callback(background.discard)
    return task


def card_location(tenant: str, iid: str) -> tuple[str, str] | None:
    r = db.rows(db.brain(tenant), "MATCH (i:Incident {id: $id}) RETURN i.slack_channel AS c, i.slack_ts AS ts",
                {"id": iid})
    return (r[0]["c"], r[0]["ts"]) if r and r[0]["c"] else None


def save_card_location(tenant: str, iid: str, channel: str, ts: str) -> None:
    db.write(db.brain(tenant), "MATCH (i:Incident {id: $id}) SET i.slack_channel = $c, i.slack_ts = $ts",
             {"id": iid, "c": channel, "ts": ts})


async def render(client: AsyncWebClient, tenant: str, iid: str) -> None:
    where = card_location(tenant, iid)
    if not where:
        return
    g = db.brain(tenant)
    board = BB.get_incident(g, iid)
    if "error" in board:
        return
    blocks = F.incident_blocks(board, BB.events(g, iid))
    text = f"{iid}: {board['incident']['title']} ({board['incident']['status']})"
    await client.chat_update(channel=where[0], ts=where[1], blocks=blocks, text=text)


async def watch(client: AsyncWebClient, tenant: str, iid: str) -> None:
    """Re-render the card shortly after board changes (debounced so a burst of events is one update)."""
    pending: asyncio.Task | None = None

    async def later():
        await asyncio.sleep(REFRESH_DELAY_S)
        try:
            await render(client, tenant, iid)
        except Exception:
            log.exception("incident card update failed")

    async for e in bus.subscribe(BB.topic(tenant, iid)):
        if e.get("type") in ("event", "agent_done", "done") and (pending is None or pending.done()):
            pending = asyncio.create_task(later())
    if pending:
        await pending


async def announce(client: AsyncWebClient, tenant: str, iid: str, channel: str | None = None) -> None:
    """Post the incident card (once) and keep it live."""
    if not card_location(tenant, iid):
        board = BB.get_incident(db.brain(tenant), iid)
        r = await client.chat_postMessage(
            channel=channel or settings.slack_incident_channel,
            text=f"🚨 {iid}: {board['incident']['title']}",
            blocks=F.incident_blocks(board, []),
        )
        save_card_location(tenant, iid, r["channel"], r["ts"])
        await client.chat_postMessage(channel=r["channel"], thread_ts=r["ts"],
                                      text="Lore's agents are on it — triage, parallel investigators, then proposed "
                                           "actions for a human to approve here.")
    if iid not in watchers or watchers[iid].done():
        watchers[iid] = spawn(watch(client, tenant, iid))


async def decide(client: AsyncWebClient, tenant: str, slack_user: str, channel: str, action_id: str,
                 approve: bool) -> None:
    person = await identity.resolve(client, tenant, slack_user)
    if not person:
        await client.chat_postEphemeral(
            channel=channel, user=slack_user,
            text="I don't know who you are in the org graph yet. Link yourself with `/lore iam <person-id>`.")
        return
    r = BB.decide_action(db.brain(tenant), tenant, action_id, person["id"], approve)
    if not r["ok"]:
        approvers = ", ".join(r.get("approvers") or [])
        await client.chat_postEphemeral(
            channel=channel, user=slack_user,
            text=f"Not allowed: {r['error']}." + (f" The graph says approvers are: {approvers}." if approvers else ""))
        return
    if r["status"] == "approved":
        spawn(actions.execute(tenant, {**r["action"], "decided_by": person["id"]}))
    await render(client, tenant, r["incident_id"])


def incident_of(tenant: str, action_id: str) -> dict:
    r = db.rows(db.brain(tenant), """
        MATCH (a:Action {id: $aid})-[:FOR]->(i:Incident)
        RETURN i.id AS id, i.title AS title, i.slack_channel AS channel, i.slack_ts AS ts""", {"aid": action_id})
    return r[0] if r else {}


def executors(client: AsyncWebClient) -> dict:
    """Real Slack implementations of the responder's `page` and `post_message` actions."""

    async def page(tenant: str, action: dict) -> dict:
        inc = incident_of(tenant, action["id"])
        sid = identity.slack_id_for(tenant, action["target"])
        text = (f"📟 You're being paged for *{inc.get('id')}* — {inc.get('title')}\n{action.get('summary', '')}\n"
                f"<{F.incident_link(inc.get('id', ''))}|Open incident room>")
        if sid:
            dm = await client.conversations_open(users=sid)
            await client.chat_postMessage(channel=dm["channel"]["id"], text=text)
            return {"paged": action["target"], "via": "slack_dm"}
        if inc.get("channel"):
            await client.chat_postMessage(channel=inc["channel"], thread_ts=inc["ts"],
                                          text=f"📟 Paging *{action['target']}* (no Slack account linked).\n{text}")
        return {"paged": action["target"], "via": "incident_thread"}

    async def post_message(tenant: str, action: dict) -> dict:
        inc = incident_of(tenant, action["id"])
        text = f"*{inc.get('id')} update* — {action.get('summary', '')}\n<{F.incident_link(inc.get('id', ''))}|Incident room>"
        channel = action["target"].lstrip("#")
        try:
            r = await client.chat_postMessage(channel=channel, text=text)
            return {"posted": f"#{channel}", "ts": r["ts"]}
        except SlackApiError as e:  # channel missing or bot not invited: keep the update in the incident thread
            if inc.get("channel"):
                await client.chat_postMessage(channel=inc["channel"], thread_ts=inc["ts"],
                                              text=f"(couldn't post to #{channel}: {e})\n{text}")
            return {"posted": "incident_thread", "note": str(e)}

    return {"page": page, "post_message": post_message}


def register_executors(client: AsyncWebClient) -> None:
    for kind, fn in executors(client).items():
        actions.register(kind, fn)
