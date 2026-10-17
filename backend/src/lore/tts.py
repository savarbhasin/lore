"""Neural text-to-speech for Lore World via Microsoft Edge's online voices (edge-tts, no API key).

Returns mp3 audio plus word timings so captions can follow the voice. Lore has a fixed voice; every person gets a
stable voice picked from the pool by hashing their id."""

import asyncio
import base64
import hashlib
from collections import OrderedDict

import edge_tts

LORE_VOICE = "en-US-AvaMultilingualNeural"
VOICES = [
    "en-US-AndrewMultilingualNeural",
    "en-US-EmmaMultilingualNeural",
    "en-US-BrianMultilingualNeural",
    "en-GB-SoniaNeural",
    "en-GB-RyanNeural",
    "en-AU-NatashaNeural",
    "en-AU-WilliamNeural",
    "en-IN-NeerjaNeural",
    "en-IN-PrabhatNeural",
    "en-US-JennyNeural",
    "en-US-GuyNeural",
    "en-CA-ClaraNeural",
    "en-CA-LiamNeural",
    "en-IE-EmilyNeural",
    "en-IE-ConnorNeural",
]
ALLOWED = {LORE_VOICE, *VOICES}

_cache: OrderedDict[tuple[str, str, str], dict] = OrderedDict()
_CACHE_SIZE = 256
_slots = asyncio.Semaphore(6)


def voice_for(speaker: str | None) -> str:
    if not speaker or speaker == "lore":
        return LORE_VOICE
    return VOICES[int(hashlib.sha1(speaker.encode()).hexdigest(), 16) % len(VOICES)]


async def synthesize(text: str, voice: str, rate: str = "+6%") -> dict:
    key = (voice, rate, text)
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key]
    audio = bytearray()
    words: list[dict] = []
    async with _slots:
        async for chunk in edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary").stream():
            if chunk["type"] == "audio":
                audio.extend(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                words.append({"ms": round(chunk["offset"] / 10_000), "text": chunk["text"]})
    out = {"voice": voice, "audio": base64.b64encode(bytes(audio)).decode(), "words": words}
    _cache[key] = out
    if len(_cache) > _CACHE_SIZE:
        _cache.popitem(last=False)
    return out
