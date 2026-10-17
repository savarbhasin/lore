"""Channel messages -> the company graph (silently; no reply in Slack)."""

import logging

from slack_sdk.errors import SlackApiError
from slack_sdk.web.async_client import AsyncWebClient

from lore.config import settings
from lore.ingest.pipeline import ChatMessage, ingest
from lore.slack import identity

log = logging.getLogger(__name__)

INGESTED_SUBTYPES = {None, "thread_broadcast"}
channel_names: dict[str, str] = {}


def should_ingest(event: dict) -> bool:
    return (
        event.get("channel_type") in ("channel", "group")
        and not event.get("bot_id")
        and event.get("subtype") in INGESTED_SUBTYPES
        and bool((event.get("text") or "").strip())
    )


async def channel_name(client: AsyncWebClient, channel_id: str) -> str:
    if channel_id not in channel_names:
        try:
            channel_names[channel_id] = (await client.conversations_info(channel=channel_id))["channel"]["name"]
        except SlackApiError:
            channel_names[channel_id] = channel_id
    return channel_names[channel_id]


def permalink(team_domain: str | None, channel_id: str, ts: str) -> str:
    host = f"https://{team_domain}.slack.com" if team_domain else "https://slack.com"
    return f"{host}/archives/{channel_id}/p{ts.replace('.', '')}"


async def ingest_event(client: AsyncWebClient, event: dict, team_domain: str | None = None) -> None:
    tenant = settings.slack_tenant
    try:
        person = await identity.resolve(client, tenant, event["user"])
        msg = ChatMessage(
            source="slack",
            channel_id=event["channel"],
            channel_name=await channel_name(client, event["channel"]),
            thread_id=event.get("thread_ts") or event["ts"],
            message_id=event["ts"],
            text=event["text"],
            ts=int(float(event["ts"]) * 1000),
            url=permalink(team_domain, event["channel"], event["ts"]),
            author_id=person["id"] if person else None,
            author_name=person["name"] if person else event["user"],
        )
        result = await ingest(tenant, msg)
        if result["changes"]:
            log.info("slack message %s changed the graph: %s", msg.message_id, [c["text"] for c in result["changes"]])
    except Exception:
        log.exception("slack ingest failed")
