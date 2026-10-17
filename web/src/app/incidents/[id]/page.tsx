"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppState } from "@/components/AppState";
import { EvidenceGraph } from "@/components/EvidenceGraph";
import { IconAlert, IconArrowLeft, IconCheck, IconGraph, Spinner } from "@/components/Icons";
import {
  ActionCard,
  agentName,
  EvidenceChips,
  HypothesisRow,
  MemoryCallout,
  SectionTitle,
  Stepper,
  TeamList,
  Timeline,
} from "@/components/incident/parts";
import { StatusBadge } from "@/components/StatusBadge";
import { applyTerm, type TermLine } from "@/components/Terminal";
import { Activity, applyStep, type Step } from "@/components/ToolSteps";
import { api, ago, mergeEvidence, stream, type Action, type Board, type Evidence, type StreamEvent } from "@/lib/api";

type Ev = Extract<StreamEvent, { type: "event" }>;
const EMPTY: Evidence = { nodes: [], edges: [] };
const VERDICT_ORDER: Record<string, number> = { confirmed: 0, inconclusive: 2, rejected: 3 };

export default function IncidentRoom({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { tenant, person, people } = useAppState();
  const [board, setBoard] = useState<Board | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [term, setTerm] = useState<TermLine[]>([]);
  const [finished, setFinished] = useState<Set<string>>(new Set());
  const [live, setLive] = useState<Evidence>(EMPTY);
  const [findingGraph, setFindingGraph] = useState<Evidence>(EMPTY);
  const [actionError, setActionError] = useState<Record<string, string>>({});
  const [graphOpen, setGraphOpen] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(() => {
    api<Board>(`/api/incidents/${id}?tenant=${tenant}`)
      .then((b) => {
        setBoard(b);
        setEvents((prev) => mergeEvents(prev, b.events));
      })
      .catch(() => {});
  }, [id, tenant]);

  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(refetch, 250);
  }, [refetch]);

  useEffect(() => {
    refetch();
    return stream(`/api/incidents/${id}/stream?tenant=${tenant}`, (e) => {
      if (e.type === "event") {
        setEvents((prev) => mergeEvents(prev, [e]));
        scheduleRefetch();
      } else if (e.type === "tool_call" || e.type === "tool_result") {
        setSteps((s) => applyStep(s, e));
        if (e.type === "tool_result") setLive((l) => mergeEvidence(l, e.evidence));
      } else if (e.type.startsWith("sandbox_")) {
        setTerm((t) => applyTerm(t, e));
      } else if (e.type === "agent_done") {
        setFinished((f) => new Set(f).add(e.agent));
      } else if (e.type === "done") {
        scheduleRefetch();
      }
    });
  }, [id, tenant, refetch, scheduleRefetch]);

  // Pull the subgraph around the findings' evidence so the graph also works after a reload.
  const evidenceIds = useMemo(() => {
    if (!board) return [] as string[];
    return [...new Set([...board.incident.services, ...board.findings.flatMap((f) => f.evidence)])];
  }, [board]);
  useEffect(() => {
    if (!evidenceIds.length) return;
    api<Evidence>(`/api/graph/subgraph?tenant=${tenant}&ids=${encodeURIComponent(evidenceIds.join(","))}`)
      .then(setFindingGraph)
      .catch(() => {});
  }, [evidenceIds, tenant]);

  const evidence = useMemo(() => mergeEvidence(findingGraph, live), [findingGraph, live]);
  const confirmed = board?.findings.filter((f) => f.verdict === "confirmed").sort((a, b) => b.confidence - a.confidence)[0];
  const focus = focusId ? [focusId] : confirmed ? [...confirmed.evidence, ...(board?.incident.services ?? [])] : [];

  const teamDone = events.some((e) => e.kind === "team_done");
  const agents = useMemo(() => {
    const order: string[] = [];
    for (const e of events) if (e.kind === "agent_start" && !order.includes(e.agent)) order.push(e.agent);
    return order.map((a) => {
      const posted = events.some((e) => e.agent === a && ["finding", "action_proposed", "procedure"].includes(e.kind));
      const running = !finished.has(a) && !(teamDone && a !== "scribe") && !(a === "scribe" && posted);
      return { name: a, calls: steps.filter((s) => s.agent === a).length, running };
    });
  }, [events, steps, finished, teamDone]);
  const anyRunning = agents.some((a) => a.running) || board?.actions.some((a) => a.status === "executing");

  const name = useCallback((pid: string) => people.find((p) => p.id === pid)?.name ?? pid, [people]);
  const me = people.find((p) => p.id === person);
  const pick = (eid: string) => {
    setGraphOpen(true);
    setFocusId(eid === focusId ? null : eid);
  };

  async function decide(a: Action, approve: boolean) {
    setActionError((m) => ({ ...m, [a.id]: "" }));
    try {
      await api(`/api/actions/${a.id}/decide`, { method: "POST", body: JSON.stringify({ tenant, person_id: person, approve }) });
      scheduleRefetch();
    } catch (e) {
      setActionError((m) => ({ ...m, [a.id]: String((e as Error).message) }));
    }
  }

  async function resolve() {
    setResolving(true);
    await api(`/api/incidents/${id}/resolve?tenant=${tenant}`, { method: "POST" }).catch(() => {});
    setResolving(false);
    scheduleRefetch();
  }

  if (!board)
    return (
      <div className="grid h-full place-items-center text-zinc-500">
        <Spinner size={18} />
      </div>
    );

  const inc = board.incident;
  const findingFor = (hid: string) => board.findings.find((f) => f.hypothesis_id === hid);
  const hypotheses = [...board.hypotheses].sort(
    (a, b) => (VERDICT_ORDER[findingFor(a.id)?.verdict ?? ""] ?? 1) - (VERDICT_ORDER[findingFor(b.id)?.verdict ?? ""] ?? 1),
  );
  const rootHypothesis = confirmed && board.hypotheses.find((h) => h.id === confirmed.hypothesis_id);
  const pending = board.actions.filter((a) => a.status === "proposed");
  const procedureMatch = events.find((e) => e.kind === "procedure_match");
  const procedure = [...events].reverse().find((e) => e.kind === "procedure");

  return (
    <div className="flex h-full min-h-0">
      <section className="@container min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-8">
          {/* Header */}
          <Link href="/incidents" className="inline-flex items-center gap-1.5 text-[12.5px] text-zinc-500 transition-colors hover:text-zinc-200">
            <IconArrowLeft size={14} /> Incidents
          </Link>
          <header className="mt-4 flex flex-wrap items-start gap-x-6 gap-y-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-zinc-500">
                <span className="rounded-md bg-red-500/15 px-1.5 py-0.5 font-mono text-[11.5px] font-medium text-red-300">{inc.severity}</span>
                <span className="font-mono">{inc.id}</span>
                <StatusBadge status={inc.status} />
                <span className="text-zinc-700">·</span>
                <span className="font-mono text-zinc-400">{inc.services.join(", ")}</span>
                <span className="text-zinc-700">·</span>
                <span>opened {ago(inc.ts)}</span>
                {inc.tool_calls > 0 && (
                  <>
                    <span className="text-zinc-700">·</span>
                    <span>{inc.tool_calls} tool calls</span>
                  </>
                )}
              </div>
              <h1 className="mt-2.5 text-[26px] font-semibold leading-tight tracking-tight text-zinc-50">{inc.title}</h1>
              <p className="mt-1.5 max-w-2xl text-[14.5px] leading-relaxed text-zinc-400">{inc.text}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setGraphOpen((o) => !o)}
                className={`flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] transition-colors ${
                  graphOpen ? "bg-amber-400/10 text-amber-200" : "bg-surface text-zinc-300 hover:bg-elevated hover:text-zinc-50"
                }`}
              >
                <IconGraph size={15} />
                Evidence graph
              </button>
              {inc.status !== "resolved" && (
                <button
                  type="button"
                  onClick={resolve}
                  disabled={resolving}
                  title="Mark resolved; the scribe agent then writes a playbook Lore will reuse next time"
                  className="flex h-9 items-center gap-2 rounded-lg bg-emerald-500 px-3.5 text-[13px] font-medium text-zinc-950 transition-colors hover:bg-emerald-400 disabled:opacity-50"
                >
                  {resolving ? <Spinner size={14} /> : <IconCheck size={15} strokeWidth={2.4} />}
                  Resolve &amp; learn
                </button>
              )}
            </div>
          </header>
          <div className="mt-6 max-w-2xl">
            <Stepper status={inc.status} hasHypotheses={board.hypotheses.length > 0} />
          </div>

          <div className="mt-10 grid gap-12 @4xl:grid-cols-[minmax(0,1fr)_300px]">
            <main className="min-w-0 space-y-12">
              {procedureMatch && <MemoryCallout text={procedureMatch.text} />}

              {/* What happened */}
              <section>
                <SectionTitle>What happened</SectionTitle>
                {confirmed && rootHypothesis ? (
                  <div className="rounded-2xl bg-gradient-to-b from-sky-400/[0.08] to-surface p-5 sm:p-6">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status="root_cause_found" />
                      <span className="text-[12.5px] text-zinc-500">
                        {Math.round(confirmed.confidence * 100)}% confidence · confirmed by {agentName(confirmed.by)}
                      </span>
                    </div>
                    <p className="mt-3 text-[16.5px] font-medium leading-relaxed text-zinc-50">{rootHypothesis.statement}</p>
                    <p className="mt-3 text-[14px] leading-relaxed text-zinc-400">{confirmed.summary}</p>
                    {confirmed.evidence.length > 0 && (
                      <div className="mt-4">
                        <EvidenceChips ids={confirmed.evidence} evidence={evidence} active={focusId} onPick={pick} />
                      </div>
                    )}
                  </div>
                ) : inc.status === "needs_human" ? (
                  <div className="flex items-start gap-3 rounded-2xl bg-red-500/[0.06] p-5 text-[14px] leading-relaxed text-red-200/90">
                    <IconAlert size={17} className="mt-0.5 shrink-0 text-red-300" />
                    Lore couldn&apos;t confirm a root cause. None of the hypotheses held up against the graph, so this needs a human.
                  </div>
                ) : (
                  <div className="rounded-2xl bg-surface p-5">
                    <p className="text-shimmer text-[15px] font-medium">
                      {board.hypotheses.length
                        ? `Testing ${board.hypotheses.length} hypotheses in parallel…`
                        : "Triage is reading the alert and recent changes…"}
                    </p>
                    <p className="mt-1.5 text-[13.5px] text-zinc-500">The root cause shows up here as soon as an investigator confirms one.</p>
                  </div>
                )}
              </section>

              {/* Decisions */}
              {board.actions.length > 0 && (
                <section>
                  <SectionTitle aside={pending.length ? `${pending.length} waiting · acting as ${me?.name ?? person}` : undefined}>
                    {pending.length ? "Needs your decision" : "Actions"}
                  </SectionTitle>
                  <div className="space-y-3">
                    {board.actions.map((a) => (
                      <ActionCard key={a.id} action={a} me={me} name={name} error={actionError[a.id]} onDecide={(ok) => decide(a, ok)} />
                    ))}
                  </div>
                </section>
              )}

              {/* Hypotheses */}
              {hypotheses.length > 0 && (
                <section>
                  <SectionTitle aside={`${board.findings.length} of ${hypotheses.length} tested`}>Hypotheses</SectionTitle>
                  <div className="space-y-3">
                    {hypotheses.map((h) => (
                      <HypothesisRow
                        key={h.id}
                        h={h}
                        finding={findingFor(h.id)}
                        evidence={evidence}
                        active={focusId}
                        onPick={pick}
                        collapsed={h.id === rootHypothesis?.id}
                      />
                    ))}
                  </div>
                </section>
              )}

              {procedure && (
                <section>
                  <SectionTitle>Playbook saved</SectionTitle>
                  <MemoryCallout text={procedure.text} />
                </section>
              )}
            </main>

            <aside className="min-w-0 space-y-10 @4xl:sticky @4xl:top-6 @4xl:self-start">
              <section>
                <SectionTitle>Agent team</SectionTitle>
                <TeamList agents={agents} />
              </section>
              {(steps.length > 0 || term.length > 0 || anyRunning) && (
                <section>
                  <SectionTitle>Tool calls</SectionTitle>
                  <Activity steps={steps} term={term} running={!!anyRunning} showAgent idle="Working…" />
                  {!steps.length && !anyRunning && inc.tool_calls > 0 && (
                    <p className="text-[12.5px] text-zinc-600">{inc.tool_calls} calls; the live log isn&apos;t kept after a restart.</p>
                  )}
                </section>
              )}
              <section>
                <SectionTitle>Timeline</SectionTitle>
                <Timeline events={events} />
              </section>
            </aside>
          </div>
        </div>
      </section>

      {graphOpen && (
        <aside className="animate-slide-in max-lg:fixed max-lg:inset-0 max-lg:z-40 max-lg:bg-canvas/80 max-lg:p-3 max-lg:pt-[68px] max-lg:backdrop-blur-sm lg:w-[44%] lg:max-w-[720px] lg:shrink-0 lg:py-4 lg:pr-4">
          <EvidenceGraph
            evidence={evidence}
            focus={focus}
            selected={focusId}
            onSelect={(n) => setFocusId(n?.id ?? null)}
            onClose={() => setGraphOpen(false)}
            empty="Agents' graph queries will appear here."
          />
        </aside>
      )}
    </div>
  );
}

function mergeEvents(prev: Ev[], incoming: Ev[]): Ev[] {
  const bySeq = new Map(prev.map((e) => [e.seq, e]));
  for (const e of incoming) if (e.seq != null) bySeq.set(e.seq, e);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}
