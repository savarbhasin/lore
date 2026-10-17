"""Lore MCP server. One server instance per tenant: the tenant is bound at connection time, never chosen
by the model, so an agent cannot read another company's graph."""

import functools
import inspect
from typing import Any, Callable

from mcp.server.mcpserver import MCPServer
from mcp.types import ToolAnnotations

from lore import blackboard as BB
from lore import db
from lore import memory as M
from lore import sandbox as SB
from lore.tools import write as W
from lore.tools import graph as G

GRAPH_TOOLS: list[Callable] = [
    G.search_entities,
    G.get_entity,
    G.who_owns,
    G.who_knows,
    G.blast_radius,
    G.recent_changes,
    G.trace_decision,
    G.explain_path,
    G.similar_incidents,
    G.knowledge_hubs,
    G.bus_factor,
    G.communities,
    G.graph_schema,
    G.run_cypher,
]

INSTRUCTIONS = """Lore is the company brain for {tenant}: a FalkorDB graph of people, teams, services, code,
PRs, deploys, tickets, Slack threads, docs, decisions and incidents. Start from search_entities when you only
have words; use entity ids (e.g. 'payments-api', 'PR-482', 'file:services/...', 'D-17') with the other tools.
Every result includes `evidence` (the subgraph used) and `sources` (links) — cite sources in answers."""


def bind_graph(fn: Callable, graph_factory: Callable[[], Any], **inject) -> Callable:
    """Turn fn(g, ..., *, tenant, agent) into fn(...): the graph and any `inject`ed keyword-only values are
    supplied by the server, and dropped from the schema the model sees."""

    if inspect.iscoroutinefunction(fn):
        @functools.wraps(fn)
        async def wrapper(*args, **kwargs):
            return await fn(graph_factory(), *args, **kwargs, **inject)
    else:
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            return fn(graph_factory(), *args, **kwargs, **inject)

    sig = inspect.signature(fn)
    params = [p for p in list(sig.parameters.values())[1:] if p.name not in inject]
    wrapper.__signature__ = sig.replace(parameters=params)
    wrapper.__annotations__ = {k: v for k, v in fn.__annotations__.items() if k != "g" and k not in inject}
    return wrapper


READ_ONLY = ToolAnnotations(readOnlyHint=True, openWorldHint=False)
WRITES = ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False)


def create_server(tenant: str, *, agent: str | None = None, user: str | None = None,
                  sandbox: "SB.SandboxSession | None" = None) -> MCPServer:
    """Graph read tools always. With `agent`: incident blackboard + procedural memory tools, attributed to that
    agent. With `user`: that user's private memory tools. With `sandbox`: a Linux sandbox (run commands, read and
    write files) plus a tool to record the pull requests it opens back into the graph."""
    db.brain_key(tenant)  # validates the tenant id
    server = MCPServer(name=f"lore-{tenant}", instructions=INSTRUCTIONS.format(tenant=tenant))
    brain = lambda: db.brain(tenant)  # noqa: E731
    for fn in GRAPH_TOOLS:
        server.add_tool(bind_graph(fn, brain), annotations=READ_ONLY)
    if agent:
        server.add_tool(bind_graph(BB.get_incident, brain), annotations=READ_ONLY)
        server.add_tool(bind_graph(BB.match_procedures, brain), annotations=READ_ONLY)
        for fn in [BB.add_hypothesis, BB.post_finding, BB.propose_action, BB.record_procedure]:
            server.add_tool(bind_graph(fn, brain, tenant=tenant, agent=agent), annotations=WRITES)
    if user:
        mem = lambda: M.graph(tenant, user)  # noqa: E731
        server.add_tool(bind_graph(M.remember, mem), annotations=WRITES)
        server.add_tool(bind_graph(M.recall, mem), annotations=READ_ONLY)
    if sandbox:
        for fn in SB.tools(sandbox):
            server.add_tool(fn, annotations=ToolAnnotations(readOnlyHint=False, openWorldHint=True))
        server.add_tool(bind_graph(W.record_pull_request, brain, tenant=tenant, agent=agent or "lore"), annotations=WRITES)
    return server
