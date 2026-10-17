"use client";

import { use, useEffect, useState } from "react";
import { AnswerText } from "@/components/AnswerText";
import { useAppState } from "@/components/AppState";
import { Avatar } from "@/components/Avatar";
import { EvidenceGraph } from "@/components/EvidenceGraph";
import { IconChevronDown, IconCode, IconGraph, Spinner } from "@/components/Icons";
import { toolMeta } from "@/components/ToolSteps";
import { api, ago, type Answer } from "@/lib/api";

export default function AnswerPermalink({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { tenant: stateTenant, people } = useAppState();
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [graphOpen, setGraphOpen] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t") ?? stateTenant;
    api<Answer>(`/api/answers/${id}?tenant=${t}`).then(setAnswer).catch((e) => setError(String(e.message ?? e)));
  }, [id, stateTenant]);

  if (error)
    return (
      <div className="grid h-full place-items-center p-6">
        <p className="rounded-xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3 text-sm text-red-300">{error}</p>
      </div>
    );
  if (!answer)
    return (
      <div className="grid h-full place-items-center text-zinc-500">
        <Spinner size={18} />
      </div>
    );

  const asker = people.find((p) => p.id === answer.user);
  const focus = focusId ? [focusId] : answer.citations.map((c) => c.id);
  const cite = (cid: string) => {
    setGraphOpen(true);
    setFocusId(cid);
  };

  return (
    <div className="flex h-full min-h-0">
      <section className="min-w-0 flex-1 overflow-y-auto">
        <article className="mx-auto max-w-3xl space-y-8 px-4 py-10 sm:px-8">
          <header className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-zinc-500">
              <Avatar name={asker?.name ?? answer.user} seed={answer.user} size={20} />
              <span className="text-zinc-300">{asker?.name ?? answer.user}</span>
              <span className="text-zinc-700">·</span>
              <span>{ago(answer.ts)}</span>
              <span className="text-zinc-700">·</span>
              <span>{answer.tool_calls} tool calls</span>
              <span className="ml-auto font-mono text-[11px] text-zinc-600">{answer.id}</span>
            </div>
            <h1 className="text-2xl font-semibold leading-snug tracking-tight text-zinc-50">{answer.question}</h1>
          </header>

          <AnswerText text={answer.answer} citations={answer.citations} active={graphOpen ? focusId : null} onCite={cite} />

          {answer.evidence.nodes.length > 0 && (
            <button
              type="button"
              onClick={() => setGraphOpen((o) => !o)}
              className={`-ml-2.5 flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] transition-colors ${
                graphOpen ? "bg-amber-400/10 text-amber-200" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
              }`}
            >
              <IconGraph size={14} />
              {graphOpen ? "Hide evidence graph" : "View evidence graph"}
              <span className="font-mono text-[11px] tabular-nums text-zinc-500">{answer.evidence.nodes.length}</span>
            </button>
          )}

          {answer.trace.length > 0 && (
            <section className="space-y-3 border-t border-line pt-8">
              <h2 className="text-[13px] font-medium text-zinc-300">How Lore got here</h2>
              <ol className="space-y-1.5">
                {answer.trace.map((s, i) => {
                  const meta = toolMeta(s.tool);
                  const Icon = meta.icon;
                  return (
                    <li key={i} className="rounded-xl border border-line bg-surface/60">
                      <details className="group">
                        <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5">
                          <span className="w-5 text-right font-mono text-[11px] tabular-nums text-zinc-600">{i + 1}</span>
                          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-sky-400/10 text-sky-300 ring-1 ring-sky-400/20">
                            <Icon size={13} />
                          </span>
                          <span className="shrink-0 text-[13px] font-medium text-zinc-200">{meta.label}</span>
                          <span className="min-w-0 truncate font-mono text-[11.5px] text-zinc-500">
                            {Object.entries(s.args)
                              .filter(([, v]) => v !== null && v !== "")
                              .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
                              .join("  ")}
                          </span>
                          {s.cypher.length > 0 && (
                            <span className="ml-auto flex shrink-0 items-center gap-1 text-[11px] text-zinc-500">
                              <IconCode size={12} />
                              {s.cypher.length}
                              <IconChevronDown size={13} className="transition-transform group-open:rotate-180" />
                            </span>
                          )}
                        </summary>
                        {s.cypher.length > 0 && (
                          <div className="space-y-2 border-t border-line p-3">
                            {s.cypher.map((c, j) => (
                              <pre key={j} className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-[#060607] p-3 font-mono text-[11.5px] leading-relaxed text-emerald-300/90 ring-1 ring-line">
                                {c}
                              </pre>
                            ))}
                          </div>
                        )}
                      </details>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
        </article>
      </section>

      {graphOpen && (
        <aside className="animate-slide-in max-lg:fixed max-lg:inset-0 max-lg:z-40 max-lg:bg-canvas/80 max-lg:p-3 max-lg:pt-[68px] max-lg:backdrop-blur-sm lg:w-[46%] lg:max-w-[760px] lg:shrink-0 lg:py-4 lg:pr-4">
          <EvidenceGraph
            evidence={answer.evidence}
            focus={focus}
            selected={focusId}
            sources={answer.citations}
            onSelect={(n) => setFocusId(n?.id ?? null)}
            onClose={() => setGraphOpen(false)}
            title="Evidence"
          />
        </aside>
      )}
    </div>
  );
}
