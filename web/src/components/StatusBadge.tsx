const TONES = {
  amber: "bg-amber-400/10 text-amber-300",
  sky: "bg-sky-400/10 text-sky-300",
  violet: "bg-violet-400/10 text-violet-300",
  red: "bg-red-400/10 text-red-300",
  emerald: "bg-emerald-400/10 text-emerald-300",
  zinc: "bg-white/[0.06] text-zinc-400",
} as const;

const DOT: Record<keyof typeof TONES, string> = {
  amber: "bg-amber-400",
  sky: "bg-sky-400",
  violet: "bg-violet-400",
  red: "bg-red-400",
  emerald: "bg-emerald-400",
  zinc: "bg-zinc-500",
};

const STATUS: Record<string, { tone: keyof typeof TONES; label?: string; live?: boolean }> = {
  investigating: { tone: "amber", live: true },
  root_cause_found: { tone: "sky", label: "Root cause found" },
  awaiting_approval: { tone: "violet", label: "Awaiting approval" },
  needs_human: { tone: "red", label: "Needs a human" },
  resolved: { tone: "emerald" },
  proposed: { tone: "violet", label: "Needs approval" },
  approved: { tone: "sky" },
  executing: { tone: "amber", live: true },
  executed: { tone: "emerald", label: "Done" },
  rejected: { tone: "zinc" },
  confirmed: { tone: "emerald" },
  inconclusive: { tone: "zinc" },
  open: { tone: "zinc" },
  claimed: { tone: "amber", label: "Testing", live: true },
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const s = STATUS[status] ?? { tone: "zinc" as const };
  const text = label ?? s.label ?? status.replaceAll("_", " ");
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium ${TONES[s.tone]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[s.tone]} ${s.live ? "animate-pulse" : ""}`} />
      <span className="first-letter:uppercase">{text}</span>
    </span>
  );
}
