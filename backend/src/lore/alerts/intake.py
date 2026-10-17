"""Turn alerts into incidents: map the alert to a service in the graph, collapse repeats into the open incident,
and start the agent team. Every entry point (web form, Slack, monitoring webhooks) goes through `start`."""

import re
from collections.abc import Awaitable, Callable

from lore import blackboard as BB
from lore import db
from lore.agents.incident import run_incident
from lore.alerts.adapters import Alert
from lore.background import spawn
from lore.ingest import mentions as M

DEDUP_WINDOW_MS = 6 * 3_600_000
SUFFIXES = re.compile(r"[-_ ]?(service|svc|api|prod|production|staging)$")

opened_hooks: list[Callable[[str, str], Awaitable[None]]] = []


def on_opened(hook: Callable[[str, str], Awaitable[None]]) -> None:
    if hook not in opened_hooks:
        opened_hooks.append(hook)


def service_ids(g) -> set[str]:
    return {r["id"] for r in db.rows(g, "MATCH (s:Service) RETURN s.id AS id")}


def resolve_service(g, alert: Alert) -> str | None:
    known = service_ids(g)
    for hint in alert.hints:
        h = hint.strip().lower().replace("_", "-")
        for candidate in (h, SUFFIXES.sub("", h), h.replace(" ", "-")):
            if candidate in known:
                return candidate
    mentioned = [m["id"] for m in M.link(g, f"{alert.title} {alert.text}") if m["label"] == "Service"]
    return mentioned[0] if mentioned else None


def open_for(g, fingerprint: str) -> str | None:
    r = db.rows(g, """
        MATCH (a:Alert {fingerprint: $fp})-[:PART_OF]->(i:Incident)
        WHERE i.status <> 'resolved' AND i.ts >= $since
        RETURN i.id AS id ORDER BY i.ts DESC LIMIT 1""", {"fp": fingerprint, "since": db.now_ms() - DEDUP_WINDOW_MS})
    return r[0]["id"] if r else None


async def start(tenant: str, service_id: str, title: str, text: str = "", severity: str = "SEV2",
                alert: dict | None = None) -> str:
    g = db.brain(tenant)
    if service_id not in service_ids(g):
        raise ValueError(f"unknown service {service_id!r}")
    iid = BB.open_incident(g, tenant, service_id, title, text, severity, alert=alert)
    for hook in opened_hooks:
        spawn(hook(tenant, iid))
    spawn(run_incident(tenant, iid))
    return iid


async def receive(tenant: str, alert: Alert) -> dict:
    g = db.brain(tenant)
    service = resolve_service(g, alert)
    if not service:
        return {"status": "ignored",
                "reason": "couldn't map the alert to a service — add a `service` tag/label with a service id",
                "hints": alert.hints}
    existing = open_for(g, alert.fingerprint)
    if existing:
        if alert.status == "resolved":
            BB.log_event(g, tenant, existing, alert.source, "monitor_recovered", f"{alert.source} reports recovered: {alert.title}")
            return {"status": "recovered", "incident_id": existing}
        BB.log_event(g, tenant, existing, alert.source, "alert_refired", f"{alert.source} alert fired again: {alert.title}")
        return {"status": "deduplicated", "incident_id": existing}
    if alert.status == "resolved":
        return {"status": "ignored", "reason": "recovery for an alert with no open incident"}
    iid = await start(tenant, service, alert.title, alert.text, alert.severity,
                      alert={"source": alert.source, "url": alert.url or "", "fingerprint": alert.fingerprint})
    return {"status": "opened", "incident_id": iid, "service": service, "severity": alert.severity}
