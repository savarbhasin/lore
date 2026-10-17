"""Block Kit for Lore's Slack messages: answers, live progress, incident cards."""

import json
import re

from lore.config import settings

BRACKET = re.compile(r"\[([^\[\]\n]{1,160})\](?!\()")
ID = re.compile(r"^[A-Za-z][\w:./-]*$")

TOOL_STATUS = {
    "search_entities": "searching the graph",
    "get_entity": "looking up {entity_id}",
    "who_owns": "finding who owns {entity_id}",
    "who_knows": "finding who knows {entity_id}",
    "blast_radius": "mapping the blast radius of {service_id}",
    "recent_changes": "checking recent changes around {service_id}",
    "trace_decision": "tracing the decisions behind {entity_id}",
    "explain_path": "connecting {from_id} to {to_id}",
    "similar_incidents": "looking for similar past incidents",
    "run_cypher": "querying FalkorDB",
    "run_command": "running `{command}` in the sandbox",
    "read_file": "reading {path}",
    "write_file": "editing {path}",
    "record_pull_request": "recording the PR in the graph",
}

VERDICT_ICON = {"confirmed": "✅", "rejected": "❌", "inconclusive": "➖", "claimed": "⏳", "open": "•"}
ACTION_LABEL = {"open_pr": "Open fix PR", "page": "Page", "post_message": "Post update"}


def clip(text: str, n: int) -> str:
    text = text or ""
    return text if len(text) <= n else text[: n - 1] + "…"


def short_id(value) -> str:
    return str(value or "").removeprefix("file:")


def status_line(event: dict) -> str | None:
    if event.get("type") != "tool_call":
        return None
    template = TOOL_STATUS.get(event.get("tool", ""), "working")
    args = {k: clip(short_id(v), 60) for k, v in (event.get("args") or {}).items()}
    try:
        return template.format_map({k: args.get(k, "…") for k in re.findall(r"{(\w+)}", template)})
    except (KeyError, ValueError):
        return template


def progress_blocks(lines: list[str]) -> list[dict]:
    recent = lines[-4:] or ["thinking"]
    body = "\n".join(f"{'⏳' if i == len(recent) - 1 else '✓'} {line}" for i, line in enumerate(recent))
    return [{"type": "context", "elements": [{"type": "mrkdwn", "text": body}]}]


def link_citations(text: str, citations: list[dict]) -> str:
    urls = {c["id"]: c.get("url") for c in citations}

    def swap(m: re.Match) -> str:
        ids = [p.strip() for p in m.group(1).split(",") if ID.match(p.strip())]
        if not ids:
            return m.group(0)
        return " ".join(f"[{short_id(i)}]({urls[i]})" if urls.get(i) else f"`{short_id(i)}`" for i in ids)

    return BRACKET.sub(swap, text)


def answer_link(record: dict) -> str:
    return f"{settings.web_url}/a/{record['id']}?t={settings.slack_tenant}"


def answer_blocks(record: dict) -> list[dict]:
    body = link_citations(record["answer"], record.get("citations") or [])
    blocks: list[dict] = [{"type": "markdown", "text": clip(body, 11000)}]
    footer = f"{record.get('tool_calls', 0)} graph & sandbox calls · <{answer_link(record)}|Open evidence graph>"
    for url in record.get("pull_requests") or []:
        footer += f" · <{url}|PR #{url.rsplit('/', 1)[-1]}>"
    blocks.append({"type": "context", "elements": [{"type": "mrkdwn", "text": footer}]})
    return blocks


def answer_text(record: dict) -> str:
    return clip(re.sub(r"\[([^\]]+)\]", r"\1", record["answer"]), 3000)


def incident_link(iid: str) -> str:
    return f"{settings.web_url}/incidents/{iid}"


def action_blocks(action: dict) -> list[dict]:
    label = ACTION_LABEL.get(action["kind"], action["kind"])
    head = f"*{label}* → `{short_id(action['target'])}`\n{clip(action.get('summary', ''), 600)}"
    blocks: list[dict] = [{"type": "section", "text": {"type": "mrkdwn", "text": head}}]
    if action["status"] == "proposed":
        blocks.append({
            "type": "actions",
            "elements": [
                {"type": "button", "text": {"type": "plain_text", "text": "Approve"}, "style": "primary",
                 "action_id": "lore_approve", "value": action["id"]},
                {"type": "button", "text": {"type": "plain_text", "text": "Reject"},
                 "action_id": "lore_reject", "value": action["id"]},
            ],
        })
        approvers = ", ".join(action.get("approvers") or []) or "nobody"
        blocks.append({"type": "context", "elements": [
            {"type": "mrkdwn", "text": f"Approvers (from the graph: owning team + decision owners): {approvers}"}]})
    else:
        note = f"*{action['status']}*"
        if action.get("decided_by"):
            note += f" by {action['decided_by']}"
        result = parse_result(action.get("result"))
        for url in result.get("pull_requests") or []:
            note += f" · <{url}|PR #{url.rsplit('/', 1)[-1]}>"
        if result.get("error"):
            note += f" · ⚠️ {clip(result['error'], 200)}"
        if result.get("simulated"):
            note += " · simulated"
        blocks.append({"type": "context", "elements": [{"type": "mrkdwn", "text": note}]})
    return blocks


def parse_result(raw) -> dict:
    if not raw:
        return {}
    try:
        return json.loads(raw) if isinstance(raw, str) else raw
    except json.JSONDecodeError:
        return {"summary": raw}


def incident_blocks(board: dict, events: list[dict]) -> list[dict]:
    inc = board["incident"]
    status = inc["status"].replace("_", " ")
    blocks: list[dict] = [
        {"type": "header", "text": {"type": "plain_text", "text": clip(f"🚨 {inc['id']} · {inc['title']}", 150)}},
        {"type": "context", "elements": [{"type": "mrkdwn", "text": (
            f"*{inc.get('severity', '')}* · {', '.join(inc.get('services') or [])} · status *{status}* · "
            f"{inc.get('tool_calls') or 0} tool calls · <{incident_link(inc['id'])}|Open incident room>")}]},
    ]
    findings = {f["hypothesis_id"]: f for f in board["findings"]}
    confirmed = sorted((f for f in board["findings"] if f["verdict"] == "confirmed"), key=lambda f: -f["confidence"])
    if confirmed:
        f = confirmed[0]
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": (
            f"*Root cause* ({f['confidence']:.0%}): {clip(f['summary'], 900)}\n"
            f"Evidence: {', '.join(f'`{short_id(e)}`' for e in f['evidence'][:8])}")}})
    if board["hypotheses"]:
        lines = []
        for h in board["hypotheses"]:
            f = findings.get(h["id"])
            icon = VERDICT_ICON.get(f["verdict"] if f else h["status"], "•")
            lines.append(f"{icon} {clip(h['statement'], 220)}")
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": clip("*Hypotheses*\n" + "\n".join(lines), 2900)}})
    if board["actions"]:
        blocks.append({"type": "divider"})
        for a in board["actions"]:
            blocks += action_blocks(a)
    latest = [e for e in events if e.get("kind") not in ("agent_start",)][-3:]
    if latest:
        trail = "\n".join(f"_{e['agent']}_ · {clip(e['text'], 140)}" for e in latest)
        blocks.append({"type": "context", "elements": [{"type": "mrkdwn", "text": trail}]})
    return blocks[:50]
