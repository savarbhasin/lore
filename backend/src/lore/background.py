import asyncio
import logging

log = logging.getLogger(__name__)
running: set[asyncio.Task] = set()


def report(task: asyncio.Task) -> None:
    running.discard(task)
    if not task.cancelled() and task.exception():
        log.error("background task failed", exc_info=task.exception())


def spawn(coro) -> asyncio.Task:
    task = asyncio.create_task(coro)
    running.add(task)
    task.add_done_callback(report)
    return task
