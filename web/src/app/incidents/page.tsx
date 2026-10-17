"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAppState } from "@/components/AppState";
import { StatusBadge } from "@/components/StatusBadge";
import { api, ago, type IncidentRow, type Service } from "@/lib/api";

const DEMO_ALERT = {
  service_id: "checkout",
  title: "checkout p99 latency > 2s",
  text: "checkout p99 latency spiked to 2.4s (normally 180ms); payments capture latency up",
  severity: "SEV1",
};

export default function IncidentsPage() {
  const { tenant } = useAppState();
  const router = useRouter();
  const [rows, setRows] = useState<IncidentRow[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [form, setForm] = useState({ ...DEMO_ALERT });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<IncidentRow[]>(`/api/incidents?tenant=${tenant}`).then(setRows).catch(() => setRows([]));
    api<Service[]>(`/api/services?tenant=${tenant}`)
      .then((s) => {
        setServices(s);
        if (s.length && !s.some((x) => x.id === form.service_id)) setForm((f) => ({ ...f, service_id: s[0].id }));
      })
      .catch(() => setServices([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant]);

  useEffect(load, [load]);

  async function trigger(body: typeof DEMO_ALERT) {
    setBusy("trigger");
    setError(null);
    try {
      const { incident_id } = await api<{ incident_id: string }>("/api/incidents", {
        method: "POST",
        body: JSON.stringify({ tenant, ...body }),
      });
      router.push(`/incidents/${incident_id}`);
    } catch (e) {
      setError(String((e as Error).message));
      setBusy(null);
    }
  }

  async function reset() {
    setBusy("reset");
    await api(`/api/seed?tenant=${tenant}`, { method: "POST" }).catch((e) => setError(String(e.message)));
    setBusy(null);
    load();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Incidents</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Fire an alert and watch Lore&apos;s agent team work the graph: triage, parallel investigators, a responder that
            proposes actions for humans to approve, and a scribe that remembers the fix.
          </p>
        </div>
        <button onClick={reset} disabled={busy !== null} className="shrink-0 rounded-md border border-line px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-100 disabled:opacity-40">
          {busy === "reset" ? "resetting…" : "Reset demo data"}
        </button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          trigger(form);
        }}
        className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-[180px_1fr_110px_auto]"
      >
        <select value={form.service_id} onChange={(e) => setForm({ ...form, service_id: e.target.value })} className="rounded-lg border border-line bg-elevated outline-none focus:border-line-strong px-2 py-2 text-sm">
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id}
            </option>
          ))}
        </select>
        <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="rounded-lg border border-line bg-elevated outline-none focus:border-line-strong px-3 py-2 text-sm" placeholder="alert title" />
        <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })} className="rounded-lg border border-line bg-elevated outline-none focus:border-line-strong px-2 py-2 text-sm">
          {["SEV1", "SEV2", "SEV3"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <button disabled={busy !== null} className="rounded-md bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-400 disabled:opacity-40">
          {busy === "trigger" ? "opening…" : "Fire alert"}
        </button>
        <input value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} className="rounded-lg border border-line bg-elevated outline-none focus:border-line-strong px-3 py-2 text-sm sm:col-span-4" placeholder="alert details" />
      </form>
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="overflow-hidden rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-3 py-2">Incident</th>
              <th className="px-3 py-2">Services</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Tool calls</th>
              <th className="px-3 py-2 text-right">Opened</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line hover:bg-surface">
                <td className="px-3 py-2">
                  <Link href={`/incidents/${r.id}`} className="text-zinc-100 hover:underline">
                    <span className="font-mono text-xs text-zinc-500">{r.id}</span> {r.title}
                  </Link>
                  <span className="ml-2 text-xs text-zinc-600">{r.severity}</span>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-zinc-400">{r.services.join(", ")}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs text-zinc-400">{r.tool_calls ?? "—"}</td>
                <td className="px-3 py-2 text-right text-xs text-zinc-500">{ago(r.ts)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
