"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import type { Evidence, GNode } from "@/lib/api";
import { LABEL_COLORS } from "@/lib/colors";


type N = GNode & { x?: number; y?: number };
type L = { source: string | N; target: string | N; type: string };
const idOf = (end: string | N) => (typeof end === "string" ? end : end.id);

export default function GraphCanvas({
  evidence,
  focus = [],
  onSelect,
  height,
}: {
  evidence: Evidence;
  focus?: string[];
  onSelect?: (n: GNode | null) => void;
  height?: number;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fg = useRef<ForceGraphMethods<any, any> | undefined>(undefined);
  const [size, setSize] = useState({ w: 600, h: height ?? 500 });
  // Keep node objects stable across updates so the layout grows instead of reshuffling.
  const [cache] = useState(() => new Map<string, N>());

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: height ?? el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [height]);

  const data = useMemo(() => {
    const nodes: N[] = evidence.nodes.map((n) => {
      const existing = cache.get(n.id);
      if (existing) return Object.assign(existing, n);
      const created = { ...n } as N;
      cache.set(n.id, created);
      return created;
    });
    const ids = new Set(nodes.map((n) => n.id));
    const links: L[] = evidence.edges
      .filter((e) => ids.has(e.from) && ids.has(e.to))
      .map((e) => ({ source: e.from, target: e.to, type: e.type }));
    return { nodes, links };
  }, [evidence, cache]);

  const focusSet = useMemo(() => new Set(focus), [focus]);
  // Canvas can't resolve CSS variables, so read the body's resolved font stack once.
  const [family] = useState(() => getComputedStyle(document.body).fontFamily || "sans-serif");

  // Re-fit once the layout settles after new nodes arrive (not on every settle, so user zoom sticks).
  const [fittedAt, setFittedAt] = useState(0);

  return (
    <div ref={wrap} className="h-full w-full" style={height ? { height } : undefined}>
      <ForceGraph2D
        ref={fg}
        width={size.w}
        height={size.h}
        graphData={data}
        backgroundColor="rgba(0,0,0,0)"
        cooldownTicks={120}
        minZoom={0.3}
        maxZoom={5}
        onEngineStop={() => {
          if (fittedAt !== data.nodes.length) {
            fg.current?.zoomToFit(400, 60);
            setFittedAt(data.nodes.length);
          }
        }}
        linkColor={(l) => {
          const { source, target } = l as L;
          return focusSet.has(idOf(source)) && focusSet.has(idOf(target)) ? "rgba(251,191,36,0.85)" : "rgba(161,161,170,0.22)";
        }}
        linkWidth={(l) => {
          const { source, target } = l as L;
          return focusSet.has(idOf(source)) && focusSet.has(idOf(target)) ? 2.2 : 0.8;
        }}
        linkDirectionalArrowLength={3}
        linkDirectionalArrowRelPos={1}
        linkLabel={(l) => (l as L).type}
        nodeLabel={(n) => `${(n as N).label}: ${(n as N).name}`}
        onNodeClick={(n) => onSelect?.(n as N)}
        onBackgroundClick={() => onSelect?.(null)}
        nodeCanvasObject={(raw, ctx, scale) => {
          const node = raw as N;
          const color = LABEL_COLORS[node.label] ?? "#a1a1aa";
          const hot = focusSet.has(node.id);
          const r = node.label === "Incident" || node.label === "Decision" ? 6 : 4.5;
          ctx.beginPath();
          ctx.arc(node.x ?? 0, node.y ?? 0, hot ? r + 1.5 : r, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          if (hot) {
            ctx.shadowColor = "#fbbf24";
            ctx.shadowBlur = 14;
          }
          ctx.fill();
          ctx.shadowBlur = 0;
          if (hot) {
            ctx.lineWidth = 1.5 / scale;
            ctx.strokeStyle = "#fbbf24";
            ctx.stroke();
          }
          const fontSize = Math.max(10 / scale, 2.2);
          // Label only what matters at this zoom: highlighted nodes and anchors; everything once zoomed in.
          const anchor = node.label === "Service" || node.label === "Incident" || node.label === "Decision";
          if (hot || scale > 2.2 || (anchor && scale > 1.1)) {
            const text = node.name.length > 42 ? node.name.slice(0, 40) + "…" : node.name;
            ctx.font = `${hot ? "600" : "500"} ${fontSize}px ${family}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillStyle = hot ? "#fde68a" : "rgba(228,228,231,0.8)";
            ctx.fillText(text, node.x ?? 0, (node.y ?? 0) + r + 2);
          }
        }}
        nodePointerAreaPaint={(node, color, ctx) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(node.x ?? 0, node.y ?? 0, 8, 0, 2 * Math.PI);
          ctx.fill();
        }}
      />
    </div>
  );
}
