"""Speech-to-text for Lore World: local Whisper (faster-whisper) on the API host, so voice input works in any
browser or embedded webview, with no cloud speech service and no API key.

The tenant's people and service names are passed as Whisper's initial prompt so domain words ("payments-api",
"Priya", "POOL_SIZE") come out right."""

import asyncio
import io
from functools import lru_cache

import av
import numpy as np
from faster_whisper import WhisperModel

from lore import db
from lore.config import settings


@lru_cache(maxsize=1)
def model() -> WhisperModel:
    return WhisperModel(settings.stt_model, device="cpu", compute_type="int8")


def decode(data: bytes) -> np.ndarray:
    """Any browser recording (webm/opus, ogg, mp4/aac, wav) -> 16 kHz mono float32."""
    chunks = []
    with av.open(io.BytesIO(data)) as container:
        resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
        for frame in container.decode(audio=0):
            chunks += [f.to_ndarray().reshape(-1) for f in resampler.resample(frame)]
        chunks += [f.to_ndarray().reshape(-1) for f in resampler.resample(None)]
    if not chunks:
        return np.zeros(0, np.float32)
    return np.concatenate(chunks).astype(np.float32) / 32768.0


@lru_cache(maxsize=16)
def vocabulary(tenant: str) -> str:
    g = db.brain(tenant)
    people = [r["name"] for r in db.rows(g, "MATCH (p:Person) RETURN p.name AS name LIMIT 80")]
    services = [r["id"] for r in db.rows(g, "MATCH (s:Service) RETURN s.id AS id LIMIT 60")]
    return f"{tenant.capitalize()} engineering. People: {', '.join(people)}. Services: {', '.join(services)}."


def transcribe_sync(data: bytes, tenant: str) -> str:
    audio = decode(data)
    if audio.size < 16000 * 0.3:
        return ""
    segments, _ = model().transcribe(audio, beam_size=1, language="en", vad_filter=True, initial_prompt=vocabulary(tenant))
    return " ".join(s.text.strip() for s in segments).strip()


async def transcribe(data: bytes, tenant: str) -> str:
    return await asyncio.to_thread(transcribe_sync, data, tenant)


async def warm() -> None:
    """Load the model in the background at startup so the first utterance isn't slow."""
    try:
        await asyncio.to_thread(model)
    except Exception:
        pass
