"use client";

import dynamic from "next/dynamic";
import type { Evidence, GNode, Source } from "@/lib/api";
import { LABEL_COLORS } from "@/lib/colors";
import { IconExternal, IconGraph, IconX, Spinner } from "./Icons";

const GraphCanvas = dynamic(() => import("./GraphCanvas"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center text-zinc-600">
      <Spinner size={18} />
    </div>
  ),
});

export function EvidenceGraph({
  evidence,
  focus,
  selected,
  sources = [],
  onSelect,
  onClose,
  title = "Evidence graph",
  empty = "The evidence subgraph appears here as Lore queries FalkorDB.",
}: {
  evidence: Evidence;
  focus?: string[];
  selected?: string | null;
  sources?: Source[];
  onSelect?: (n: GNode | null) => void;
  onClose?: () => void;
  title?: string;
  empty?: string;
}) {
  const counts = new Map<string, number>();
  for (const n of evidence.nodes) counts.set(n.label, (counts.get(n.label) ?? 0) + 1);
  const node = selected ? evidence.nodes.find((n) => n.id === selected) : undefined;
  const source = selected ? sources.find((s) => s.id === selected) : undefined;
  const url = source?.url ?? node?.url;

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line px-4">
        <IconGraph size={15} className="text-zinc-400" />
        <span className="text-[13px] font-medium text-zinc-100">{title}</span>
        {evidence.nodes.length > 0 && (
          <span className="font-mono text-[11px] tabular-nums text-zinc-500">
            {evidence.nodes.length} nodes · {evidence.edges.length} edges
          </span>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close graph"
            className="ml-auto grid h-7 w-7 place-items-center rounded-md text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200"
          >
            <IconX size={15} />
          </button>
        )}
      </div>
      <div className="relative min-h-0 flex-1 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.035)_0%,transparent_70%)]">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.08) 1px, transparent 1px)", backgroundSize: "22px 22px" }}
        />
        {evidence.nodes.length === 0 ? (
          <div className="relative grid h-full place-items-center px-8 text-center text-sm text-zinc-600">{empty}</div>
        ) : (
          <GraphCanvas evidence={evidence} focus={focus} onSelect={onSelect} />
        )}
        {counts.size > 0 && (
          <div className="pointer-events-none absolute left-3 top-3 flex max-w-[70%] flex-wrap gap-1.5">
            {[...counts.entries()].map(([l, c]) => (
              <span key={l} className="flex items-center gap-1.5 rounded-full border border-line bg-canvas/70 px-2 py-0.5 text-[11px] text-zinc-400 backdrop-blur">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: LABEL_COLORS[l] ?? "#a1a1aa" }} />
                {l}
                <span className="tabular-nums text-zinc-600">{c}</span>
              </span>
            ))}
          </div>
        )}
        {node && (
          <div className="absolute inset-x-3 bottom-3 animate-fade-in rounded-xl border border-line-strong bg-elevated/95 p-3 shadow-2xl shadow-black/50 backdrop-blur">
            <div className="flex items-start gap-3">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: LABEL_COLORS[node.label] ?? "#a1a1aa" }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                  <span className="font-medium uppercase tracking-wider">{node.label}</span>
                  <span className="truncate font-mono">{node.id.replace(/^file:/, "")}</span>
                </div>
                <p className="mt-0.5 text-sm leading-snug text-zinc-100">{node.name}</p>
                {source?.title && source.title !== node.name && <p className="mt-0.5 text-[12.5px] leading-snug text-zinc-500">{source.title}</p>}
              </div>
              {url && (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex shrink-0 items-center gap-1 rounded-md border border-line px-2 py-1 text-[12px] text-zinc-300 transition-colors hover:border-line-strong hover:text-zinc-50"
                >
                  Open <IconExternal size={12} />
                </a>
              )}
              <button
                type="button"
                onClick={() => onSelect?.(null)}
                aria-label="Clear selection"
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
              >
                <IconX size={13} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
