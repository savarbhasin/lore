"use client";

import { useState } from "react";
import {
  IconBranch,
  IconChevronDown,
  IconCode,
  IconDatabase,
  IconFile,
  IconGraph,
  IconHistory,
  IconPencil,
  IconRadar,
  IconSearch,
  IconTerminal,
  IconUser,
  IconUsers,
  IconX,
  Spinner,
} from "./Icons";
import { Terminal, type TermLine } from "./Terminal";

export type Step = {
  agent: string;
  tool: string;
  args: Record<string, unknown>;
  ms?: number;
  nodes?: number;
  error?: string | null;
  done: boolean;
};

type Args = Record<string, unknown>;
type Meta = {
  label: string;
  icon: (p: { size?: number }) => React.ReactNode;
  primary?: string[];
  tone: "graph" | "sandbox" | "write";
  doing: (a: Args) => string;
};

const id = (v: unknown) => String(v ?? "").replace(/^file:/, "");
const clip = (v: unknown, n = 60) => {
  const t = id(v).replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const TOOLS: Record<string, Meta> = {
  search_entities: { label: "Search graph", icon: IconSearch, primary: ["query"], tone: "graph", doing: (a) => `Searching the graph for “${clip(a.query)}”` },
  get_entity: { label: "Look up", icon: IconDatabase, primary: ["entity_id"], tone: "graph", doing: (a) => `Looking up ${clip(a.entity_id)}` },
  who_owns: { label: "Who owns", icon: IconUser, primary: ["entity_id"], tone: "graph", doing: (a) => `Finding who owns ${clip(a.entity_id)}` },
  who_knows: { label: "Who knows", icon: IconUsers, primary: ["entity_id"], tone: "graph", doing: (a) => `Finding who knows ${clip(a.entity_id)}` },
  blast_radius: { label: "Blast radius", icon: IconRadar, primary: ["service_id"], tone: "graph", doing: (a) => `Mapping the blast radius of ${clip(a.service_id)}` },
  recent_changes: { label: "Recent changes", icon: IconHistory, primary: ["service_id"], tone: "graph", doing: (a) => `Checking recent changes around ${clip(a.service_id)}` },
  trace_decision: { label: "Trace decision", icon: IconBranch, primary: ["entity_id"], tone: "graph", doing: (a) => `Tracing the decisions behind ${clip(a.entity_id)}` },
  explain_path: { label: "Explain path", icon: IconGraph, primary: ["from_id", "to_id"], tone: "graph", doing: (a) => `Connecting ${clip(a.from_id, 30)} to ${clip(a.to_id, 30)}` },
  similar_incidents: { label: "Similar incidents", icon: IconHistory, primary: ["service_id"], tone: "graph", doing: (a) => `Looking for similar incidents on ${clip(a.service_id)}` },
  knowledge_hubs: { label: "Knowledge hubs", icon: IconUsers, tone: "graph", doing: () => "Finding the people knowledge flows through" },
  bus_factor: { label: "Bus factor", icon: IconUsers, primary: ["service_id"], tone: "graph", doing: (a) => (a.service_id ? `Computing the bus factor of ${clip(a.service_id)}` : "Computing bus factors") },
  communities: { label: "Communities", icon: IconGraph, tone: "graph", doing: () => "Detecting communities in the graph" },
  graph_schema: { label: "Read schema", icon: IconDatabase, tone: "graph", doing: () => "Reading the graph schema" },
  run_cypher: { label: "Cypher query", icon: IconCode, primary: ["query"], tone: "graph", doing: () => "Querying FalkorDB" },
  run_command: { label: "Run", icon: IconTerminal, primary: ["command"], tone: "sandbox", doing: (a) => `Running ${clip(a.command, 70)}` },
  read_file: { label: "Read file", icon: IconFile, primary: ["path"], tone: "sandbox", doing: (a) => `Reading ${clip(a.path)}` },
  write_file: { label: "Write file", icon: IconPencil, primary: ["path"], tone: "sandbox", doing: (a) => `Editing ${clip(a.path)}` },
  record_pull_request: { label: "Record PR", icon: IconBranch, primary: ["url"], tone: "write", doing: () => "Recording the pull request in the graph" },
};

const TONE: Record<Meta["tone"], string> = {
  graph: "text-sky-300 bg-sky-400/10",
  sandbox: "text-emerald-300 bg-emerald-400/10",
  write: "text-violet-300 bg-violet-400/10",
};

function baseName(tool: string) {
  return tool.split("__").at(-1) ?? tool;
}

export function toolMeta(tool: string): Meta {
  const name = baseName(tool);
  const label = name.replaceAll("_", " ");
  return TOOLS[name] ?? { label, icon: IconDatabase, tone: "graph", doing: () => `Running ${label}` };
}

function show(v: unknown) {
  return typeof v === "string" ? v : JSON.stringify(v);
}

function splitArgs(meta: Meta, args: Record<string, unknown>) {
  const present = Object.entries(args).filter(([, v]) => v !== null && v !== undefined && v !== "");
  const primary = present.filter(([k]) => meta.primary?.includes(k));
  const rest = present.filter(([k]) => !meta.primary?.includes(k));
  return { primary: primary.map(([, v]) => show(v)), rest };
}

function StepIcon({ step, meta }: { step: Step; meta: Meta }) {
  const Icon = meta.icon;
  if (!step.done)
    return (
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-amber-400/10 text-amber-300">
        <Spinner size={12} />
      </span>
    );
  if (step.error)
    return (
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-red-400/10 text-red-300">
        <IconX size={12} />
      </span>
    );
  return (
    <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${TONE[meta.tone]}`}>
      <Icon size={13} />
    </span>
  );
}

export function ToolSteps({ steps, showAgent = false }: { steps: Step[]; showAgent?: boolean }) {
  if (!steps.length) return null;
  return (
    <ol className="relative space-y-0.5">
      {steps.map((s, i) => {
        const meta = toolMeta(s.tool);
        const { primary, rest } = splitArgs(meta, s.args);
        return (
          <li key={i} className="group flex animate-fade-in items-center gap-2.5 rounded-lg px-1.5 py-1 hover:bg-white/[0.03]" title={s.error ?? undefined}>
            <StepIcon step={s} meta={meta} />
            <div className="flex min-w-0 flex-1 items-center gap-2 text-[12.5px]">
              {showAgent && <span className="shrink-0 rounded bg-white/5 px-1.5 py-px text-[11px] text-zinc-400">{s.agent}</span>}
              <span className="shrink-0 font-medium text-zinc-200">{meta.label}</span>
              {primary.map((p, j) => (
                <span
                  key={j}
                  className={`min-w-0 truncate rounded px-1.5 py-px font-mono text-[11.5px] ${
                    meta.tone === "sandbox" ? "bg-black/40 text-emerald-200/90" : "bg-white/[0.05] text-zinc-300"
                  }`}
                >
                  {p}
                </span>
              ))}
              {rest.length > 0 && (
                <span className="min-w-0 truncate font-mono text-[11px] text-zinc-500">
                  {rest.map(([k, v]) => `${k}=${show(v)}`).join("  ")}
                </span>
              )}
            </div>
            {s.done && (
              <span className="flex shrink-0 items-center gap-2 font-mono text-[11px] tabular-nums text-zinc-500">
                {s.error ? (
                  <span className="text-red-400">failed</span>
                ) : s.nodes ? (
                  <span className="rounded bg-white/[0.04] px-1.5 py-px text-zinc-400">{s.nodes} nodes</span>
                ) : null}
                <span className="w-12 text-right">{formatMs(s.ms ?? 0)}</span>
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function formatMs(ms: number) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/** Live status line while the agent works; a collapsible tool log once it's done. */
export function Activity({
  steps,
  term,
  running,
  showAgent = false,
  idle = "Thinking…",
}: {
  steps: Step[];
  term: TermLine[];
  running: boolean;
  showAgent?: boolean;
  idle?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!running && !steps.length && !term.length) return null;

  const total = steps.reduce((a, s) => a + (s.ms ?? 0), 0);
  const failed = steps.filter((s) => s.error).length;
  // Graph tools finish in milliseconds, so keep the latest step on screen until the next one starts.
  const latest = [...steps].reverse().find((s) => !s.done) ?? steps.at(-1);
  const status = latest ? `${toolMeta(latest.tool).doing(latest.args)}…` : idle;
  const hasLog = steps.length > 0 || term.length > 0;

  return (
    <div>
      <button
        type="button"
        disabled={!hasLog}
        onClick={() => setOpen(!open)}
        className="group -ml-1 flex max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[13.5px] transition-colors enabled:hover:text-zinc-200"
      >
        {running ? (
          <span key={status} className="text-shimmer min-w-0 animate-fade-in truncate font-medium">
            {status}
          </span>
        ) : (
          <span className="min-w-0 truncate text-zinc-500 group-hover:text-zinc-300">
            Used {steps.length} tool{steps.length === 1 ? "" : "s"}
            {total > 0 && <span className="text-zinc-600"> · {formatMs(total)}</span>}
            {failed > 0 && <span className="text-red-400/80"> · {failed} failed</span>}
          </span>
        )}
        {hasLog && (
          <IconChevronDown
            size={14}
            className={`shrink-0 text-zinc-600 transition-transform group-hover:text-zinc-400 ${open ? "rotate-180" : "-rotate-90"}`}
          />
        )}
      </button>
      {open && hasLog && (
        <div className="mt-2 animate-fade-in space-y-2">
          <ToolSteps steps={steps} showAgent={showAgent} />
          {term.length > 0 && <Terminal lines={term} className="max-h-72" />}
        </div>
      )}
    </div>
  );
}

/** Fold tool_call/tool_result events into a step list. */
export function applyStep(steps: Step[], e: { type: string; agent?: string; tool?: string; args?: Record<string, unknown>; ms?: number; evidence?: { nodes: unknown[] }; error?: string | null }): Step[] {
  if (e.type === "tool_call") return [...steps, { agent: e.agent!, tool: e.tool!, args: e.args ?? {}, done: false }];
  if (e.type === "tool_result") {
    const idx = steps.findIndex((s) => !s.done && s.tool === e.tool && s.agent === e.agent);
    if (idx < 0) return steps;
    const next = [...steps];
    next[idx] = { ...next[idx], done: true, ms: e.ms, nodes: e.evidence?.nodes.length ?? 0, error: e.error };
    return next;
  }
  return steps;
}
