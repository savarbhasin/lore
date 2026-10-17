"""Executors for approved actions. Integrations register themselves here (Slack, GitHub/sandbox);
until one is configured, the action is recorded as simulated so the demo flow still completes."""

import logging
from typing import Awaitable, Callable

from lore import blackboard as BB
from lore import db

log = logging.getLogger(__name__)

Executor = Callable[[str, dict], Awaitable[dict]]
_executors: dict[str, Executor] = {}


def register(kind: str, fn: Executor) -> None:
    _executors[kind] = fn


async def execute(tenant: str, action: dict) -> dict:
    fn = _executors.get(action["kind"])
    if fn:
        BB.mark_executing(db.brain(tenant), tenant, action["id"])
    try:
        result = await fn(tenant, action) if fn else {"simulated": True, "note": f"no {action['kind']} integration configured"}
    except Exception as e:
        log.exception("action failed")
        result = {"error": str(e)}
    BB.mark_executed(db.brain(tenant), tenant, action["id"], result)
    return result
