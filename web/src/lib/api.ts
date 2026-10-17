export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type GNode = { id: string; label: string; name: string; url?: string };
export type GEdge = { from: string; to: string; type: string };
export type Evidence = { nodes: GNode[]; edges: GEdge[] };
export type Source = { id: string; kind: string; title: string; url: string };

export type StreamEvent =
  | { type: "start"; answer_id: string; question: string }
  | { type: "tool_call"; agent: string; tool: string; args: Record<string, unknown> }
  | { type: "tool_result"; agent: string; tool: string; ms: number; evidence: Evidence; sources: Source[]; error?: string | null }
  | { type: "grounding_retry"; agent: string; feedback: string }
  | { type: "agent_done"; agent: string; text: string }
  | { type: "event"; seq: number; agent: string; kind: string; text: string; data: Record<string, unknown>; ts: number }
  | { type: "done"; id?: string; answer?: string; citations?: Source[]; evidence?: Evidence; tool_calls?: number; pull_requests?: string[] }
  | { type: "sandbox_status"; status: string; sandbox_id?: string; ms?: number }
  | { type: "sandbox_cmd"; cmd: string; cwd?: string | null }
  | { type: "sandbox_out"; stream: "stdout" | "stderr"; text: string }
  | { type: "sandbox_exit"; cmd: string; exit_code: number; ms: number }
  | { type: "error"; error: string };

export type Answer = {
  id: string;
  question: string;
  answer: string;
  citations: Source[];
  evidence: Evidence;
  trace: { agent: string; tool: string; args: Record<string, unknown>; cypher: string[] }[];
  tool_calls: number;
  user: string;
  ts: number;
};

export type Person = { id: string; name: string; title: string; team: string };
export type Service = { id: string; tier: number; team: string };

export type Hypothesis = { id: string; statement: string; rationale: string; status: string; claimed_by?: string; by: string };
export type Finding = { id: string; verdict: string; confidence: number; summary: string; by: string; hypothesis_id: string; evidence: string[] };
export type Action = {
  id: string; kind: string; target: string; summary: string; reviewers: string[]; approvers: string[];
  status: string; by: string; decided_by?: string; result?: string;
};
export type Board = {
  incident: { id: string; title: string; text: string; severity: string; status: string; ts: number; tool_calls: number; services: string[] };
  hypotheses: Hypothesis[];
  findings: Finding[];
  actions: Action[];
  events: Extract<StreamEvent, { type: "event" }>[];
};
export type IncidentRow = { id: string; title: string; severity: string; status: string; ts: number; tool_calls: number; services: string[] };

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body?.detail?.error ?? body?.detail ?? r.statusText), { status: r.status, body });
  return body as T;
}

/** Subscribe to a Lore SSE stream. Returns a function that closes it. */
export function stream(path: string, onEvent: (e: StreamEvent) => void): () => void {
  const es = new EventSource(`${API}${path}`);
  es.onmessage = (m) => {
    const e = JSON.parse(m.data) as StreamEvent;
    onEvent(e);
    if (e.type === "done" || e.type === "error") es.close();
  };
  es.onerror = () => es.close();
  return () => es.close();
}

export function mergeEvidence(a: Evidence, b: Evidence): Evidence {
  const nodes = new Map(a.nodes.map((n) => [n.id, n]));
  for (const n of b.nodes) if (!nodes.has(n.id)) nodes.set(n.id, n);
  const key = (e: GEdge) => `${e.from}|${e.type}|${e.to}`;
  const edges = new Map(a.edges.map((e) => [key(e), e]));
  for (const e of b.edges) edges.set(key(e), e);
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

export function ago(ms: number): string {
  const m = (Date.now() - ms) / 60000;
  if (m < 1) return "just now";
  if (m < 90) return `${Math.round(m)} min ago`;
  if (m < 60 * 36) return `${(m / 60).toFixed(1)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
}
