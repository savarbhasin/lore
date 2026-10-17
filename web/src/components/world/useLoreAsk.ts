"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, mergeEvidence, stream, type Evidence, type Source } from "@/lib/api";
import { applyTerm, type TermLine } from "../Terminal";
import { applyStep, type Step } from "../ToolSteps";

export type Exchange = {
  question: string;
  answerId?: string;
  steps: Step[];
  evidence: Evidence;
  text?: string;
  citations: Source[];
  status: "thinking" | "done" | "error";
  error?: string;
  sandbox: boolean;
  /** Live sandbox terminal (commands and output) while the agent works in its machine. */
  term: TermLine[];
  /** "lore" or the id of the person who answers. */
  speaker: string;
};

const EMPTY: Evidence = { nodes: [], edges: [] };

export function useLoreAsk(tenant: string, person: string) {
  const [current, setCurrent] = useState<Exchange | null>(null);
  const [history, setHistory] = useState<Exchange[]>([]);
  const session = useRef(`world:${Math.random().toString(36).slice(2, 10)}`);
  const close = useRef<(() => void) | null>(null);
  const latest = useRef<Exchange | null>(null);

  useEffect(() => {
    latest.current = current;
  }, [current]);

  useEffect(() => {
    close.current?.();
    session.current = `world:${Math.random().toString(36).slice(2, 10)}`;
    setCurrent(null);
    setHistory([]);
  }, [tenant, person]);

  useEffect(() => () => close.current?.(), []);

  const ask = useCallback(
    async (q: string, speaker = "lore") => {
      const question = q.trim();
      if (!question) return;
      close.current?.();
      const prev = latest.current;
      if (prev?.status === "done") setHistory((h) => [...h, prev]);
      setCurrent({ question, steps: [], evidence: EMPTY, citations: [], status: "thinking", sandbox: false, term: [], speaker });
      const update = (f: (x: Exchange) => Exchange) => setCurrent((x) => (x && x.question === question ? f(x) : x));
      try {
        const { answer_id } =
          speaker === "lore"
            ? await api<{ answer_id: string }>("/api/ask", {
                method: "POST",
                body: JSON.stringify({ tenant, user: person, question, session_id: session.current, surface: "world", voice: true }),
              })
            : await api<{ answer_id: string }>("/api/ask_person", {
                method: "POST",
                body: JSON.stringify({ tenant, user: person, person: speaker, question, surface: "world", voice: true }),
              });
        update((x) => ({ ...x, answerId: answer_id }));
        close.current = stream(`/api/answers/${answer_id}/stream`, (e) => {
          if (e.type === "tool_call" || e.type === "tool_result") {
            update((x) => ({
              ...x,
              steps: applyStep(x.steps, e),
              evidence: e.type === "tool_result" ? mergeEvidence(x.evidence, e.evidence) : x.evidence,
            }));
          } else if (e.type.startsWith("sandbox_")) {
            update((x) => ({
              ...x,
              sandbox: e.type === "sandbox_cmd" ? true : e.type === "sandbox_exit" ? false : x.sandbox,
              term: applyTerm(x.term, e),
            }));
          } else if (e.type === "done") {
            update((x) => ({
              ...x,
              status: "done",
              text: e.answer,
              citations: e.citations ?? [],
              evidence: e.evidence ? mergeEvidence(x.evidence, e.evidence) : x.evidence,
            }));
          } else if (e.type === "error") {
            update((x) => ({ ...x, status: "error", error: e.error }));
          }
        });
      } catch (err) {
        update((x) => ({ ...x, status: "error", error: String((err as Error).message ?? err) }));
      }
    },
    [tenant, person],
  );

  return { current, history, ask };
}
