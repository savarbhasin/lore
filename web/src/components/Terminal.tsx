"use client";

import { useEffect, useRef } from "react";

export type TermLine =
  | { kind: "cmd"; text: string }
  | { kind: "out"; text: string; stderr?: boolean }
  | { kind: "exit"; code: number; ms: number }
  | { kind: "status"; text: string };

/** Fold sandbox_* stream events into terminal lines. Returns the same array if the event isn't a sandbox event. */
export function applyTerm(lines: TermLine[], e: { type: string; [k: string]: unknown }): TermLine[] {
  switch (e.type) {
    case "sandbox_status":
      return [
        ...lines,
        {
          kind: "status",
          text:
            e.status === "ready" ? `sandbox ready (${e.sandbox_id}, ${e.ms}ms)` : e.status === "unavailable" ? `sandbox unavailable: ${e.error}` : "starting E2B sandbox…",
        },
      ];
    case "sandbox_cmd":
      return [...lines, { kind: "cmd", text: String(e.cmd) }];
    case "sandbox_out":
      return [...lines, ...String(e.text).replace(/\n$/, "").split("\n").map((t) => ({ kind: "out" as const, text: t, stderr: e.stream === "stderr" }))].slice(-1500);
    case "sandbox_exit":
      return [...lines, { kind: "exit", code: Number(e.exit_code), ms: Number(e.ms) }];
    default:
      return lines;
  }
}

export function Terminal({ lines, className = "" }: { lines: TermLine[]; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Scroll the terminal itself, never the page around it.
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines.length]);
  if (!lines.length) return null;
  return (
    <div ref={box} className={`overflow-y-auto rounded-lg border border-line bg-[#060607] font-mono text-[11.5px] leading-relaxed ${className}`}>
      <div className="sticky top-0 flex items-center gap-2 border-b border-line bg-[#0b0b0d]/95 px-3 py-1.5 text-[10.5px] text-zinc-500 backdrop-blur">
        <span className="flex gap-1">
          <span className="h-2 w-2 rounded-full bg-zinc-700" />
          <span className="h-2 w-2 rounded-full bg-zinc-700" />
          <span className="h-2 w-2 rounded-full bg-zinc-700" />
        </span>
        <span className="ml-1 font-medium tracking-wide">sandbox</span>
        <span className="text-zinc-600">e2b</span>
        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px] shadow-emerald-500" />
      </div>
      <div className="p-3 pt-1.5">
      {lines.map((l, i) =>
        l.kind === "cmd" ? (
          <div key={i} className="mt-1 whitespace-pre-wrap break-all text-emerald-300">
            <span className="text-zinc-500">$ </span>
            {l.text}
          </div>
        ) : l.kind === "out" ? (
          <div key={i} className={`whitespace-pre-wrap break-all ${l.stderr ? "text-amber-200/70" : "text-zinc-300"}`}>
            {l.text}
          </div>
        ) : l.kind === "exit" ? (
          <div key={i} className={l.code === 0 ? "text-zinc-600" : "text-red-400"}>
            [exit {l.code} · {l.ms}ms]
          </div>
        ) : (
          <div key={i} className="text-sky-400/80">
            {l.text}
          </div>
        ),
      )}
      </div>
    </div>
  );
}
