"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Person } from "@/lib/api";
import { Avatar } from "./Avatar";
import { IconCheck, IconChevronDown, IconSearch } from "./Icons";

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

function Trigger({ open, onClick, children, label }: { open: boolean; onClick: () => void; children: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className={`group flex h-9 items-center gap-2.5 rounded-lg border pl-1.5 pr-2.5 text-left transition-colors ${
        open ? "border-line-strong bg-elevated" : "border-line bg-surface hover:border-line-strong hover:bg-elevated"
      }`}
    >
      {children}
      <span className="sr-only">{label}</span>
      <IconChevronDown size={14} className={`text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
  );
}

function Panel({ children, width = 300 }: { children: React.ReactNode; width?: number }) {
  return (
    <div
      className="absolute right-0 top-[calc(100%+6px)] z-50 animate-pop overflow-hidden rounded-xl border border-line-strong bg-elevated shadow-2xl shadow-black/60"
      style={{ width }}
    >
      {children}
    </div>
  );
}

export function CompanyPicker({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <Trigger open={open} onClick={() => setOpen((o) => !o)} label="Change company">
        <Avatar name={value} seed={`co:${value}`} size={24} square />
        <span className="flex flex-col leading-none max-md:hidden">
          <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Company</span>
          <span className="mt-0.5 text-[13px] font-medium capitalize text-zinc-100">{value}</span>
        </span>
      </Trigger>
      {open && (
        <Panel width={240}>
          <div className="px-3 pb-1.5 pt-2.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">Knowledge graphs</div>
          <ul className="p-1.5 pt-0">
            {options.map((t) => (
              <li key={t}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(t);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-white/5 ${
                    t === value ? "text-zinc-50" : "text-zinc-300"
                  }`}
                >
                  <Avatar name={t} seed={`co:${t}`} size={26} square />
                  <span className="flex-1 capitalize">{t}</span>
                  {t === value && <IconCheck size={15} className="text-accent" />}
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

export function PersonPicker({ value, people, onChange }: { value: string; people: Person[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const ref = useDismiss(open, () => setOpen(false));
  const current = people.find((p) => p.id === value);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hits = people.filter((p) => !q || `${p.name} ${p.title} ${p.team}`.toLowerCase().includes(q));
    const byTeam = new Map<string, Person[]>();
    for (const p of hits) byTeam.set(p.team, [...(byTeam.get(p.team) ?? []), p]);
    return [...byTeam.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [people, query]);
  const flat = groups.flatMap(([, ps]) => ps);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={ref} className="relative">
      <Trigger
        open={open}
        onClick={() => {
          setOpen((o) => !o);
          setCursor(0);
        }}
        label="Change who you are acting as"
      >
        <Avatar name={current?.name ?? value} seed={value} size={24} />
        <span className="flex min-w-0 flex-col leading-none">
          <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Acting as</span>
          <span className="mt-0.5 max-w-28 truncate sm:max-w-40 text-[13px] font-medium text-zinc-100">{current?.name ?? value}</span>
        </span>
      </Trigger>
      {open && (
        <Panel width={320}>
          <div className="flex items-center gap-2 border-b border-line px-3">
            <IconSearch size={15} className="text-zinc-500" />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setCursor(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setCursor((c) => Math.min(c + 1, flat.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setCursor((c) => Math.max(c - 1, 0));
                } else if (e.key === "Enter" && flat[cursor]) {
                  pick(flat[cursor].id);
                }
              }}
              placeholder="Search people, roles, teams…"
              className="h-11 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
            />
          </div>
          <div className="max-h-[min(420px,60vh)] overflow-y-auto p-1.5">
            {flat.length === 0 && <p className="px-3 py-6 text-center text-sm text-zinc-500">No one matches “{query}”</p>}
            {groups.map(([team, ps]) => (
              <div key={team} className="mb-1">
                <div className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">{team}</div>
                {ps.map((p) => {
                  const idx = flat.indexOf(p);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onMouseEnter={() => setCursor(idx)}
                      onClick={() => pick(p.id)}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors ${idx === cursor ? "bg-white/6" : ""}`}
                    >
                      <Avatar name={p.name} seed={p.id} size={28} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-zinc-100">{p.name}</span>
                        <span className="block truncate text-xs text-zinc-500">{p.title}</span>
                      </span>
                      {p.id === value && <IconCheck size={15} className="shrink-0 text-accent" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
