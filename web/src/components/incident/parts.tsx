"use client";

import type { Action, Evidence, Finding, Hypothesis, Person, StreamEvent } from "@/lib/api";
import { ago } from "@/lib/api";
import { LABEL_COLORS } from "@/lib/colors";
import { Avatar } from "../Avatar";
import { IconBell, IconBolt, IconBranch, IconBrain, IconCheck, IconChevronDown, IconMessage } from "../Icons";
import { StatusBadge } from "../StatusBadge";

type Ev = Extract<StreamEvent, { type: "event" }>;

export function agentName(agent: string) {
  return agent.replace(/-(\d+)$/, " $1").replace(/^\w/, (c) => c.toUpperCase());
}

export function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline gap-3">
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-zinc-500">{children}</h2>
      {aside && <span className="text-[12.5px] text-zinc-600">{aside}</span>}
    </div>
  );
}

export function EvidenceChips({
  ids,
  evidence,
  active,
  onPick,
}: {
  ids: string[];
  evidence: Evidence;
  active: string | null;
  onPick: (id: string) => void;
}) {
  const labels = new Map(evidence.nodes.map((n) => [n.id, n.label]));
  return (
    <div className="flex flex-wrap gap-1.5">
      {ids.map((id) => {
        const on = active === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onPick(id)}
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-[11.5px] ring-1 transition-colors ${
              on ? "bg-amber-400/15 text-amber-200 ring-amber-400/60" : "bg-white/[0.04] text-zinc-300 ring-white/10 hover:bg-white/[0.08]"
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: LABEL_COLORS[labels.get(id) ?? ""] ?? "#71717a" }} />
            {id.replace(/^file:/, "")}
          </button>
        );
      })}
    </div>
  );
}

const STAGES = ["Triage", "Investigate", "Respond", "Resolve"];

export function Stepper({ status, hasHypotheses }: { status: string; hasHypotheses: boolean }) {
  const current =
    status === "resolved" ? 4 : status === "root_cause_found" || status === "awaiting_approval" ? 2 : hasHypotheses ? 1 : 0;
  const stuck = status === "needs_human";
  return (
    <ol className="flex items-center gap-2">
      {STAGES.map((s, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <li key={s} className="flex min-w-0 flex-1 items-center gap-2">
            <span
              className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold ${
                done
                  ? "bg-emerald-400/15 text-emerald-300"
                  : now
                    ? stuck
                      ? "bg-red-400/15 text-red-300 ring-1 ring-red-400/40"
                      : "bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/40"
                    : "bg-white/[0.05] text-zinc-600"
              }`}
            >
              {done ? <IconCheck size={11} strokeWidth={2.6} /> : i + 1}
            </span>
            <span className={`truncate text-[12.5px] ${done ? "text-zinc-400" : now ? "font-medium text-zinc-100" : "text-zinc-600"}`}>{s}</span>
            {i < STAGES.length - 1 && <span className={`h-px min-w-3 flex-1 ${done ? "bg-emerald-400/30" : "bg-white/[0.07]"}`} />}
          </li>
        );
      })}
    </ol>
  );
}

const KIND: Record<string, { icon: (p: { size?: number }) => React.ReactNode; title: (target: string, name: (id: string) => string) => string }> = {
  page: { icon: IconBell, title: (t, name) => `Page ${name(t)}` },
  open_pr: { icon: IconBranch, title: (t) => `Open a fix PR for ${t}` },
  post_message: { icon: IconMessage, title: (t) => `Post an update to ${t}` },
};

function People({ ids, name }: { ids: string[]; name: (id: string) => string }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {ids.map((id) => (
        <span key={id} className="flex items-center gap-1.5 text-[12.5px] text-zinc-300">
          <Avatar name={name(id)} seed={id} size={18} />
          {name(id)}
        </span>
      ))}
    </span>
  );
}

export function ActionCard({
  action,
  me,
  name,
  error,
  onDecide,
}: {
  action: Action;
  me: Person | undefined;
  name: (id: string) => string;
  error?: string;
  onDecide: (approve: boolean) => void;
}) {
  const kind = KIND[action.kind] ?? { icon: IconBolt, title: (t: string) => `${action.kind.replaceAll("_", " ")} ${t}` };
  const Icon = kind.icon;
  const allowed = !!me && action.approvers.includes(me.id);
  const pending = action.status === "proposed";
  return (
    <div className={`rounded-2xl bg-surface p-4 sm:p-5 ${action.status === "rejected" ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-3.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-zinc-300">
          <Icon size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="text-[15px] font-medium text-zinc-50">{kind.title(action.target, name)}</h3>
            <StatusBadge status={action.status} />
          </div>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-zinc-400">{action.summary}</p>
          {action.reviewers.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-[12px] text-zinc-600">Reviewers</span>
              <People ids={action.reviewers} name={name} />
            </div>
          )}
          {action.result && <ActionResult raw={action.result} />}
          {action.decided_by && (
            <p className="mt-3 text-[12.5px] text-zinc-500">
              {action.status === "rejected" ? "Rejected" : "Approved"} by <span className="text-zinc-300">{name(action.decided_by)}</span>
            </p>
          )}
          {action.status === "executing" && <p className="text-shimmer mt-3 text-[13px] font-medium">Lore is carrying this out…</p>}
        </div>
      </div>
      {pending && (
        <div className="mt-4 flex items-center gap-2 border-t border-line pt-4 sm:pl-[50px]">
          <button
            type="button"
            disabled={!allowed}
            onClick={() => onDecide(true)}
            className="h-8 shrink-0 rounded-lg bg-zinc-50 px-3.5 text-[13px] font-medium text-zinc-950 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-zinc-500"
          >
            Approve
          </button>
          <button
            type="button"
            disabled={!allowed}
            onClick={() => onDecide(false)}
            className="h-8 shrink-0 rounded-lg px-3 text-[13px] text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-zinc-400"
          >
            Reject
          </button>
          <Approvers ids={action.approvers} allowed={allowed} name={name} />
        </div>
      )}
      {error && <p className="mt-3 text-[12.5px] text-red-400 sm:pl-[50px]">{error}</p>}
    </div>
  );
}

function Approvers({ ids, allowed, name }: { ids: string[]; allowed: boolean; name: (id: string) => string }) {
  const others = ids.length - 1;
  return (
    <span
      className="ml-auto flex min-w-0 items-center gap-2 text-[12px] text-zinc-500"
      title={`Can approve (from the graph: owning team + decision owners): ${ids.map(name).join(", ")}`}
    >
      <span className="flex shrink-0 -space-x-1.5">
        {ids.slice(0, 4).map((id) => (
          <span key={id} className="rounded-full ring-2 ring-surface">
            <Avatar name={name(id)} seed={id} size={20} />
          </span>
        ))}
      </span>
      <span className="truncate">
        {allowed ? "You can approve this" : `Only ${name(ids[0] ?? "")}${others > 0 ? ` and ${others} other${others > 1 ? "s" : ""}` : ""} can approve`}
      </span>
    </span>
  );
}

function ActionResult({ raw }: { raw: string }) {
  let r: { pull_requests?: string[]; summary?: string; error?: string; simulated?: boolean; note?: string } = {};
  try {
    r = JSON.parse(raw);
  } catch {
    return <p className="mt-3 font-mono text-[11.5px] text-zinc-500">{raw}</p>;
  }
  return (
    <div className="mt-3 space-y-1.5 rounded-xl bg-black/30 p-3 text-[12.5px]">
      {r.pull_requests?.map((u) => (
        <a key={u} href={u} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 font-mono text-emerald-300 hover:underline">
          <IconBranch size={13} />
          {u.replace("https://github.com/", "")}
        </a>
      ))}
      {r.error && <p className="text-red-400">{r.error}</p>}
      {r.simulated && <p className="text-zinc-500">Simulated: {r.note}</p>}
      {r.summary && <p className="line-clamp-4 leading-relaxed text-zinc-400">{r.summary}</p>}
    </div>
  );
}

const VERDICT_LABEL: Record<string, string> = { confirmed: "Confirmed", rejected: "Ruled out", inconclusive: "Inconclusive" };

export function HypothesisRow({
  h,
  finding,
  evidence,
  active,
  onPick,
  collapsed = false,
}: {
  h: Hypothesis;
  finding?: Finding;
  evidence: Evidence;
  active: string | null;
  onPick: (id: string) => void;
  collapsed?: boolean;
}) {
  const ruledOut = finding?.verdict === "rejected";
  const badge = finding
    ? { status: finding.verdict, label: `${VERDICT_LABEL[finding.verdict] ?? finding.verdict} · ${Math.round(finding.confidence * 100)}%` }
    : h.status === "claimed"
      ? { status: "claimed", label: "Testing" }
      : { status: "open", label: "Queued" };
  return (
    <details className={`group rounded-2xl bg-surface ${ruledOut ? "opacity-70 hover:opacity-100" : ""}`} open={!ruledOut && !collapsed}>
      <summary className="flex cursor-pointer list-none items-start gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <StatusBadge status={badge.status} label={badge.label} />
            {(finding?.by ?? h.claimed_by) && <span className="text-[12px] text-zinc-600">{agentName(finding?.by ?? h.claimed_by!)}</span>}
          </div>
          <p className={`text-[14px] leading-relaxed ${ruledOut ? "text-zinc-400" : "text-zinc-200"}`}>{h.statement}</p>
        </div>
        {finding && <IconChevronDown size={15} className="mt-1 shrink-0 text-zinc-600 transition-transform group-open:rotate-180" />}
      </summary>
      {finding && (
        <div className="space-y-3 px-4 pb-4">
          <p className="text-[13.5px] leading-relaxed text-zinc-400">{finding.summary}</p>
          {finding.evidence.length > 0 && <EvidenceChips ids={finding.evidence} evidence={evidence} active={active} onPick={onPick} />}
        </div>
      )}
    </details>
  );
}

const ROLES: Record<string, string> = {
  triage: "Reads the alert and proposes hypotheses",
  responder: "Proposes actions for humans to approve",
  scribe: "Writes the playbook for next time",
};

export function TeamList({ agents }: { agents: { name: string; calls: number; running: boolean }[] }) {
  if (!agents.length) return <p className="text-shimmer text-[13px] font-medium">Assembling the agent team…</p>;
  return (
    <ul className="space-y-1">
      {agents.map((a) => (
        <li key={a.name} className="flex items-center gap-3 rounded-xl px-2 py-2">
          <span
            className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${a.running ? "bg-amber-400/10 text-amber-300" : "bg-emerald-400/10 text-emerald-300"}`}
          >
            {a.running ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" /> : <IconCheck size={13} strokeWidth={2.4} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-medium text-zinc-200">{agentName(a.name)}</p>
            <p className="truncate text-[12px] text-zinc-500">{ROLES[a.name] ?? (a.name.startsWith("investigator") ? "Tests one hypothesis against the graph" : "")}</p>
          </div>
          {a.calls > 0 && <span className="shrink-0 font-mono text-[11px] tabular-nums text-zinc-600">{a.calls} calls</span>}
        </li>
      ))}
    </ul>
  );
}

const STATUS_TEXT: Record<string, string> = {
  investigating: "Investigating",
  root_cause_found: "Root cause found",
  awaiting_approval: "Waiting for approval",
  needs_human: "Needs a human",
  resolved: "Resolved",
};
const DOT: Record<string, string> = {
  opened: "bg-red-400",
  hypothesis: "bg-amber-400",
  finding: "bg-sky-400",
  action_proposed: "bg-violet-400",
  action_approved: "bg-emerald-400",
  action_executed: "bg-emerald-400",
  action_rejected: "bg-zinc-500",
  procedure: "bg-lime-400",
  procedure_match: "bg-lime-400",
  escalate: "bg-red-400",
  error: "bg-red-400",
};

type Line = { key: number; kind: string; who: string; text: string; ts?: number };

function describe(e: Ev): string | null {
  switch (e.kind) {
    case "opened":
      return "Alert fired";
    case "finding": {
      const verdict = String(e.data?.verdict ?? "");
      const pct = e.text.match(/(\d+)%/)?.[1];
      const what = verdict === "confirmed" ? "Confirmed the root cause" : verdict === "rejected" ? "Ruled out a hypothesis" : "Couldn't settle a hypothesis";
      return pct ? `${what} (${pct}%)` : what;
    }
    case "status": {
      const to = e.text.split("→").at(-1)?.trim() ?? "";
      return `Status: ${STATUS_TEXT[to] ?? to.replaceAll("_", " ")}`;
    }
    case "action_approved":
    case "action_rejected":
    case "action_executed":
    case "procedure":
    case "procedure_match":
    case "escalate":
    case "error":
      return e.text;
    case "team_done":
      return e.text.replace(/^team finished/, "Team finished");
    default:
      return null;
  }
}

function lines(events: Ev[]): Line[] {
  const out: Line[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const who = e.agent === "system" ? "Lore" : agentName(e.agent);
    if (e.kind === "hypothesis" || e.kind === "action_proposed") {
      let n = 1;
      while (events[i + n]?.kind === e.kind && events[i + n]?.agent === e.agent) n++;
      const noun = e.kind === "hypothesis" ? "hypothes" : "action";
      const text = `Proposed ${n} ${noun}${e.kind === "hypothesis" ? (n > 1 ? "es" : "is") : n > 1 ? "s" : ""}`;
      out.push({ key: e.seq, kind: e.kind, who, text, ts: e.ts });
      i += n - 1;
      continue;
    }
    const text = describe(e);
    if (text) out.push({ key: e.seq, kind: e.kind, who, text, ts: e.ts });
  }
  return out;
}

export function Timeline({ events }: { events: Ev[] }) {
  const shown = lines(events);
  if (!shown.length) return null;
  return (
    <ol className="relative space-y-3.5 pl-4 before:absolute before:bottom-1 before:left-[3px] before:top-1 before:w-px before:bg-white/[0.07]">
      {shown.map((l) => (
        <li key={l.key} className="relative">
          <span className={`absolute -left-4 top-[7px] h-[7px] w-[7px] rounded-full ring-4 ring-canvas ${DOT[l.kind] ?? "bg-zinc-600"}`} />
          <p className="line-clamp-2 text-[13px] leading-relaxed text-zinc-300">{l.text}</p>
          <p className="text-[11.5px] text-zinc-600">
            {l.who}
            {l.ts ? ` · ${ago(l.ts)}` : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}

export function MemoryCallout({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-lime-400/[0.06] p-4 text-[13.5px] leading-relaxed text-lime-200/90">
      <IconBrain size={17} className="mt-0.5 shrink-0 text-lime-300" />
      <span>{text}</span>
    </div>
  );
}
