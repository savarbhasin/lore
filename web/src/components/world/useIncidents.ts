"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, stream, type Board, type StreamEvent } from "@/lib/api";
import { applyTerm, type TermLine } from "../Terminal";
import { applyStep, type Step } from "../ToolSteps";

type Ev = Extract<StreamEvent, { type: "event" }>;

/** Boards for every open incident, refreshed every few seconds so war rooms reflect statuses and actions. */
export function useIncidentBoards(tenant: string, ids: string[]) {
  const [boards, setBoards] = useState<Record<string, Board>>({});
  const key = ids.join(",");
  const refresh = useCallback(
    (id: string) => {
      api<Board>(`/api/incidents/${id}?tenant=${tenant}`)
        .then((b) => setBoards((m) => ({ ...m, [id]: b })))
        .catch(() => {});
    },
    [tenant],
  );
  useEffect(() => {
    const list = key ? key.split(",") : [];
    const load = () => list.forEach(refresh);
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [key, refresh]);
  return { boards, refresh };
}

export type AgentStatus = { name: string; running: boolean; calls: number };

/** Live feed of the incident whose room the player is standing in: tool calls, sandbox output, agent status. */
export function useIncidentLive(tenant: string, id: string | null, onChange: () => void) {
  const [steps, setSteps] = useState<Step[]>([]);
  const [term, setTerm] = useState<TermLine[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [finished, setFinished] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const changed = useRef(onChange);
  useEffect(() => {
    changed.current = onChange;
  }, [onChange]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSteps([]);
    setTerm([]);
    setEvents([]);
    setFinished(new Set());
    setRunning(false);
    if (!id) return;
    return stream(`/api/incidents/${id}/stream?tenant=${tenant}`, (e) => {
      if (e.type === "event") {
        setEvents((prev) => (prev.some((x) => x.seq === e.seq) ? prev : [...prev, e]));
        changed.current();
      } else if (e.type === "tool_call" || e.type === "tool_result") {
        setSteps((s) => applyStep(s, e).slice(-60));
      } else if (e.type.startsWith("sandbox_")) {
        setTerm((t) => applyTerm(t, e));
        if (e.type === "sandbox_cmd") setRunning(true);
        if (e.type === "sandbox_exit") setRunning(false);
      } else if (e.type === "agent_done") {
        setFinished((f) => new Set(f).add(e.agent));
        changed.current();
      } else if (e.type === "done") {
        changed.current();
      }
    });
  }, [tenant, id]);

  const agents = useMemo<AgentStatus[]>(() => {
    const order: string[] = [];
    for (const e of events) if (e.kind === "agent_start" && !order.includes(e.agent)) order.push(e.agent);
    const teamDone = events.some((e) => e.kind === "team_done");
    return order.map((a) => ({
      name: a,
      calls: steps.filter((s) => s.agent === a).length,
      running: !finished.has(a) && !(teamDone && a !== "scribe" && a !== "lore"),
    }));
  }, [events, steps, finished]);

  return { steps, term, running, agents };
}
