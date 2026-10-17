"use client";

import { useFrame } from "@react-three/fiber";
import { useRef, type ReactNode, type RefObject } from "react";
import { Vector3 } from "three";
import type { PlayerState } from "./Player";

export type LabelItem = {
  id: string;
  anchor: [number, number, number] | (() => Vector3 | null);
  /** Visible when the player is within this many metres (ground distance). */
  range: number;
  always?: boolean;
  /** Shrink with camera distance (signs); otherwise constant size. */
  scale?: boolean;
  node: ReactNode;
};

export type LabelRegistry = Map<string, HTMLDivElement>;

/** One DOM layer for every in-world label. Positions are written straight to the elements each frame. */
export function LabelLayer({ items, registry }: { items: LabelItem[]; registry: LabelRegistry }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {items.map((item) => (
        <div
          key={item.id}
          ref={(el) => {
            if (el) registry.set(item.id, el);
            else registry.delete(item.id);
          }}
          className="absolute left-0 top-0 opacity-0 transition-opacity duration-200 will-change-transform"
        >
          {item.node}
        </div>
      ))}
    </div>
  );
}

export function LabelProjector({ items, registry, playerRef }: { items: LabelItem[]; registry: LabelRegistry; playerRef: RefObject<PlayerState> }) {
  const tmp = useRef(new Vector3());
  const world = useRef(new Vector3());
  useFrame(({ camera, size }) => {
    const p = playerRef.current;
    for (const item of items) {
      const el = registry.get(item.id);
      if (!el) continue;
      let v: Vector3 | null;
      if (typeof item.anchor === "function") v = item.anchor();
      else v = world.current.set(item.anchor[0], item.anchor[1], item.anchor[2]);
      if (!v) {
        el.style.opacity = "0";
        continue;
      }
      const ground = Math.hypot(p.x - v.x, p.z - v.z);
      const camDist = camera.position.distanceTo(v);
      tmp.current.copy(v).project(camera);
      const visible = (item.always || ground < item.range) && tmp.current.z < 1 && Math.abs(tmp.current.x) < 1.2 && Math.abs(tmp.current.y) < 1.2;
      if (!visible) {
        el.style.opacity = "0";
        continue;
      }
      const x = ((tmp.current.x + 1) / 2) * size.width;
      const y = ((1 - tmp.current.y) / 2) * size.height;
      const s = item.scale ? Math.min(1.15, Math.max(0.5, 26 / camDist)) : 1;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%) scale(${s.toFixed(3)})`;
      el.style.zIndex = String(10000 - Math.round(camDist * 10));
      el.style.opacity = "1";
    }
  });
  return null;
}
