"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { CanvasTexture, SRGBColorSpace, Vector3, type Group, type Mesh, type MeshStandardMaterial } from "three";
import type { TermLine } from "../Terminal";
import type { PlayerState } from "./Player";

const W = 1024;
const H = 700;

function draw(canvas: HTMLCanvasElement, lines: TermLine[], running: boolean, title: string, blink: boolean) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const mono = getComputedStyle(document.body).getPropertyValue("--font-jetbrains").trim() || "monospace";
  ctx.fillStyle = "#020a07";
  ctx.fillRect(0, 0, W, H);
  // scanlines
  ctx.fillStyle = "rgba(52, 211, 153, 0.035)";
  for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
  ctx.fillStyle = "rgba(16, 185, 129, 0.12)";
  ctx.fillRect(0, 0, W, 58);
  ctx.fillStyle = running ? "#34d399" : "#065f46";
  ctx.beginPath();
  ctx.arc(34, 29, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `600 24px ${mono}`;
  ctx.fillStyle = "#6ee7b7";
  ctx.fillText(title.toUpperCase(), 56, 37);
  ctx.textAlign = "right";
  ctx.fillStyle = running ? "#a7f3d0" : "#047857";
  ctx.fillText(running ? "running" : "idle", W - 28, 37);
  ctx.textAlign = "left";

  const size = 25;
  const lineH = 34;
  ctx.font = `${size}px ${mono}`;
  const max = Math.floor((H - 90) / lineH);
  const tail = lines.slice(-max);
  let y = H - 24 - (tail.length - 1) * lineH - (running ? lineH : 0);
  const fit = (s: string) => (ctx.measureText(s).width > W - 56 ? s.slice(0, Math.floor(((W - 56) / ctx.measureText(s).width) * s.length) - 1) + "…" : s);
  for (const l of tail) {
    if (l.kind === "cmd") {
      ctx.fillStyle = "#10b981";
      ctx.fillText("$", 28, y);
      ctx.fillStyle = "#ecfdf5";
      ctx.fillText(fit(l.text), 56, y);
    } else if (l.kind === "out") {
      ctx.fillStyle = l.stderr ? "#fcd34d" : "#a7f3d0";
      ctx.globalAlpha = 0.85;
      ctx.fillText(fit(l.text), 28, y);
      ctx.globalAlpha = 1;
    } else if (l.kind === "exit") {
      ctx.fillStyle = l.code === 0 ? "#059669" : "#f87171";
      ctx.fillText(`[exit ${l.code} · ${l.ms}ms]`, 28, y);
    } else {
      ctx.fillStyle = "#7dd3fc";
      ctx.fillText(fit(l.text), 28, y);
    }
    y += lineH;
  }
  if (running && blink) {
    ctx.fillStyle = "#6ee7b7";
    ctx.fillRect(28, y - size + 4, 14, size);
  }
}

function repaint(canvas: HTMLCanvasElement, texture: CanvasTexture, lines: TermLine[], running: boolean, title: string, blink: boolean) {
  draw(canvas, lines, running, title, blink);
  texture.needsUpdate = true;
}

/**
 * A holographic terminal that floats beside whoever is working in the sandbox (Lore, or an incident room's
 * agents), showing the commands it runs and their output as they stream in. Light packets fly from the worker
 * to the screen while a command runs.
 */
export function SandboxScreen({
  lines,
  running,
  position,
  source,
  playerRef,
  title = "sandbox",
  beside,
}: {
  /** Float this far to the right of `source`, as seen from the player, instead of at a fixed `position`. */
  beside?: number;
  lines: TermLine[];
  running: boolean;
  position: [number, number, number];
  source: [number, number, number];
  playerRef: RefObject<PlayerState>;
  title?: string;
}) {
  const group = useRef<Group>(null);
  const frame = useRef<Mesh>(null);
  const packets = useRef<Group>(null);
  const canvas = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    return c;
  }, []);
  const texture = useMemo(() => {
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, [canvas]);
  const show = lines.length > 0;
  const from = useMemo(() => new Vector3(...source), [source]);
  const to = useMemo(() => new Vector3(...position), [position]);
  const at = useRef(new Vector3(...position));

  useEffect(() => {
    let blink = true;
    const paint = () => repaint(canvas, texture, lines, running, title, blink);
    paint();
    if (!running) return;
    const id = setInterval(() => {
      blink = !blink;
      paint();
    }, 500);
    return () => clearInterval(id);
  }, [canvas, texture, lines, running, title]);

  useEffect(() => () => texture.dispose(), [texture]);

  useFrame(({ clock }, dt) => {
    const g = group.current;
    if (!g) return;
    const p = playerRef.current;
    if (beside) {
      const dx = p.x - source[0];
      const dz = p.z - source[2];
      const len = Math.hypot(dx, dz) || 1;
      const goal = new Vector3(source[0] + (dz / len) * beside + (dx / len) * 1.2, position[1], source[2] - (dx / len) * beside + (dz / len) * 1.2);
      at.current.lerp(goal, 1 - Math.exp(-dt * 2));
    } else at.current.set(...position);
    g.position.copy(at.current);
    to.copy(at.current);
    const want = Math.atan2(p.x - at.current.x, p.z - at.current.z);
    g.rotation.y += (((want - g.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * (1 - Math.exp(-dt * 3));
    const s = g.scale.x + ((show ? 1 : 0.001) - g.scale.x) * (1 - Math.exp(-dt * 6));
    g.scale.setScalar(s);
    g.visible = s > 0.01;
    const m = frame.current?.material as MeshStandardMaterial | undefined;
    if (m) m.emissiveIntensity = running ? 2.5 + Math.sin(clock.elapsedTime * 8) * 0.8 : 1.2;
    if (packets.current) {
      packets.current.visible = running && show;
      const kids = packets.current.children;
      kids.forEach((c, i) => {
        const t = (clock.elapsedTime * 0.9 + i / kids.length) % 1;
        c.position.copy(from).lerp(to, t);
        c.position.y += Math.sin(t * Math.PI) * 0.8;
      });
    }
  });

  return (
    <>
      <group ref={group} position={position} scale={0.001}>
        <mesh ref={frame} position={[0, 0, -0.02]}>
          <planeGeometry args={[3.76, 2.66]} />
          <meshStandardMaterial color="#10b981" emissive="#10b981" emissiveIntensity={1.2} transparent opacity={0.6} toneMapped={false} />
        </mesh>
        <mesh>
          <planeGeometry args={[3.6, 2.46]} />
          <meshBasicMaterial map={texture} transparent opacity={0.94} toneMapped={false} />
        </mesh>
      </group>
      <group ref={packets} visible={false}>
        {Array.from({ length: 6 }, (_, i) => (
          <mesh key={i}>
            <sphereGeometry args={[0.07, 8, 6]} />
            <meshStandardMaterial color="#34d399" emissive="#34d399" emissiveIntensity={5} toneMapped={false} />
          </mesh>
        ))}
      </group>
    </>
  );
}
