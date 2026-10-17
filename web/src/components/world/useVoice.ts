"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API, api } from "@/lib/api";

const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

/**
 * Push-to-talk voice input: records the mic while the key/button is held, then transcribes it with Whisper on
 * the Lore API (/api/stt). Works in any browser or embedded webview, unlike the Web Speech API, which needs
 * Google's cloud service and fails with "network" outside Chrome.
 */
export function useSpeechInput(onFinal: (text: string) => void, tenant: string) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const wantStop = useRef(false);
  const startedAt = useRef(0);
  const handler = useRef(onFinal);

  useEffect(() => {
    handler.current = onFinal;
  }, [onFinal]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined");
    return () => stream.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const transcribe = useCallback(
    async (blob: Blob) => {
      setInterim("Transcribing…");
      try {
        const form = new FormData();
        form.append("audio", blob, `speech.${blob.type.includes("mp4") ? "mp4" : blob.type.includes("ogg") ? "ogg" : "webm"}`);
        form.append("tenant", tenant);
        const r = await fetch(`${API}/api/stt`, { method: "POST", body: form });
        const body = (await r.json().catch(() => ({}))) as { text?: string; detail?: string };
        if (!r.ok) throw new Error(body.detail ?? r.statusText);
        const text = (body.text ?? "").trim();
        if (text) handler.current(text);
        else setError("Didn't catch that — hold the key a little longer");
      } catch (e) {
        setError(`Transcription failed: ${(e as Error).message}`);
      } finally {
        setInterim("");
        setListening(false);
      }
    },
    [tenant],
  );

  const start = useCallback(async () => {
    if (recorder.current || listening) return;
    setError(null);
    setInterim("Listening…");
    setListening(true);
    wantStop.current = false;
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    } catch (e) {
      const name = (e as DOMException).name;
      setError(name === "NotAllowedError" ? "Microphone access was blocked" : name === "NotFoundError" ? "No microphone found" : "Couldn't open the microphone");
      setListening(false);
      setInterim("");
      return;
    }
    const mimeType = MIME_TYPES.find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(stream.current, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = () => {
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
      recorder.current = null;
      const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
      if (Date.now() - startedAt.current < 350 || blob.size < 1200) {
        setError("Hold the key while you speak");
        setListening(false);
        setInterim("");
        return;
      }
      void transcribe(blob);
    };
    recorder.current = rec;
    startedAt.current = Date.now();
    rec.start(250);
    if (wantStop.current) rec.stop();
  }, [listening, transcribe]);

  const stop = useCallback(() => {
    wantStop.current = true;
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  return { supported, listening, interim, error, start, stop };
}

function pickVoice(voices: SpeechSynthesisVoice[]) {
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  const prefs = ["Google UK English Female", "Samantha", "Google US English", "Microsoft Aria", "Karen", "Daniel"];
  for (const p of prefs) {
    const v = en.find((x) => x.name.includes(p));
    if (v) return v;
  }
  return en[0] ?? voices[0] ?? null;
}

/** Text-to-speech with a progress callback (character index) so captions can follow the voice. */
export function useSpeechOutput() {
  const [speaking, setSpeaking] = useState(false);
  const voice = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const load = () => (voice.current = pickVoice(window.speechSynthesis.getVoices()));
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", load);
      window.speechSynthesis.cancel();
    };
  }, []);

  const cancel = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback((text: string, onProgress: (chars: number) => void, onEnd: () => void) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      onEnd();
      return false;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voice.current) u.voice = voice.current;
    u.rate = 1.04;
    u.pitch = 1.02;
    u.onboundary = (e) => onProgress(e.charIndex + (e.charLength || 0));
    u.onstart = () => setSpeaking(true);
    u.onend = () => {
      setSpeaking(false);
      onProgress(text.length);
      onEnd();
    };
    u.onerror = () => {
      setSpeaking(false);
      onEnd();
    };
    window.speechSynthesis.speak(u);
    return true;
  }, []);

  return { speaking, speak, cancel };
}

/** What gets read aloud: citations are shown as chips on screen, so they're dropped; no markdown, no paths. */
export function speakable(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1")
    .replace(/\s*\[([^\[\]\n]{1,160})\]/g, (whole, inner: string) =>
      inner.split(",").every((x) => /^[A-Za-z][\w:./-]*$/.test(x.trim())) ? "" : whole,
    )
    .replace(/file:[\w./-]*\/([\w.-]+)/g, "$1")
    .replace(/[*`|]+/g, "")
    .replace(/(^|\s)_+|_+(?=\s|[.,;:!?]|$)/g, "$1")
    .replace(/^\s*[#>]+\s*/gm, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\n{2,}/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

type Chunk = { text: string; start: number };
type Synth = { audio: string; words: { ms: number; text: string }[] };

/** Split speech into sentence-sized chunks (with their offsets) so the first one starts playing quickly. */
function chunks(text: string): Chunk[] {
  const out: Chunk[] = [];
  const re = /[^.!?\n]+(?:[.!?]+["')\]]*|\n|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!m[0].trim()) {
      if (m.index === re.lastIndex) re.lastIndex++;
      continue;
    }
    const last = out.at(-1);
    if (last && (last.text.length < 40 || m[0].trim().length < 18) && last.text.length + m[0].length < 320) last.text += m[0];
    else out.push({ text: m[0], start: m.index });
  }
  return out.filter((c) => c.text.trim());
}

/**
 * Neural voices from the Lore API (/api/tts). Sentences are synthesized in parallel and played in order; captions
 * follow the word timings, and `level` exposes the live loudness for mouth and glow animation. Falls back to the
 * browser's own voice if the TTS service is unreachable.
 */
export function useNeuralSpeech() {
  const browser = useSpeechOutput();
  const { cancel: browserCancel, speak: browserSpeak } = browser;
  const [speaking, setSpeaking] = useState(false);
  const level = useRef(0);
  const gen = useRef(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);

  const cancel = useCallback(() => {
    gen.current++;
    audio.current?.pause();
    audio.current = null;
    level.current = 0;
    browserCancel();
    setSpeaking(false);
  }, [browserCancel]);

  useEffect(() => () => cancel(), [cancel]);

  const speak = useCallback(
    (text: string, speaker: string, onProgress: (chars: number) => void, onEnd: () => void) => {
      cancel();
      const my = gen.current;
      const parts = chunks(text);
      if (!parts.length) {
        onEnd();
        return;
      }
      if (!ctx.current && typeof AudioContext !== "undefined") {
        ctx.current = new AudioContext();
        analyser.current = ctx.current.createAnalyser();
        analyser.current.fftSize = 512;
        analyser.current.connect(ctx.current.destination);
      }
      void ctx.current?.resume();
      const jobs = parts.map((c) => api<Synth>("/api/tts", { method: "POST", body: JSON.stringify({ text: c.text, speaker }) }).catch(() => null));
      setSpeaking(true);

      const play = (synth: Synth, chunk: Chunk) =>
        new Promise<void>((resolve) => {
          const el = new Audio(`data:audio/mpeg;base64,${synth.audio}`);
          audio.current = el;
          if (ctx.current && analyser.current) {
            try {
              ctx.current.createMediaElementSource(el).connect(analyser.current);
            } catch {}
          }
          // Map each spoken word to its position in the caption text.
          const marks: { ms: number; end: number }[] = [];
          let cursor = 0;
          for (const w of synth.words) {
            const at = chunk.text.indexOf(w.text, cursor);
            if (at >= 0) cursor = at + w.text.length;
            marks.push({ ms: w.ms, end: chunk.start + cursor });
          }
          const buf = new Uint8Array(256);
          const tick = () => {
            if (my !== gen.current || audio.current !== el) return resolve();
            const t = el.currentTime * 1000;
            let reached = chunk.start;
            for (const m of marks) if (m.ms <= t) reached = m.end;
            onProgress(reached);
            if (analyser.current) {
              analyser.current.getByteTimeDomainData(buf);
              let sum = 0;
              for (const v of buf) sum += ((v - 128) / 128) ** 2;
              level.current = Math.min(1, Math.sqrt(sum / buf.length) * 5);
            }
            if (!el.ended) requestAnimationFrame(tick);
          };
          el.onended = () => {
            onProgress(chunk.start + chunk.text.length);
            level.current = 0;
            resolve();
          };
          el.onerror = () => resolve();
          el.play().then(
            () => requestAnimationFrame(tick),
            () => resolve(),
          );
        });

      void (async () => {
        for (let i = 0; i < parts.length; i++) {
          const synth = await jobs[i];
          if (my !== gen.current) return;
          if (!synth) {
            // Service unreachable: let the browser voice read the rest.
            const offset = parts[i].start;
            browserSpeak(
              text.slice(offset),
              (c) => onProgress(offset + c),
              () => {
                if (my === gen.current) setSpeaking(false);
                onEnd();
              },
            );
            return;
          }
          await play(synth, parts[i]);
        }
        if (my !== gen.current) return;
        setSpeaking(false);
        onProgress(text.length);
        onEnd();
      })();
    },
    [cancel, browserSpeak],
  );

  return { speaking: speaking || browser.speaking, speak, cancel, level };
}
