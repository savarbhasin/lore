"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { Action, Board, GNode, IncidentRow, Person, Service, Source } from "@/lib/api";
import { LABEL_COLORS } from "@/lib/colors";
import { AnswerText } from "../AnswerText";
import { Avatar } from "../Avatar";
import { IconArrowUp, IconExternal, IconX, Spinner } from "../Icons";
import { StatusBadge } from "../StatusBadge";
import type { TermLine } from "../Terminal";
import { Activity, toolMeta, type Step } from "../ToolSteps";
import type { AgentStatus } from "./useIncidents";
import type { Interactable, World } from "./layout";
import { hsl } from "./palette";
import type { PlayerState } from "./Player";
import type { Exchange } from "./useLoreAsk";

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-grid h-6 min-w-6 place-items-center rounded-md border border-white/20 bg-white/10 px-1.5 font-sans text-[11px] font-semibold text-white shadow-[0_2px_0_rgba(255,255,255,0.12)]">
      {children}
    </kbd>
  );
}

const glass = "bg-black/45 backdrop-blur-xl ring-1 ring-white/10";

export function Intro({ tenant, me, ready, onStart }: { tenant: string; me?: Person; ready: boolean; onStart: () => void }) {
  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-gradient-to-b from-black/30 via-black/50 to-black/80 p-4">
      <div className="w-full max-w-lg animate-fade-in text-center">
        <p className="text-[12px] font-semibold uppercase tracking-[0.3em] text-amber-300/90">Lore World</p>
        <h1 className="mt-3 text-balance text-[34px] font-semibold leading-tight tracking-tight text-white sm:text-[44px]">
          Walk into <span className="capitalize text-amber-300">{tenant}</span>&apos;s memory
        </h1>
        <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-zinc-300">
          Every building is a team, every tower a service, every person a real expert from the graph. Find Lore in the plaza and ask it anything, out
          loud.
        </p>
        <div className="mx-auto mt-7 grid max-w-sm grid-cols-2 gap-x-6 gap-y-2.5 text-left text-[13px] text-zinc-300">
          <span className="flex items-center gap-2">
            <Key>W</Key>
            <Key>A</Key>
            <Key>S</Key>
            <Key>D</Key> move
          </span>
          <span className="flex items-center gap-2">
            <Key>Shift</Key> run
          </span>
          <span className="flex items-center gap-2">
            <Key>E</Key> talk / inspect
          </span>
          <span className="flex items-center gap-2">
            <Key>V</Key> hold to speak
          </span>
          <span className="flex items-center gap-2">
            <Key>Drag</Key> look around
          </span>
          <span className="flex items-center gap-2">
            <Key>N</Key> day / night
          </span>
        </div>
        <button
          type="button"
          disabled={!ready}
          onClick={onStart}
          className="mt-8 inline-flex h-12 items-center gap-2 rounded-full bg-amber-400 px-7 text-[15px] font-semibold text-zinc-950 shadow-[0_0_40px_-6px] shadow-amber-400/70 transition-transform hover:scale-[1.03] disabled:opacity-60"
        >
          {ready ? (
            <>Enter as {me?.name ?? "guest"}</>
          ) : (
            <>
              <Spinner size={16} /> Building the island…
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export function TopBar({
  tenant,
  me,
  found,
  total,
  night,
  muted,
  onNight,
  onMute,
}: {
  tenant: string;
  me?: Person;
  found: number;
  total: number;
  night: boolean;
  muted: boolean;
  onNight: () => void;
  onMute: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-4">
      <div className={`pointer-events-auto flex items-center gap-3 rounded-2xl py-2 pl-2 pr-4 ${glass}`}>
        {me && <Avatar name={me.name} seed={me.id} size={34} />}
        <div className="leading-tight">
          <p className="text-[13.5px] font-semibold text-white">{me?.name ?? "Guest"}</p>
          <p className="text-[11.5px] text-zinc-400">
            {me?.title ?? "Visitor"} · <span className="capitalize">{tenant}</span>
          </p>
        </div>
      </div>
      <div className="pointer-events-auto flex items-center gap-2">
        <div
          className={`flex h-10 items-center gap-2 rounded-full px-4 text-[13px] text-white ${glass}`}
          title="People and services Lore pointed you to that you've visited"
        >
          <span className="text-amber-300">◆</span>
          <span className="font-semibold tabular-nums">{found}</span>
          <span className="text-zinc-400">/ {total} insights</span>
        </div>
        <button type="button" onClick={onNight} className={`h-10 rounded-full px-3.5 text-[13px] text-zinc-200 hover:text-white ${glass}`}>
          {night ? "☾ Night" : "☀ Day"}
        </button>
        <button type="button" onClick={onMute} className={`h-10 rounded-full px-3.5 text-[13px] text-zinc-200 hover:text-white ${glass}`}>
          {muted ? "Voice off" : "Voice on"}
        </button>
        <Link href="/" className={`flex h-10 items-center rounded-full px-4 text-[13px] text-zinc-200 hover:text-white ${glass}`}>
          Classic view
        </Link>
      </div>
    </div>
  );
}

export function Minimap({
  world,
  player,
  quests,
  discovered,
  incidents,
}: {
  world: World;
  player: RefObject<PlayerState>;
  quests: Set<string>;
  discovered: Set<string>;
  incidents: Set<string>;
}) {
  const [p, setP] = useState({ x: 0, z: 16, heading: Math.PI, yaw: 0 });
  useEffect(() => {
    const id = setInterval(() => setP({ ...player.current }), 90);
    return () => clearInterval(id);
  }, [player]);
  const S = 168;
  const k = S / 2 / 66;
  const map = (x: number, z: number) => [S / 2 + x * k, S / 2 + z * k] as const;
  const [px, pz] = map(p.x, p.z);
  return (
    <div className={`pointer-events-none absolute right-4 top-[72px] z-20 overflow-hidden rounded-full ${glass}`} style={{ width: S, height: S }}>
      <svg width={S} height={S}>
        <circle cx={S / 2} cy={S / 2} r={S / 2 - 6} fill="#3d6b3a" opacity={0.7} />
        <circle cx={S / 2} cy={S / 2} r={9 * k} fill="#d6cfc1" opacity={0.9} />
        {world.districts.map((d) => {
          const [x, z] = map(d.building.x, d.building.z);
          return <rect key={d.team} x={x - 5} y={z - 5} width={10} height={10} rx={2} fill={hsl(d.hue, 0.55, 0.6)} />;
        })}
        {world.districts.flatMap((d) =>
          d.towers.map((t) => {
            const [x, z] = map(t.x, t.z);
            const hot = incidents.has(t.service.id);
            return <circle key={t.service.id} cx={x} cy={z} r={hot ? 3.5 : 2} fill={hot ? "#ef4444" : "#e4e4e7"} opacity={hot ? 1 : 0.6} />;
          }),
        )}
        {[...quests].map((id) => {
          const a = world.anchors.get(id);
          if (!a) return null;
          const [x, z] = map(a[0], a[2]);
          return (
            <circle
              key={id}
              cx={x}
              cy={z}
              r={4}
              fill={discovered.has(id) ? "#4ade80" : "#fbbf24"}
              className={discovered.has(id) ? "" : "animate-pulse"}
            />
          );
        })}
        <circle cx={S / 2} cy={S / 2} r={3.5} fill="#fbbf24" />
        <g transform={`translate(${px} ${pz}) rotate(${(-p.heading * 180) / Math.PI + 180})`}>
          <path d="M0 -6 L4.5 5 L0 2.5 L-4.5 5 Z" fill="#fff" stroke="#000" strokeWidth={0.8} />
        </g>
      </svg>
    </div>
  );
}

export function Prompt({ nearby, mode }: { nearby: Interactable | null; mode: string }) {
  if (!nearby || mode === "talk") return null;
  if (nearby.kind === "incident") return null;
  const text = nearby.kind === "oracle" ? "Talk to Lore" : nearby.kind === "person" ? `Talk to ${nearby.label}` : `Inspect ${nearby.label}`;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[34%] z-20 flex justify-center">
      <div className={`flex animate-pop items-center gap-2.5 rounded-full py-2 pl-2 pr-4 text-[14px] font-medium text-white ${glass}`}>
        <Key>E</Key>
        {text}
        {(nearby.kind === "oracle" || nearby.kind === "person") && (
          <span className="ml-1 flex items-center gap-1.5 text-zinc-400">
            or hold <Key>V</Key>
          </span>
        )}
      </div>
    </div>
  );
}

export function Dialogue({
  exchange,
  spoken,
  revealed,
  talking,
  listening,
  interim,
  micSupported,
  micError,
  focus,
  onCite,
  onSend,
  onMicDown,
  onMicUp,
  onClose,
  onSkip,
  inputRef,
  who,
  suggestions,
}: {
  who: { name: string; subtitle?: string; seed?: string; lore: boolean; away?: string };
  suggestions: string[];
  exchange: Exchange | null;
  spoken: string;
  revealed: number;
  talking: boolean;
  listening: boolean;
  interim: string;
  micSupported: boolean;
  micError: string | null;
  focus: string | null;
  onCite: (id: string) => void;
  onSend: (q: string) => void;
  onMicDown: () => void;
  onMicUp: () => void;
  onClose: () => void;
  onSkip: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const done = exchange?.status === "done" && revealed >= spoken.length;
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [revealed, done]);
  if (!exchange && !talking) return null;
  const live = exchange?.steps.length ? ([...exchange.steps].reverse().find((s) => !s.done) ?? exchange.steps.at(-1)) : undefined;
  const first = who.name.split(" ")[0];
  const status = exchange?.sandbox
    ? "Running code in the sandbox…"
    : live
      ? `${toolMeta(live.tool).doing(live.args)}…`
      : who.lore
        ? "Thinking…"
        : `${first} is thinking…`;
  const showSuggestions = talking && suggestions.length > 0 && (!exchange || done || exchange.status === "error");

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center p-4">
      <div className={`pointer-events-auto w-full max-w-3xl animate-fade-in overflow-hidden rounded-3xl ${glass} bg-black/60`}>
        <div className="flex items-center gap-2.5 px-5 pt-4">
          {who.lore ? (
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-amber-300 to-amber-500">
              <span className="h-2 w-2 rounded-full bg-zinc-950" />
            </span>
          ) : (
            <Avatar name={who.name} seed={who.seed} size={28} />
          )}
          <span className={`shrink-0 text-[14px] font-semibold ${who.lore ? "text-amber-200" : "text-white"}`}>{who.name}</span>
          {!exchange && who.subtitle && <span className="min-w-0 truncate text-[12.5px] text-zinc-400">{who.subtitle}</span>}
          {who.away && <span className="shrink-0 rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] text-amber-200">{who.away}</span>}
          {exchange && <span className="min-w-0 truncate text-[12.5px] text-zinc-400">— “{exchange.question}”</span>}
          <span className="ml-auto flex items-center gap-1.5">
            {exchange?.status === "done" && !done && (
              <button
                type="button"
                onClick={onSkip}
                className="rounded-full px-2.5 py-1 text-[12px] text-zinc-400 hover:bg-white/10 hover:text-white"
              >
                Skip
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid h-7 w-7 place-items-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-white"
            >
              <IconX size={15} />
            </button>
          </span>
        </div>

        <div ref={scroller} className="max-h-[34vh] overflow-y-auto px-5 pb-3 pt-2">
          {!exchange && (
            <p className="text-[15.5px] leading-relaxed text-zinc-200">
              {who.lore
                ? "What would you like to know? Hold V and speak, or type below."
                : `Hey! I'm ${first}. Ask me about my work — hold V to talk, or type.`}
            </p>
          )}
          {exchange?.status === "thinking" && <p className="text-shimmer text-[15px] font-medium">{status}</p>}
          {exchange?.status === "error" && <p className="text-[14px] text-red-300">{exchange.error}</p>}
          {exchange?.status === "done" &&
            (done ? (
              <AnswerText text={exchange.text ?? ""} citations={exchange.citations} active={focus} onCite={onCite} />
            ) : (
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-zinc-200">
                {spoken.slice(0, revealed)}
                <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-amber-300" />
              </p>
            ))}
        </div>

        {showSuggestions && (
          <div className="flex flex-wrap gap-2 px-5 pb-3">
            {suggestions.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => onSend(q)}
                className="rounded-full bg-white/[0.07] px-3 py-1.5 text-left text-[12.5px] text-zinc-200 transition-colors hover:bg-white/[0.14] hover:text-white"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {talking && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.trim() || exchange?.status === "thinking") return;
              onSend(draft);
              setDraft("");
            }}
            className="flex items-center gap-2 border-t border-white/10 p-3"
          >
            <button
              type="button"
              disabled={!micSupported}
              onPointerDown={onMicDown}
              onPointerUp={onMicUp}
              onPointerLeave={() => listening && onMicUp()}
              title={micSupported ? "Hold to speak (or hold V)" : "This browser can't record audio"}
              className={`grid h-11 w-11 shrink-0 place-items-center rounded-full transition-all disabled:opacity-40 ${
                listening ? "scale-110 bg-sky-400 text-zinc-950 shadow-[0_0_30px] shadow-sky-400/60" : "bg-white/10 text-white hover:bg-white/15"
              }`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
            </button>
            <input
              ref={inputRef}
              value={listening ? interim || "Listening…" : draft}
              readOnly={listening}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") (e.target as HTMLInputElement).blur();
              }}
              placeholder={micError ?? (who.lore ? "Ask Lore anything… (Enter to send)" : `Ask ${first}… (Enter to send)`)}
              className={`h-11 min-w-0 flex-1 rounded-full bg-white/[0.06] px-4 text-[14.5px] text-white outline-none placeholder:text-zinc-500 focus:bg-white/10 ${listening ? "italic text-sky-200" : ""}`}
            />
            <button
              type="submit"
              disabled={!draft.trim() || listening || exchange?.status === "thinking"}
              aria-label="Send"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-amber-400 text-zinc-950 transition-colors hover:bg-amber-300 disabled:bg-white/10 disabled:text-zinc-500"
            >
              {exchange?.status === "thinking" ? <Spinner size={16} /> : <IconArrowUp size={18} strokeWidth={2.2} />}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export function EntityCard({
  item,
  person,
  service,
  incident,
  node,
  source,
  onAsk,
  onClose,
}: {
  item: Interactable | null;
  person?: Person;
  service?: Service;
  incident?: IncidentRow;
  node?: GNode;
  source?: Source;
  onAsk: (q: string) => void;
  onClose: () => void;
}) {
  if (!item && !node) return null;
  const asks: string[] = person
    ? [`What does ${person.name} work on, and what do they know best?`, `Who should I talk to if ${person.name.split(" ")[0]} is out?`]
    : service
      ? [`What changed in ${service.id} recently?`, `Who should I ask about ${service.id} this week?`, `Why is ${service.id} built the way it is?`]
      : node
        ? [`Tell me about ${node.id}.`]
        : [];
  return (
    <div className="pointer-events-none absolute left-4 top-[84px] z-30 w-[320px] max-w-[calc(100vw-2rem)]">
      <div className={`pointer-events-auto animate-pop rounded-2xl p-4 ${glass} bg-black/60`}>
        <div className="flex items-start gap-3">
          {person ? (
            <Avatar name={person.name} seed={person.id} size={40} />
          ) : (
            <span
              className="mt-1 h-3 w-3 shrink-0 rounded-full"
              style={{ background: node ? (LABEL_COLORS[node.label] ?? "#a1a1aa") : incident ? "#ef4444" : "#34d399" }}
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
              {person ? person.team : service ? `Service · tier ${service.tier}` : node?.label}
            </p>
            <p className="truncate text-[15px] font-semibold text-white">{person?.name ?? service?.id ?? node?.id.replace(/^file:/, "")}</p>
            <p className="text-[12.5px] text-zinc-400">
              {person?.title ?? (service ? `Owned by ${service.team ?? "nobody"}` : (source?.title ?? node?.name))}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-7 w-7 place-items-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-white"
          >
            <IconX size={14} />
          </button>
        </div>
        {incident && (
          <Link
            href={`/incidents/${incident.id}`}
            className="mt-3 flex items-center gap-2 rounded-xl bg-red-500/15 px-3 py-2 text-[12.5px] text-red-200 hover:bg-red-500/25"
          >
            <span className="font-mono text-[11px]">{incident.id}</span>
            <span className="min-w-0 flex-1 truncate">{incident.title}</span>
            <IconExternal size={13} />
          </Link>
        )}
        {(source?.url ?? node?.url) && (
          <a
            href={source?.url ?? node?.url}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] text-amber-300 hover:underline"
          >
            Open source <IconExternal size={12} />
          </a>
        )}
        {asks.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {asks.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => onAsk(q)}
                className="block w-full rounded-xl bg-white/[0.06] px-3 py-2 text-left text-[12.5px] leading-snug text-zinc-200 transition-colors hover:bg-white/[0.12] hover:text-white"
              >
                Ask Lore: {q}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function QuestLog({ items, discovered }: { items: { id: string; label: string; kind: string }[]; discovered: Set<string> }) {
  if (!items.length) return null;
  return (
    <div className={`pointer-events-none absolute right-4 top-[256px] z-20 w-[220px] rounded-2xl p-3.5 ${glass}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-300">Lore pointed you to</p>
      <ul className="mt-2 space-y-1.5">
        {items.slice(0, 6).map((q) => (
          <li key={q.id} className="flex items-center gap-2 text-[12.5px]">
            <span className={discovered.has(q.id) ? "text-emerald-400" : "text-amber-300"}>{discovered.has(q.id) ? "✓" : "◆"}</span>
            <span className={`min-w-0 truncate ${discovered.has(q.id) ? "text-zinc-500 line-through" : "text-zinc-100"}`}>{q.label}</span>
            <span className="ml-auto text-[10.5px] text-zinc-500">{q.kind}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function IncidentBanner({ incidents }: { incidents: IncidentRow[] }) {
  if (!incidents.length) return null;
  const inc = incidents[0];
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[72px] z-20 flex justify-center px-4">
      <Link
        href={`/incidents/${inc.id}`}
        className="pointer-events-auto flex items-center gap-2.5 rounded-full bg-red-600/80 py-1.5 pl-2 pr-4 text-[13px] text-white shadow-[0_0_40px_-8px] shadow-red-500 backdrop-blur"
      >
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" />
        <span className="font-mono text-[11.5px]">{inc.severity}</span>
        <span className="font-medium">{inc.title}</span>
        <span className="text-red-100/80">· follow the red beacon to {inc.services[0]}</span>
      </Link>
    </div>
  );
}

export type Toast = { id: number; title: string; body?: string };

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[120px] z-40 flex flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="animate-pop rounded-2xl bg-amber-400/95 px-4 py-2 text-center text-zinc-950 shadow-[0_0_40px_-8px] shadow-amber-400"
        >
          <p className="text-[13px] font-semibold">{t.title}</p>
          {t.body && <p className="text-[12px] text-zinc-800">{t.body}</p>}
        </div>
      ))}
    </div>
  );
}

const ACTION_TITLE: Record<string, (t: string, name: (id: string) => string) => string> = {
  page: (t, name) => `Page ${name(t)}`,
  open_pr: (t) => `Open a fix PR for ${t}`,
  post_message: (t) => `Post an update to ${t}`,
};

export function IncidentPanel({
  board,
  me,
  name,
  agents,
  steps,
  term,
  running,
  errors,
  onDecide,
  onResolve,
}: {
  board: Board;
  me?: Person;
  name: (id: string) => string;
  agents: AgentStatus[];
  steps: Step[];
  term: TermLine[];
  running: boolean;
  errors: Record<string, string>;
  onDecide: (a: Action, approve: boolean) => void;
  onResolve: () => void;
}) {
  const inc = board.incident;
  const confirmed = board.findings.filter((f) => f.verdict === "confirmed").sort((a, b) => b.confidence - a.confidence)[0];
  const cause = confirmed && board.hypotheses.find((h) => h.id === confirmed.hypothesis_id);
  return (
    <div className="pointer-events-none absolute bottom-4 right-4 top-[72px] z-30 flex w-[400px] max-w-[calc(100vw-2rem)] flex-col">
      <div className={`pointer-events-auto flex min-h-0 flex-1 animate-slide-in flex-col overflow-hidden rounded-3xl ${glass} bg-black/65`}>
        <div className="border-b border-white/10 p-4">
          <div className="flex items-center gap-2 text-[11.5px] text-zinc-400">
            <span className="rounded bg-red-500/20 px-1.5 py-0.5 font-mono font-semibold text-red-300">{inc.severity}</span>
            <span className="font-mono">{inc.id}</span>
            <StatusBadge status={inc.status} />
            <span className="ml-auto text-[11px] text-zinc-500">war room</span>
          </div>
          <p className="mt-2 text-[16px] font-semibold leading-snug text-white">{inc.title}</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-400">{inc.text}</p>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
          {cause ? (
            <section>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-300">
                Root cause · {Math.round(confirmed.confidence * 100)}%
              </p>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-zinc-100">{cause.statement}</p>
            </section>
          ) : (
            <p className="text-shimmer text-[13.5px] font-medium">Investigators are testing {board.hypotheses.length || "their"} hypotheses…</p>
          )}

          {board.actions.length > 0 && (
            <section className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-violet-300">
                Needs a decision · acting as {me?.name ?? "guest"}
              </p>
              {board.actions.map((a) => {
                const allowed = !!me && a.approvers.includes(me.id);
                const title = (ACTION_TITLE[a.kind] ?? ((t: string) => `${a.kind} ${t}`))(a.target, name);
                return (
                  <div key={a.id} className="rounded-2xl bg-white/[0.05] p-3">
                    <div className="flex items-start gap-2">
                      <p className="flex-1 text-[13.5px] font-medium text-white">{title}</p>
                      <StatusBadge status={a.status} />
                    </div>
                    <p className="mt-1 line-clamp-3 text-[12px] leading-relaxed text-zinc-400">{a.summary}</p>
                    {a.status === "proposed" && (
                      <div className="mt-2.5 flex items-center gap-2">
                        <button
                          type="button"
                          disabled={!allowed}
                          onClick={() => onDecide(a, true)}
                          className="h-8 rounded-lg bg-emerald-400 px-3 text-[12.5px] font-semibold text-zinc-950 hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-zinc-500"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={!allowed}
                          onClick={() => onDecide(a, false)}
                          className="h-8 rounded-lg px-3 text-[12.5px] text-zinc-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:text-zinc-600"
                        >
                          Reject
                        </button>
                        {!allowed && (
                          <span className="min-w-0 truncate text-[11px] text-zinc-500" title={a.approvers.map(name).join(", ")}>
                            Only {name(a.approvers[0] ?? "")}
                            {a.approvers.length > 1 ? ` +${a.approvers.length - 1}` : ""} can approve
                          </span>
                        )}
                      </div>
                    )}
                    {a.status === "executing" && <p className="text-shimmer mt-2 text-[12.5px] font-medium">Lore is carrying this out…</p>}
                    {a.decided_by && (
                      <p className="mt-1.5 text-[11.5px] text-zinc-500">
                        {a.status === "rejected" ? "Rejected" : "Approved"} by {name(a.decided_by)}
                      </p>
                    )}
                    {a.result && <ActionOutcome raw={a.result} />}
                    {errors[a.id] && <p className="mt-1.5 text-[11.5px] text-red-400">{errors[a.id]}</p>}
                  </div>
                );
              })}
            </section>
          )}

          {agents.length > 0 && (
            <section>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">Agent team</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {agents.map((a) => (
                  <span key={a.name} className="flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11.5px] text-zinc-200">
                    <span className={`h-1.5 w-1.5 rounded-full ${a.running ? "animate-pulse bg-amber-400" : "bg-emerald-400"}`} />
                    {a.name}
                  </span>
                ))}
              </div>
            </section>
          )}

          {(steps.length > 0 || term.length > 0) && (
            <section>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">Live activity</p>
              <Activity steps={steps} term={term} running={running || agents.some((a) => a.running)} showAgent idle="Working…" />
            </section>
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-white/10 p-3">
          <Link href={`/incidents/${inc.id}`} className="rounded-full px-3 py-1.5 text-[12px] text-zinc-300 hover:bg-white/10 hover:text-white">
            Full incident view
          </Link>
          {inc.status !== "resolved" && (
            <button
              type="button"
              onClick={onResolve}
              className="ml-auto rounded-full bg-emerald-500 px-3.5 py-1.5 text-[12px] font-semibold text-zinc-950 hover:bg-emerald-400"
            >
              Resolve &amp; learn
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionOutcome({ raw }: { raw: string }) {
  let r: { pull_requests?: string[]; summary?: string; error?: string; simulated?: boolean; note?: string } = {};
  try {
    r = JSON.parse(raw);
  } catch {
    return <p className="mt-1.5 font-mono text-[11px] text-zinc-500">{raw}</p>;
  }
  return (
    <div className="mt-1.5 space-y-1 text-[11.5px]">
      {r.pull_requests?.map((u) => (
        <a key={u} href={u} target="_blank" rel="noreferrer" className="block truncate font-mono text-emerald-300 hover:underline">
          {u.replace("https://github.com/", "")}
        </a>
      ))}
      {r.error && <p className="text-red-400">{r.error}</p>}
      {r.simulated && <p className="text-zinc-500">Simulated: {r.note}</p>}
    </div>
  );
}
