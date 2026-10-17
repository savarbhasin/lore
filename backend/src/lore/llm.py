import re
from functools import lru_cache

from openai import AsyncOpenAI

from lore.config import settings

_THINK = re.compile(r"<think>.*?</think>", re.S)
_OPEN_CITE = re.compile(r"\[([A-Za-z][\w:./-]*)\s*$")


@lru_cache(maxsize=1)
def client() -> AsyncOpenAI:
    if not settings.llm_api_key:
        raise RuntimeError("FIREWORKS_API_KEY is not set (graph-hack/.env)")
    return AsyncOpenAI(base_url=settings.llm_base_url, api_key=settings.llm_api_key)


def clean(text: str | None) -> str:
    """Strip inline reasoning some open models emit in content, and close a trailing citation bracket that the
    provider sometimes drops at the very end of a message ("... [arjun")."""
    return _OPEN_CITE.sub(r"[\1]", _THINK.sub("", text or "").strip())


async def embed(texts: list[str]) -> list[list[float]]:
    r = await client().embeddings.create(model=settings.embed_model, input=texts, dimensions=settings.embed_dims)
    return [d.embedding for d in r.data]
