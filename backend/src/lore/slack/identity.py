"""Slack user <-> graph Person. The link lives on the Person node (`slack_id`), so approvals made in Slack are
authorized by the same graph rules as everywhere else."""

from slack_sdk.errors import SlackApiError
from slack_sdk.web.async_client import AsyncWebClient

from lore import db

GUEST_PREFIX = "slack-"


def person_for(tenant: str, slack_id: str) -> dict | None:
    r = db.rows(db.brain(tenant), "MATCH (p:Person {slack_id: $sid}) RETURN p.id AS id, p.name AS name LIMIT 1",
                {"sid": slack_id})
    return r[0] if r else None


def slack_id_for(tenant: str, person_id: str) -> str | None:
    r = db.rows(db.brain(tenant), "MATCH (p:Person {id: $pid}) RETURN p.slack_id AS sid", {"pid": person_id})
    return r[0]["sid"] if r else None


def link(tenant: str, slack_id: str, person_id: str) -> dict | None:
    g = db.brain(tenant)
    found = db.rows(g, "MATCH (p:Person {id: $pid}) RETURN p.id AS id, p.name AS name", {"pid": person_id})
    if not found:
        return None
    db.write(g, "MATCH (p:Person {slack_id: $sid}) REMOVE p.slack_id", {"sid": slack_id})
    db.write(g, "MATCH (p:Person {id: $pid}) SET p.slack_id = $sid", {"pid": person_id, "sid": slack_id})
    return found[0]


async def resolve(client: AsyncWebClient, tenant: str, slack_id: str) -> dict | None:
    """Linked person, else try to match the Slack profile's email or real name to a person once and remember it."""
    linked = person_for(tenant, slack_id)
    if linked:
        return linked
    try:
        profile = (await client.users_info(user=slack_id))["user"]
    except SlackApiError:
        return None
    email = (profile.get("profile") or {}).get("email") or ""
    name = profile.get("real_name") or ""
    r = db.rows(db.brain(tenant),
                "MATCH (p:Person) WHERE p.slack_id IS NULL AND (p.email = $email OR toLower(p.name) = toLower($name)) "
                "RETURN p.id AS id LIMIT 1", {"email": email, "name": name})
    return link(tenant, slack_id, r[0]["id"]) if r else None


def lore_user(person: dict | None, slack_id: str) -> str:
    return person["id"] if person else f"{GUEST_PREFIX}{slack_id.lower()}"
