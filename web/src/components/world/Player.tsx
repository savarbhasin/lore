"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, type RefObject } from "react";
import { Vector3, type DirectionalLight, type Group } from "three";
import { Character, type Motion } from "./Character";
import { heightAt, WALK_RADIUS, type Collider, type Interactable } from "./layout";
import type { Look } from "./palette";

export type PlayerState = { x: number; z: number; heading: number; yaw: number };
export type Mode = "intro" | "explore" | "talk";

const KEYS: Record<string, "f" | "b" | "l" | "r" | "run"> = {
  KeyW: "f",
  ArrowUp: "f",
  KeyS: "b",
  ArrowDown: "b",
  KeyA: "l",
  ArrowLeft: "l",
  KeyD: "r",
  ArrowRight: "r",
  ShiftLeft: "run",
  ShiftRight: "run",
};

function typing(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

function lerpAngle(a: number, b: number, t: number) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function Player({
  look,
  stateRef,
  modeRef,
  colliders,
  interactables,
  onNearby,
  sunRef,
  guide,
  talkRef,
  autopilotRef,
}: {
  look: Look;
  stateRef: RefObject<PlayerState>;
  modeRef: RefObject<Mode>;
  colliders: Collider[];
  interactables: Interactable[];
  onNearby: (i: Interactable | null) => void;
  sunRef: RefObject<DirectionalLight | null>;
  guide: [number, number, number][] | null;
  /** Where the conversation partner's head is (Lore or an NPC), for framing the talk camera. */
  talkRef: RefObject<[number, number, number]>;
  /** Dev-only: walk to a target on its own (used to film scripted demos). */
  autopilotRef: RefObject<{ target: [number, number] | null; run?: boolean }>;
}) {
  const arrow = useRef<Group>(null);
  const group = useRef<Group>(null);
  const motion = useRef<Motion>({ speed: 0, talk: 0, wave: 0 });
  const keys = useRef({ f: false, b: false, l: false, r: false, run: false });
  const cam = useRef({ yaw: 0, pitch: 0.38, dist: 10 });
  const vel = useRef(new Vector3());
  const nearest = useRef<string | null>(null);
  const scan = useRef(0);
  const look3 = useRef(new Vector3(0, 6, 0));
  const gl = useThree((t) => t.gl);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const k = KEYS[e.code];
      if (k) keys.current[k] = true;
    };
    const up = (e: KeyboardEvent) => {
      const k = KEYS[e.code];
      if (k) keys.current[k] = false;
    };
    const blur = () => {
      keys.current = { f: false, b: false, l: false, r: false, run: false };
    };
    const el = gl.domElement;
    let drag: { x: number; y: number } | null = null;
    const pdown = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    };
    const pmove = (e: PointerEvent) => {
      if (!drag) return;
      cam.current.yaw -= (e.clientX - drag.x) * 0.0055;
      cam.current.pitch = Math.min(1.25, Math.max(0.08, cam.current.pitch + (e.clientY - drag.y) * 0.004));
      drag = { x: e.clientX, y: e.clientY };
    };
    const pup = (e: PointerEvent) => {
      drag = null;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      cam.current.dist = Math.min(26, Math.max(4.5, cam.current.dist + e.deltaY * 0.012));
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    el.addEventListener("pointerdown", pdown);
    el.addEventListener("pointermove", pmove);
    el.addEventListener("pointerup", pup);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      el.removeEventListener("pointerdown", pdown);
      el.removeEventListener("pointermove", pmove);
      el.removeEventListener("pointerup", pup);
      el.removeEventListener("wheel", wheel);
    };
  }, [gl]);

  useFrame((frame, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const p = stateRef.current;
    const camera = frame.camera;
    const sun = sunRef.current;
    if (modeRef.current === "intro") {
      const a = frame.clock.elapsedTime * 0.06;
      camera.position.set(Math.sin(a) * 74, 34, Math.cos(a) * 74);
      camera.lookAt(0, 4, 0);
      if (group.current) group.current.position.set(p.x, heightAt(p.x, p.z), p.z);
      return;
    }
    const k = keys.current;
    const talking = modeRef.current === "talk";
    const c = cam.current;

    // Movement relative to the camera.
    const fx = -Math.sin(c.yaw);
    const fz = -Math.cos(c.yaw);
    let ix = 0;
    let iz = 0;
    if (!talking) {
      const fwd = (k.f ? 1 : 0) - (k.b ? 1 : 0);
      const side = (k.r ? 1 : 0) - (k.l ? 1 : 0);
      ix = fx * fwd - fz * side;
      iz = fz * fwd + fx * side;
    }
    const pilot = autopilotRef.current;
    if (pilot.target && !talking) {
      const dx = pilot.target[0] - p.x;
      const dz = pilot.target[1] - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.6) autopilotRef.current.target = null;
      else {
        ix = dx / d;
        iz = dz / d;
        // Swing the camera in behind the walker, like a follow cam.
        c.yaw = lerpAngle(c.yaw, Math.atan2(-ix, -iz), 1 - Math.exp(-dt * 1.6));
      }
    }
    const len = Math.hypot(ix, iz);
    const top = k.run || pilot.run ? 9 : 5;
    const target = len > 0 ? new Vector3((ix / len) * top, 0, (iz / len) * top) : new Vector3();
    vel.current.lerp(target, 1 - Math.exp(-dt * 10));
    let x = p.x + vel.current.x * dt;
    let z = p.z + vel.current.z * dt;
    for (const col of colliders) {
      const dx = x - col.x;
      const dz = z - col.z;
      const d = Math.hypot(dx, dz);
      const min = col.r + 0.4;
      if (d < min && d > 1e-4) {
        x = col.x + (dx / d) * min;
        z = col.z + (dz / d) * min;
      }
    }
    const r = Math.hypot(x, z);
    if (r > WALK_RADIUS) {
      x = (x / r) * WALK_RADIUS;
      z = (z / r) * WALK_RADIUS;
    }
    const speed = Math.hypot(x - p.x, z - p.z) / Math.max(dt, 1e-4);
    p.x = x;
    p.z = z;
    const [tx, ty, tz] = talkRef.current;
    if (talking) p.heading = lerpAngle(p.heading, Math.atan2(tx - x, tz - z), 1 - Math.exp(-dt * 6));
    else if (speed > 0.3) p.heading = lerpAngle(p.heading, Math.atan2(vel.current.x, vel.current.z), 1 - Math.exp(-dt * 12));
    motion.current.speed = speed;
    motion.current.talk = 0;

    const y = heightAt(x, z);
    if (group.current) {
      group.current.position.set(x, y, z);
      group.current.rotation.y = p.heading;
    }
    if (arrow.current) {
      let best: [number, number, number] | null = null;
      let bestD = Infinity;
      for (const g of guide ?? []) {
        const d = Math.hypot(g[0] - x, g[2] - z);
        if (d < bestD) {
          bestD = d;
          best = g;
        }
      }
      arrow.current.visible = !!best && bestD > 5 && !talking;
      if (best) {
        arrow.current.position.set(x, y + 0.08, z);
        arrow.current.rotation.y = Math.atan2(best[0] - x, best[2] - z);
      }
    }

    // Camera: orbit behind the player, or frame the player and Lore while talking.
    let yaw = c.yaw;
    let pitch = c.pitch;
    let dist = c.dist;
    const focus = new Vector3(x, y + 1.6, z);
    if (talking) {
      const near = Math.hypot(tx - x, tz - z) < 4;
      yaw = Math.atan2(x - tx, z - tz) + (near ? 1.0 : 0.55);
      pitch = near ? 0.16 : 0.22;
      dist = near ? 6.5 : 8.5;
      focus.lerp(new Vector3(tx, ty, tz), near ? 0.55 : 0.45);
      c.yaw = lerpAngle(c.yaw, yaw, 1 - Math.exp(-dt * 3));
    }
    p.yaw = c.yaw;
    const want = new Vector3(
      focus.x + Math.sin(talking ? c.yaw : yaw) * Math.cos(pitch) * dist,
      focus.y + Math.sin(pitch) * dist,
      focus.z + Math.cos(talking ? c.yaw : yaw) * Math.cos(pitch) * dist,
    );
    // Pull the camera in front of trees and buildings that would hide the player.
    const sx = want.x - focus.x;
    const sz = want.z - focus.z;
    const segLen = Math.hypot(sx, sz);
    if (segLen > 0.01) {
      let keep = 1;
      for (const col of colliders) {
        if (col.see) continue;
        const reach = col.r < 1.2 ? col.r * 2.6 + 0.3 : col.r + 0.6;
        const t = ((col.x - focus.x) * sx + (col.z - focus.z) * sz) / (segLen * segLen);
        if (t <= 0.12 || t > 1.05) continue;
        const px = focus.x + sx * t - col.x;
        const pz = focus.z + sz * t - col.z;
        if (px * px + pz * pz < reach * reach) keep = Math.min(keep, Math.max(0.25, t - reach / segLen));
      }
      if (keep < 1) {
        want.x = focus.x + sx * keep;
        want.z = focus.z + sz * keep;
        want.y = focus.y + (want.y - focus.y) * Math.max(keep, 0.6);
      }
    }
    want.y = Math.max(want.y, heightAt(want.x, want.z) + 0.8);
    camera.position.lerp(want, 1 - Math.exp(-dt * (talking ? 3 : 6)));
    look3.current.lerp(focus, 1 - Math.exp(-dt * 8));
    camera.lookAt(look3.current);

    // Keep the shadow camera centred on the player so shadows stay crisp.
    if (sun) {
      sun.position.set(x + 30, 45, z + 18);
      sun.target.position.set(x, 0, z);
      sun.target.updateMatrixWorld();
    }

    scan.current += dt;
    if (scan.current > 0.12) {
      scan.current = 0;
      let best: Interactable | null = null;
      let bestD = Infinity;
      for (const it of interactables) {
        const d = Math.hypot(it.x - x, it.z - z) - it.r;
        if (d < 0 && d < bestD) {
          best = it;
          bestD = d;
        }
      }
      const id = best?.id ?? null;
      if (id !== nearest.current) {
        nearest.current = id;
        onNearby(best);
      }
    }
  });

  return (
    <>
      <group ref={arrow} visible={false}>
        <mesh position={[0, 0, 1.25]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.28, 0.6, 3]} />
          <meshStandardMaterial color="#fbbf24" emissive="#f59e0b" emissiveIntensity={3} toneMapped={false} />
        </mesh>
      </group>
      <group ref={group}>
        <Character look={look} motion={motion} />
        <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.55, 0.68, 40]} />
          <meshBasicMaterial color="#fbbf24" transparent opacity={0.85} />
        </mesh>
      </group>
    </>
  );
}
