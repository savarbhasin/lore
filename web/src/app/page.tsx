"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnswerText } from "@/components/AnswerText";
import { useAppState } from "@/components/AppState";
import { Composer } from "@/components/Composer";
import { EvidenceGraph } from "@/components/EvidenceGraph";
import { IconAlert, IconBranch, IconCheck, IconCopy, IconGraph, IconHistory, IconLink, IconPlus, IconTerminal, IconUsers } from "@/components/Icons";
import { applyTerm, type TermLine } from "@/components/Terminal";
import { Activity, applyStep, type Step } from "@/components/ToolSteps";
import { api, mergeEvidence, stream, type Evidence, type Source } from "@/lib/api";

type Turn = {
  question: string;
  answerId?: string;
  steps: Step[];
  term: TermLine[];
  evidence: Evidence;
  text?: string;
  citations: Source[];
  status: "thinking" | "done" | "error";
  error?: string;
  retries: number;
};

type Suggestion = { label: string; text: string; icon: (p: { size?: number }) => React.ReactNode };

const SUGGESTIONS: Record<string, Suggestion[]> = {
  northwind: [
    { label: "Why is the payments DB pool 32?", text: "Why does payments-api keep its DB pool at 32, and who should I ask this week?", icon: IconBranch },
    { label: "What changed in checkout lately?", text: "What changed in checkout's dependencies in the last 6 hours?", icon: IconHistory },
    { label: "Who owned notifications in April?", text: "Who owned notifications in April, and why did it move?", icon: IconUsers },
    { label: "Which services have a bus factor of 1?", text: "Which services have a bus factor of 1?", icon: IconAlert },
    { label: "Does POOL_SIZE match decision D-17?", text: "Clone the payments-api code and check whether POOL_SIZE matches decision D-17.", icon: IconTerminal },
  ],
  acme: [
    { label: "Who knows the telemetry service?", text: "Who knows the telemetry service?", icon: IconUsers },
    { label: "Why is telemetry compressed with zstd?", text: "Why is telemetry compressed with zstd?", icon: IconBranch },
  ],
};

const EMPTY: Evidence = { nodes: [], edges: [] };
const newSession = () => `web:${Math.random().toString(36).slice(2, 10)}`;

export default function AskPage() {
  const { tenant, person, people } = useAppState();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [graphTurn, setGraphTurn] = useState<number | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const session = useRef(newSession());
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const closers = useRef<(() => void)[]>([]);

  function reset() {
    closers.current.forEach((c) => c());
    closers.current = [];
    setTurns([]);
    setGraphTurn(null);
    setFocusId(null);
    session.current = newSession();
  }

  useEffect(() => {
    // New tenant or identity -> new conversation.
    reset();
  }, [tenant, person]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const update = (i: number, f: (t: Turn) => Turn) => setTurns((ts) => ts.map((t, j) => (j === i ? f(t) : t)));
  const busy = turns.some((t) => t.status === "thinking");

  async function send(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setInput("");
    stick.current = true;
    const i = turns.length;
    setTurns((ts) => [...ts, { question, steps: [], term: [], evidence: EMPTY, citations: [], status: "thinking", retries: 0 }]);
    try {
      const { answer_id } = await api<{ answer_id: string }>("/api/ask", {
        method: "POST",
        body: JSON.stringify({ tenant, user: person, question, session_id: session.current, surface: "web" }),
      });
      update(i, (t) => ({ ...t, answerId: answer_id }));
      const close = stream(`/api/answers/${answer_id}/stream`, (e) => {
        if (e.type === "tool_call" || e.type === "tool_result") {
          update(i, (t) => ({
            ...t,
            steps: applyStep(t.steps, e),
            evidence: e.type === "tool_result" ? mergeEvidence(t.evidence, e.evidence) : t.evidence,
          }));
        } else if (e.type.startsWith("sandbox_")) {
          update(i, (t) => ({ ...t, term: applyTerm(t.term, e) }));
        } else if (e.type === "grounding_retry") {
          update(i, (t) => ({ ...t, retries: t.retries + 1 }));
        } else if (e.type === "done") {
          update(i, (t) => ({
            ...t,
            status: "done",
            text: e.answer,
            citations: e.citations ?? [],
            evidence: e.evidence ? mergeEvidence(t.evidence, e.evidence) : t.evidence,
          }));
        } else if (e.type === "error") {
          update(i, (t) => ({ ...t, status: "error", error: e.error }));
        }
      });
      closers.current.push(close);
    } catch (err) {
      update(i, (t) => ({ ...t, status: "error", error: String((err as Error).message ?? err) }));
    }
  }

  function openGraph(i: number, id: string | null = null) {
    setGraphTurn(i);
    setFocusId(id);
  }

  const shown = graphTurn !== null ? turns[graphTurn] : undefined;
  const focus = useMemo(() => {
    if (!shown) return [];
    return focusId ? [focusId] : shown.citations.map((c) => c.id);
  }, [shown, focusId]);

  const me = people.find((p) => p.id === person);
  const placeholder = `Ask about ${tenant}'s people, code, decisions, incidents…`;

  if (turns.length === 0) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-center px-4 py-12 sm:px-6">
          <div className="animate-fade-in text-center">
            <h1 className="text-balance text-[30px] font-semibold leading-tight tracking-tight text-zinc-50 sm:text-[36px]">
              What do you want to know about <span className="capitalize text-amber-300">{tenant}</span>?
            </h1>
            <p className="mx-auto mt-3 max-w-lg text-[15px] text-zinc-500">
              Lore answers from the company knowledge graph. Every claim cites the PR, decision, doc or thread it came from.
            </p>
          </div>
          <div className="mt-10 animate-fade-in">
            <Composer value={input} onChange={setInput} onSubmit={() => send(input)} busy={busy} placeholder={placeholder} autoFocus size="lg" />
            <ContextLine tenant={tenant} name={me?.name} />
          </div>
          <div className="mt-8 flex animate-fade-in flex-wrap justify-center gap-2.5 lg:-mx-24">
            {(SUGGESTIONS[tenant] ?? []).map(({ label, text, icon: Icon }) => (
              <button
                key={label}
                onClick={() => send(text)}
                title={text}
                className="group flex h-10 items-center gap-2.5 rounded-full bg-surface pl-3.5 pr-4 text-[13.5px] text-zinc-300 transition-colors hover:bg-elevated hover:text-zinc-50"
              >
                <span className="text-zinc-500 transition-colors group-hover:text-amber-300">
                  <Icon size={15} />
                </span>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <section className="flex min-w-0 flex-1 flex-col">
        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div className="mx-auto max-w-3xl space-y-10 px-4 pb-10 pt-8 sm:px-8">
            {turns.map((t, i) => (
              <div key={i} className="space-y-5">
                <div className="flex animate-fade-in justify-end pl-10 sm:pl-24">
                  <div className="whitespace-pre-wrap rounded-2xl rounded-br-md bg-overlay px-4 py-2.5 text-[15px] leading-relaxed text-zinc-100 ring-1 ring-white/[0.06]">
                    {t.question}
                  </div>
                </div>
                <div className="flex animate-fade-in gap-3.5 pr-2 sm:pr-10">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-amber-300 to-amber-500">
                    <span className="h-2 w-2 rounded-full bg-zinc-950" />
                  </span>
                  <div className="min-w-0 flex-1 space-y-3 pt-1">
                    <Activity steps={t.steps} term={t.term} running={t.status === "thinking"} />
                    {t.text && (
                      <AnswerText
                        text={t.text}
                        citations={t.citations}
                        active={graphTurn === i ? focusId : null}
                        onCite={(id) => openGraph(i, id)}
                      />
                    )}
                    {t.error && (
                      <div className="flex items-start gap-2.5 rounded-xl border border-red-500/20 bg-red-500/[0.06] px-3.5 py-3 text-sm text-red-300">
                        <IconAlert size={16} className="mt-0.5 shrink-0" />
                        <span className="min-w-0 break-words">{t.error}</span>
                      </div>
                    )}
                    {t.status === "done" && (
                      <AnswerActions
                        turn={t}
                        tenant={tenant}
                        graphOpen={graphTurn === i}
                        onGraph={() => (graphTurn === i ? setGraphTurn(null) : openGraph(i))}
                      />
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="shrink-0 px-4 pb-4 sm:px-8">
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <button
              type="button"
              onClick={reset}
              title="New conversation"
              aria-label="New conversation"
              className="mb-1 grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-surface text-zinc-400 transition-colors hover:border-line-strong hover:text-zinc-100"
            >
              <IconPlus size={17} />
            </button>
            <div className="min-w-0 flex-1">
              <Composer value={input} onChange={setInput} onSubmit={() => send(input)} busy={busy} placeholder={placeholder} autoFocus />
            </div>
          </div>
        </div>
      </section>

      {shown && (
        <aside className="animate-slide-in max-lg:fixed max-lg:inset-0 max-lg:z-40 max-lg:bg-canvas/80 max-lg:p-3 max-lg:pt-[68px] max-lg:backdrop-blur-sm lg:w-[46%] lg:max-w-[760px] lg:shrink-0 lg:py-4 lg:pr-4">
          <EvidenceGraph
            evidence={shown.evidence}
            focus={focus}
            selected={focusId}
            sources={shown.citations}
            onSelect={(n) => setFocusId(n?.id ?? null)}
            onClose={() => setGraphTurn(null)}
            title="Evidence"
          />
        </aside>
      )}
    </div>
  );
}

function ContextLine({ tenant, name }: { tenant: string; name?: string }) {
  return (
    <p className="mt-2.5 text-center text-[12px] text-zinc-600">
      Searching <span className="capitalize text-zinc-400">{tenant}</span>&apos;s graph
      {name && (
        <>
          {" "}as <span className="text-zinc-400">{name}</span>
        </>
      )}
      <span className="mx-1.5 text-zinc-700">·</span>
      <kbd className="font-sans">Enter</kbd> to send, <kbd className="font-sans">Shift + Enter</kbd> for a new line
    </p>
  );
}

function AnswerActions({ turn, tenant, graphOpen, onGraph }: { turn: Turn; tenant: string; graphOpen: boolean; onGraph: () => void }) {
  const [copied, setCopied] = useState(false);
  const btn = "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] transition-colors";
  return (
    <div className="-mx-2.5 flex flex-wrap items-center gap-1">
      {turn.evidence.nodes.length > 0 && (
        <button
          type="button"
          onClick={onGraph}
          className={`${btn} ${graphOpen ? "bg-amber-400/10 text-amber-200" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"}`}
        >
          <IconGraph size={14} />
          {graphOpen ? "Hide evidence graph" : "View evidence graph"}
          <span className="font-mono text-[11px] tabular-nums text-zinc-500">{turn.evidence.nodes.length}</span>
        </button>
      )}
      {turn.retries > 0 && (
        <span className="px-2.5 text-[12px] text-zinc-600" title="Lore's grounding check rejected an earlier draft for unsupported claims">
          Re-grounded {turn.retries}×
        </span>
      )}
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(turn.text ?? "").then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className={`${btn} text-zinc-400 hover:bg-white/5 hover:text-zinc-100`}
        >
          {copied ? <IconCheck size={14} className="text-emerald-400" /> : <IconCopy size={14} />}
          {copied ? "Copied" : "Copy"}
        </button>
        {turn.answerId && (
          <Link href={`/a/${turn.answerId}?t=${tenant}`} className={`${btn} text-zinc-400 hover:bg-white/5 hover:text-zinc-100`}>
            <IconLink size={14} />
            Permalink
          </Link>
        )}
      </div>
    </div>
  );
}
