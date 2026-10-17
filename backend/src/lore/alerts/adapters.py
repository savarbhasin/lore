"""Translate monitoring webhooks (Sentry, Grafana/Alertmanager, Datadog, generic JSON) into one Alert shape."""

import hashlib
from dataclasses import dataclass, field


@dataclass
class Alert:
    source: str
    title: str
    text: str = ""
    status: str = "firing"            # firing | resolved
    severity: str = "SEV2"
    hints: list[str] = field(default_factory=list)  # strings that may name the service (tags, labels, project)
    url: str | None = None
    fingerprint: str = ""

    def __post_init__(self):
        if not self.fingerprint:
            self.fingerprint = hashlib.sha1(f"{self.source}|{self.title}".encode()).hexdigest()[:16]


SENTRY_LEVEL = {"fatal": "SEV1", "error": "SEV2", "warning": "SEV3", "info": "SEV3", "debug": "SEV3"}
LABEL_SEVERITY = {"critical": "SEV1", "page": "SEV1", "high": "SEV1", "error": "SEV2", "major": "SEV2",
                  "warning": "SEV3", "minor": "SEV3", "low": "SEV3", "info": "SEV3"}
DATADOG_PRIORITY = {"P1": "SEV1", "P2": "SEV1", "P3": "SEV2", "P4": "SEV3", "P5": "SEV3", "normal": "SEV2", "low": "SEV3"}
HINT_KEYS = ("service", "service_name", "app", "application", "component", "job", "project", "team")


def tag_pairs(tags) -> dict:
    """Sentry tags come as [[k, v], ...] or [{"key": k, "value": v}, ...]."""
    out = {}
    for t in tags or []:
        if isinstance(t, (list, tuple)) and len(t) == 2:
            out[str(t[0])] = str(t[1])
        elif isinstance(t, dict) and "key" in t:
            out[str(t["key"])] = str(t.get("value"))
    return out


def hints_from(mapping: dict) -> list[str]:
    return [str(mapping[k]) for k in HINT_KEYS if mapping.get(k)]


def sentry(payload: dict, resource: str | None = None) -> Alert:
    data = payload.get("data") or {}
    if "metric_alert" in data:  # Sentry metric alert (internal integration)
        ma = data["metric_alert"]
        rule = ma.get("alert_rule") or {}
        projects = rule.get("projects") or []
        return Alert(
            source="sentry",
            title=data.get("description_title") or ma.get("title") or rule.get("name") or "Sentry metric alert",
            text=data.get("description_text") or "",
            status="resolved" if payload.get("action") == "resolved" else "firing",
            severity="SEV1" if payload.get("action") == "critical" else "SEV2",
            hints=[str(p) for p in projects],
            url=data.get("web_url"),
            fingerprint=f"sentry-metric-{ma.get('id') or rule.get('id')}",
        )
    if "event" in data or "issue" in data:  # internal integration: event_alert / issue
        ev = data.get("event") or data.get("issue") or {}
        tags = tag_pairs(ev.get("tags"))
        project = ev.get("project") or {}
        slug = project.get("slug") if isinstance(project, dict) else None
        return Alert(
            source="sentry",
            title=ev.get("title") or ev.get("message") or "Sentry issue",
            text=" ".join(x for x in [ev.get("culprit"), data.get("triggered_rule")] if x),
            status="resolved" if payload.get("action") == "resolved" else "firing",
            severity=SENTRY_LEVEL.get(str(ev.get("level", "error")).lower(), "SEV2"),
            hints=hints_from(tags) + ([slug] if slug else []),
            url=ev.get("web_url") or ev.get("issue_url") or ev.get("permalink"),
            fingerprint=f"sentry-{ev.get('issue_id') or ev.get('id') or ev.get('title')}",
        )
    # Legacy "WebHooks" plugin (issue alert rules on every plan, incl. free)
    event = payload.get("event") or {}
    tags = tag_pairs(event.get("tags"))
    return Alert(
        source="sentry",
        title=event.get("title") or payload.get("message") or "Sentry issue",
        text=payload.get("culprit") or event.get("culprit") or "",
        severity=SENTRY_LEVEL.get(str(payload.get("level") or event.get("level") or "error").lower(), "SEV2"),
        hints=hints_from(tags) + [x for x in (payload.get("project_slug"), payload.get("project")) if x],
        url=payload.get("url"),
        fingerprint=f"sentry-{payload.get('id') or event.get('event_id') or payload.get('message')}",
    )


def grafana(payload: dict) -> Alert:
    """Grafana unified alerting and Prometheus Alertmanager share this shape."""
    alerts = payload.get("alerts") or []
    first = alerts[0] if alerts else {}
    labels = {**(payload.get("commonLabels") or {}), **(first.get("labels") or {})}
    annotations = {**(payload.get("commonAnnotations") or {}), **(first.get("annotations") or {})}
    title = annotations.get("summary") or labels.get("alertname") or payload.get("title") or "Grafana alert"
    return Alert(
        source="grafana",
        title=title,
        text=annotations.get("description") or payload.get("message") or "",
        status="resolved" if (payload.get("status") or first.get("status")) == "resolved" else "firing",
        severity=LABEL_SEVERITY.get(str(labels.get("severity", "")).lower(), "SEV2"),
        hints=hints_from(labels),
        url=first.get("generatorURL") or payload.get("externalURL"),
        fingerprint=f"grafana-{first.get('fingerprint') or payload.get('groupKey') or title}",
    )


def datadog(payload: dict) -> Alert:
    """Expects the webhook template documented in the README (title/text/priority/tags/transition/url/id)."""
    tags = dict(t.split(":", 1) for t in str(payload.get("tags", "")).split(",") if ":" in t)
    transition = str(payload.get("alert_transition", "")).lower()
    return Alert(
        source="datadog",
        title=payload.get("title") or "Datadog alert",
        text=payload.get("text") or "",
        status="resolved" if transition in ("recovered", "resolved") else "firing",
        severity=DATADOG_PRIORITY.get(str(payload.get("priority", "normal")), "SEV2"),
        hints=hints_from({k.strip(): v.strip() for k, v in tags.items()}),
        url=payload.get("url"),
        fingerprint=f"datadog-{payload.get('id') or payload.get('title')}",
    )


def generic(payload: dict) -> Alert:
    return Alert(
        source=payload.get("source") or "webhook",
        title=payload.get("title") or "Alert",
        text=payload.get("text") or payload.get("description") or "",
        status=payload.get("status") or "firing",
        severity=payload.get("severity") or "SEV2",
        hints=[x for x in (payload.get("service"),) if x],
        url=payload.get("url"),
        fingerprint=payload.get("fingerprint") or "",
    )


ADAPTERS = {"grafana": grafana, "alertmanager": grafana, "datadog": datadog, "generic": generic}


def parse(source: str, payload: dict, sentry_resource: str | None = None) -> Alert:
    if source == "sentry":
        return sentry(payload, sentry_resource)
    if source not in ADAPTERS:
        raise ValueError(f"unknown alert source {source!r}; use sentry, grafana, alertmanager, datadog or generic")
    return ADAPTERS[source](payload)
