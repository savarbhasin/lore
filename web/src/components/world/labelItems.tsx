import { Vector3 } from "three";
import type { Evidence } from "@/lib/api";
import { LABEL_COLORS } from "@/lib/colors";
import type { LabelItem } from "./Labels";
import type { World } from "./layout";
import { hsl } from "./palette";

const pill = "whitespace-nowrap rounded-lg bg-black/60 px-2.5 py-1 text-center backdrop-blur";

export function worldLabels({
  world,
  meName,
  youAnchor,
  oracleStatus,
  incidents,
  quests,
  evidence,
  orbPositions,
  cited,
  focus,
  hovered,
  npcStatus,
  rooms,
}: {
  npcStatus?: { id: string; text: string } | null;
  rooms: { id: string; x: number; z: number; title: string; severity: string; status: string }[];
  world: World;
  meName: string;
  youAnchor: () => Vector3;
  oracleStatus?: string;
  incidents: Set<string>;
  quests: Set<string>;
  evidence?: Evidence;
  orbPositions: Map<string, Vector3>;
  cited: Set<string>;
  focus: string | null;
  hovered: string | null;
}): LabelItem[] {
  const items: LabelItem[] = [];
  items.push({
    id: "you",
    anchor: youAnchor,
    range: 1,
    always: true,
    node: (
      <div className="whitespace-nowrap rounded-full bg-black/55 px-2.5 py-0.5 text-[11px] font-medium text-amber-200 backdrop-blur">
        {meName} (you)
      </div>
    ),
  });
  items.push({
    id: "lore",
    anchor: [0, 5.8, 0],
    range: 60,
    node: (
      <div className="flex flex-col items-center gap-1">
        <div className="whitespace-nowrap rounded-full bg-black/60 px-3 py-1 text-[12px] font-semibold text-amber-200 backdrop-blur">Lore</div>
        {oracleStatus && (
          <div className="max-w-[280px] truncate whitespace-nowrap rounded-full bg-black/55 px-2.5 py-0.5 text-[11px] text-zinc-200 backdrop-blur">
            {oracleStatus}
          </div>
        )}
      </div>
    ),
  });
  for (const d of world.districts) {
    items.push({
      id: `team:${d.team}`,
      anchor: [d.sign.x, 2.3, d.sign.z],
      range: 1,
      always: true,
      scale: true,
      node: (
        <div
          className="whitespace-nowrap rounded-xl px-4 py-1.5 text-[18px] font-semibold text-white shadow-lg"
          style={{ background: hsl(d.hue, 0.5, 0.38) }}
        >
          {d.team}
        </div>
      ),
    });
    for (const n of d.people) {
      const status = npcStatus?.id === n.person.id ? npcStatus.text : null;
      items.push({
        id: n.person.id,
        anchor: [n.x, 2.4, n.z],
        range: 13,
        always: quests.has(n.person.id) || !!status,
        node: (
          <div className="flex flex-col items-center gap-1">
            {status && <div className="text-shimmer whitespace-nowrap rounded-full bg-black/60 px-2.5 py-0.5 text-[11px] font-medium">{status}</div>}
            <div className={`flex flex-col items-center ${pill}`}>
              <span className="text-[11.5px] font-semibold text-white">{n.person.name}</span>
              <span className="text-[10px] text-zinc-300">{n.person.title}</span>
            </div>
          </div>
        ),
      });
    }
    for (const t of d.towers) {
      const hot = incidents.has(t.service.id);
      items.push({
        id: t.service.id,
        anchor: [t.x, t.y + 3.6, t.z],
        range: 17,
        always: hot || quests.has(t.service.id),
        node: (
          <div className={`flex flex-col items-center ${pill}`}>
            <span className={`font-mono text-[12px] font-semibold ${hot ? "text-red-300" : "text-white"}`}>{t.service.id}</span>
            <span className="text-[10px] text-zinc-300">
              tier {t.service.tier} · {t.service.team ?? "unowned"}
              {hot ? " · incident" : ""}
            </span>
          </div>
        ),
      });
    }
  }
  for (const r of rooms)
    items.push({
      id: `room:${r.id}`,
      anchor: [r.x, 6.4, r.z],
      range: 45,
      node: (
        <div className="flex flex-col items-center whitespace-nowrap rounded-xl bg-red-950/80 px-3 py-1.5 text-center shadow-[0_0_30px_-6px] shadow-red-500 backdrop-blur">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-red-300">
            {r.severity} · war room · {r.status.replaceAll("_", " ")}
          </span>
          <span className="max-w-[260px] truncate text-[12.5px] font-semibold text-white">{r.title}</span>
        </div>
      ),
    });
  for (const n of evidence?.nodes ?? []) {
    if (world.anchors.has(n.id)) continue;
    const at = new Vector3();
    const show = cited.has(n.id) || focus === n.id || hovered === n.id;
    const color = LABEL_COLORS[n.label] ?? "#a1a1aa";
    items.push({
      id: `orb:${n.id}`,
      anchor: () => {
        const p = orbPositions.get(n.id);
        return p ? at.copy(p).setY(p.y + 0.9) : null;
      },
      range: -1,
      always: show,
      node: (
        <div className={`flex max-w-[220px] flex-col items-center ${pill}`}>
          <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color }}>
            {n.label}
          </span>
          <span className="truncate text-[11.5px] text-white">{n.id.replace(/^file:/, "")}</span>
          {(focus === n.id || hovered === n.id) && n.name !== n.id && <span className="line-clamp-2 text-[10.5px] text-zinc-300">{n.name}</span>}
        </div>
      ),
    });
  }
  return items;
}
