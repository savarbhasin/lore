"""In-process pub/sub so API streams (SSE), bots and the web UI can follow agent runs live."""

import asyncio
from collections import defaultdict


class Bus:
    def __init__(self):
        self._subs: dict[str, set[asyncio.Queue]] = defaultdict(set)
        self._history: dict[str, list[dict]] = defaultdict(list)

    def publish(self, topic: str, event: dict) -> None:
        self._history[topic].append(event)
        for q in list(self._subs[topic]):
            q.put_nowait(event)

    def forget(self, prefix: str) -> None:
        """Drop replay history for topics under a prefix (e.g. after a tenant's data is reset and ids restart)."""
        for topic in [t for t in self._history if t.startswith(prefix)]:
            del self._history[topic]

    async def subscribe(self, topic: str, *, replay: bool = True):
        """Yield events for a topic (replaying what already happened) until a terminal event."""
        q: asyncio.Queue = asyncio.Queue()
        self._subs[topic].add(q)
        try:
            if replay:
                for e in list(self._history[topic]):
                    q.put_nowait(e)
            while True:
                e = await q.get()
                yield e
                if e.get("type") in ("done", "error"):
                    return
        finally:
            self._subs[topic].discard(q)


bus = Bus()
