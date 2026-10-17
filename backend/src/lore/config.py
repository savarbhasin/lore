import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[3] / ".env")


@dataclass(frozen=True)
class Settings:
    falkordb_host: str = os.getenv("FALKORDB_HOST", "localhost")
    falkordb_port: int = int(os.getenv("FALKORDB_PORT", "6379"))
    falkordb_username: str | None = os.getenv("FALKORDB_USERNAME") or None
    falkordb_password: str | None = os.getenv("FALKORDB_PASSWORD") or None
    # Any OpenAI-compatible endpoint; defaults to Fireworks.
    llm_base_url: str = os.getenv("LORE_LLM_BASE_URL", "https://api.fireworks.ai/inference/v1")
    llm_api_key: str | None = os.getenv("FIREWORKS_API_KEY") or os.getenv("LORE_LLM_API_KEY") or None
    # Picked by bake-off on the PR #482 investigation (correct root cause, decision and pager; fastest).
    agent_model: str = os.getenv("LORE_AGENT_MODEL", "accounts/fireworks/models/minimax-m3")
    fast_model: str = os.getenv("LORE_FAST_MODEL", "accounts/fireworks/models/glm-5p3-flash")
    # All LLM-generated seed/dummy data uses this model (team decision). Thinking-only: give it >=2k max_tokens.
    datagen_model: str = os.getenv("LORE_DATAGEN_MODEL", "accounts/fireworks/models/glm-5p3-flash")
    embed_model: str = os.getenv("LORE_EMBED_MODEL", "accounts/fireworks/models/qwen3-embedding-8b")
    embed_dims: int = int(os.getenv("LORE_EMBED_DIMS", "1024"))
    # Local Whisper model for voice input in Lore World (faster-whisper; downloaded on first use).
    stt_model: str = os.getenv("LORE_STT_MODEL", "base.en")
    # Sandbox (E2B) and GitHub access for the agent.
    e2b_api_key: str | None = os.getenv("E2B_API_KEY") or None
    e2b_template: str | None = os.getenv("LORE_E2B_TEMPLATE") or None  # None = E2B's default template
    github_token: str | None = os.getenv("GITHUB_TOKEN") or os.getenv("GH_TOKEN") or None
    # Slack bot (Socket Mode). The workspace is bound to one tenant.
    slack_bot_token: str | None = os.getenv("SLACK_BOT_TOKEN") or None
    slack_app_token: str | None = os.getenv("SLACK_APP_TOKEN") or None
    slack_tenant: str = os.getenv("LORE_SLACK_TENANT", os.getenv("LORE_DEFAULT_TENANT", "northwind"))
    slack_incident_channel: str = os.getenv("LORE_SLACK_INCIDENT_CHANNEL", "incidents")
    web_url: str = os.getenv("LORE_WEB_URL", "http://localhost:3000")
    # Shared secret for monitoring webhooks (?token=...). Empty = no check (local dev only).
    webhook_token: str | None = os.getenv("LORE_WEBHOOK_TOKEN") or None
    sentry_dsn: str | None = os.getenv("SENTRY_DSN") or None
    default_tenant: str = os.getenv("LORE_DEFAULT_TENANT", "northwind")
    query_timeout_ms: int = int(os.getenv("LORE_QUERY_TIMEOUT_MS", "5000"))


settings = Settings()
