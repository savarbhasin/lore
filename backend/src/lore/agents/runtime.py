"""A minimal tool-use loop: the model discovers and calls Lore tools over an MCP session.

The model sees compact tool results (data + source ids). The full evidence subgraph, sources and Cypher
from each call are streamed to `emit` for the UI, and accumulated so answers can be explained."""

import json
import time
from dataclasses import dataclass, field
from typing import Awaitable, Callable

from mcp import Client
from mcp.server.mcpserver import MCPServer

from lore import llm
from lore.config import settings

Emit = Callable[[dict], Awaitable[None] | None]


@dataclass
class RunResult:
    text: str
    tool_calls: int = 0
    evidence_nodes: dict = field(default_factory=dict)
    evidence_edges: list = field(default_factory=list)
    sources: dict = field(default_factory=dict)
    trace: list = field(default_factory=list)  # [{tool, args, cypher}]

    def evidence(self) -> dict:
        seen, edges = set(), []
        for e in self.evidence_edges:
            k = (e["from"], e["to"], e["type"])
            if k not in seen:
                seen.add(k)
                edges.append(e)
        return {"nodes": list(self.evidence_nodes.values()), "edges": edges}


async def _emit(emit: Emit | None, event: dict) -> None:
    if emit:
        r = emit(event)
        if r is not None and hasattr(r, "__await__"):
            await r


def _compact(payload: dict) -> str:
    """What the model gets back from a tool: the data and the ids of sources it may cite."""
    if not isinstance(payload, dict) or "data" not in payload:
        return json.dumps(payload, default=str)[:10000]
    compact = {"data": payload["data"], "source_ids": [s["id"] for s in payload.get("sources", [])]}
    return json.dumps(compact, default=str)[:10000]


async def run_agent(
    server: MCPServer,
    *,
    agent: str,
    system: str,
    task: str,
    history: list[dict] | None = None,
    allowed: set[str] | None = None,
    max_steps: int = 10,
    model: str | None = None,
    emit: Emit | None = None,
    require_tool: bool = False,
    validate: Callable[[str], str | None] | None = None,
) -> RunResult:
    result = RunResult(text="")
    async with Client(server) as mcp:
        tools = [
            {"type": "function", "function": {"name": t.name, "description": (t.description or "")[:1200],
                                              "parameters": t.input_schema}}
            for t in (await mcp.list_tools()).tools
            if allowed is None or t.name in allowed
        ]
        messages = [{"role": "system", "content": system}, *(history or []), {"role": "user", "content": task}]
        retries = 0
        for step in range(max_steps):
            last = step == max_steps - 1
            choice = "none" if last else ("required" if require_tool and result.tool_calls == 0 else "auto")
            resp = await llm.client().chat.completions.create(
                model=model or settings.agent_model,
                messages=messages,
                tools=tools,
                tool_choice=choice,
                temperature=0.2,
                max_tokens=4000,
            )
            msg = resp.choices[0].message
            messages.append(msg.model_dump(exclude_none=True))
            if not msg.tool_calls:
                result.text = llm.clean(msg.content)
                feedback = validate(result.text) if validate else None
                if feedback and retries < 2 and not last:
                    retries += 1
                    await _emit(emit, {"type": "grounding_retry", "agent": agent, "feedback": feedback})
                    messages.append({"role": "user", "content": feedback})
                    continue
                await _emit(emit, {"type": "agent_done", "agent": agent, "text": result.text})
                return result
            for tc in msg.tool_calls:
                name = tc.function.name
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    args = {}
                await _emit(emit, {"type": "tool_call", "agent": agent, "tool": name, "args": args})
                t0 = time.perf_counter()
                res = await mcp.call_tool(name, args)
                ms = int((time.perf_counter() - t0) * 1000)
                text = res.content[0].text if res.content else "{}"
                try:
                    payload = json.loads(text)
                except json.JSONDecodeError:
                    payload = {"data": text}
                result.tool_calls += 1
                ev = payload.get("evidence") if isinstance(payload, dict) else None
                if ev:
                    for n in ev.get("nodes", []):
                        result.evidence_nodes[n["id"]] = n
                    result.evidence_edges.extend(ev.get("edges", []))
                for s in payload.get("sources", []) if isinstance(payload, dict) else []:
                    result.sources[s["id"]] = s
                result.trace.append({"agent": agent, "tool": name, "args": args,
                                     "cypher": payload.get("cypher", []) if isinstance(payload, dict) else []})
                await _emit(emit, {
                    "type": "tool_result", "agent": agent, "tool": name, "ms": ms,
                    "evidence": ev or {"nodes": [], "edges": []},
                    "sources": payload.get("sources", []) if isinstance(payload, dict) else [],
                    "error": (payload.get("data") or {}).get("error") if isinstance(payload, dict)
                    and isinstance(payload.get("data"), dict) else None,
                })
                messages.append({"role": "tool", "tool_call_id": tc.id, "content": _compact(payload)})
    return result
