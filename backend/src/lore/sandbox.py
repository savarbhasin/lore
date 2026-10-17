"""E2B sandboxes for the Lore agent: a real Linux box where it can clone repos, run code, test, use git.

One sandbox per conversation/incident (keyed), created lazily on the first sandbox tool call and reused across
turns so a follow-up ("now open the PR") finds the clone it made earlier. Every line of output is streamed to
the run's live topic so the web UI can show a terminal."""

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Awaitable, Callable

from e2b import AsyncSandbox
from e2b.sandbox.commands.command_handle import CommandExitException

from lore.config import settings

log = logging.getLogger(__name__)

Emit = Callable[[dict], None]
LIFETIME_S = 30 * 60
MAX_OUTPUT = 8000


def _clip(text: str, limit: int = MAX_OUTPUT) -> str:
    if len(text) <= limit:
        return text
    half = limit // 2
    return f"{text[:half]}\n…[{len(text) - limit} chars clipped]…\n{text[-half:]}"


@dataclass
class SandboxSession:
    key: str
    emit: Emit = lambda e: None  # noqa: E731 — replaced by each run that uses this sandbox
    sbx: AsyncSandbox | None = None
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def ensure(self) -> AsyncSandbox:
        async with self._lock:
            if self.sbx is not None:
                return self.sbx
            if not settings.e2b_api_key:
                raise RuntimeError("E2B_API_KEY is not set (graph-hack/.env)")
            envs = {}
            if settings.github_token:
                envs = {"GH_TOKEN": settings.github_token, "GITHUB_TOKEN": settings.github_token}
            self.emit({"type": "sandbox_status", "status": "starting"})
            t0 = time.perf_counter()
            self.sbx = await AsyncSandbox.create(
                template=settings.e2b_template, timeout=LIFETIME_S, envs=envs, api_key=settings.e2b_api_key,
                metadata={"lore_key": self.key},
            )
            # Identity for commits, and HTTPS auth to GitHub via the token (if one was provided).
            setup = ['git config --global user.name "Lore"', 'git config --global user.email "lore-bot@users.noreply.github.com"']
            if settings.github_token:
                setup.append('git config --global url."https://x-access-token:${GH_TOKEN}@github.com/".insteadOf "https://github.com/"')
            await self.sbx.commands.run(" && ".join(setup), timeout=30)
            self.emit({"type": "sandbox_status", "status": "ready", "sandbox_id": self.sbx.sandbox_id,
                       "ms": int((time.perf_counter() - t0) * 1000)})
            return self.sbx

    async def run(self, command: str, timeout_s: int = 120, cwd: str | None = None) -> dict:
        try:
            sbx = await self.ensure()
        except Exception as e:  # e.g. no E2B key / quota: tell the model so it can say so instead of crashing
            self.emit({"type": "sandbox_status", "status": "unavailable", "error": str(e)})
            return {"exit_code": -1, "error": f"sandbox unavailable: {e}"}
        await sbx.set_timeout(LIFETIME_S)
        self.emit({"type": "sandbox_cmd", "cmd": command, "cwd": cwd})
        t0 = time.perf_counter()

        def out(line: str):
            self.emit({"type": "sandbox_out", "stream": "stdout", "text": line})

        def err(line: str):
            self.emit({"type": "sandbox_out", "stream": "stderr", "text": line})

        try:
            r = await sbx.commands.run(command, cwd=cwd, timeout=min(max(int(timeout_s), 5), 900),
                                       on_stdout=out, on_stderr=err)
            code, stdout, stderr = r.exit_code, r.stdout, r.stderr
        except CommandExitException as e:
            code, stdout, stderr = e.exit_code, e.stdout, e.stderr
        except Exception as e:  # timeout or transport error: report it to the model rather than crash the run
            code, stdout, stderr = -1, "", f"{type(e).__name__}: {e}"
        ms = int((time.perf_counter() - t0) * 1000)
        self.emit({"type": "sandbox_exit", "cmd": command, "exit_code": code, "ms": ms})
        return {"exit_code": code, "stdout": _clip(stdout), "stderr": _clip(stderr, 4000), "ms": ms}

    async def read(self, path: str) -> str:
        sbx = await self.ensure()
        return _clip(await sbx.files.read(path), 20000)

    async def write(self, path: str, content: str) -> None:
        sbx = await self.ensure()
        await sbx.files.write(path, content)
        self.emit({"type": "sandbox_cmd", "cmd": f"# wrote {path} ({len(content)} bytes)"})

    async def close(self) -> None:
        if self.sbx is not None:
            try:
                await self.sbx.kill()
            finally:
                self.sbx = None


_sessions: dict[str, SandboxSession] = {}


def session(key: str, emit: Emit | None = None) -> SandboxSession:
    """Get (or create the handle for) the sandbox bound to a conversation/incident; emit goes to the caller's topic."""
    s = _sessions.setdefault(key, SandboxSession(key=key))
    if emit is not None:
        s.emit = emit
    return s


async def close(key: str) -> None:
    s = _sessions.pop(key, None)
    if s:
        await s.close()


def tools(s: SandboxSession) -> list[Callable[..., Awaitable[dict]]]:
    """Sandbox tools exposed to the agent over MCP."""

    async def run_command(command: str, timeout_s: int = 120, cwd: str | None = None) -> dict:
        """Run any shell command in your own Linux sandbox (Debian, persistent for this conversation, home
        /home/user, internet access, git preinstalled; install anything else you need). Use it to clone repos,
        read code, run tests, reproduce bugs, make changes, commit, push and open pull requests. GH_TOKEN is set
        and git is preconfigured for https://github.com (use the GitHub REST API with curl, or install gh).
        Returns exit_code, stdout and stderr (long output is clipped in the middle)."""
        return await s.run(command, timeout_s=timeout_s, cwd=cwd)

    async def read_file(path: str) -> dict:
        """Read a text file from the sandbox."""
        try:
            return {"path": path, "content": await s.read(path)}
        except Exception as e:
            return {"error": str(e)}

    async def write_file(path: str, content: str) -> dict:
        """Create or overwrite a text file in the sandbox (parent directories are created)."""
        try:
            await s.write(path, content)
            return {"ok": True, "path": path, "bytes": len(content)}
        except Exception as e:
            return {"error": str(e)}

    return [run_command, read_file, write_file]
