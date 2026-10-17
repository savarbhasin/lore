"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type RefObject } from "react";
import type { Group, Mesh, MeshStandardMaterial } from "three";
import type { Board } from "@/lib/api";
import type { TermLine } from "../Terminal";
import type { Collider, Pad } from "./layout";
import type { PlayerState } from "./Player";
import { SandboxScreen } from "./SandboxScreen";
import type { AgentStatus } from "./useIncidents";

export const ROOM_RADIUS = 5.6;

const STATUS_COLOR: Record<string, string> = {
  investigating: "#f87171",
  root_cause_found: "#38bdf8",
  awaiting_approval: "#a78bfa",
  needs_human: "#ef4444",
  resolved: "#4ade80",
};
const ACTION_COLOR: Record<string, string> = {
  proposed: "#a78bfa",
  approved: "#38bdf8",
  executing: "#fbbf24",
  executed: "#4ade80",
  rejected: "#52525b",
};

export function roomColliders(pad: Pad): Collider[] {
  const out: Collider[] = [{ x: pad.x, z: pad.z, r: 1.6, see: true }];
  for (const a of pillarAngles(pad)) out.push({ x: pad.x + Math.sin(a) * 5, z: pad.z + Math.cos(a) * 5, r: 0.35, see: true });
  return out;
}

function pillarAngles(pad: Pad) {
  // Eight pillars with a gap facing the plaza, which is the way in.
  const door = pad.angle + Math.PI;
  return Array.from({ length: 9 }, (_, i) => door + ((i + 1) * Math.PI * 2) / 10);
}

function Robot({ agent, angle, color }: { agent: AgentStatus; angle: number; color: string }) {
  const body = useRef<Group>(null);
  const eye = useRef<Mesh>(null);
  const phase = useMemo(() => angle * 7, [angle]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime + phase;
    if (body.current) {
      body.current.position.y = 0.05 + Math.sin(t * (agent.running ? 6 : 1.5)) * (agent.running ? 0.06 : 0.02);
      body.current.rotation.z = agent.running ? Math.sin(t * 9) * 0.05 : 0;
    }
    const m = eye.current?.material as MeshStandardMaterial | undefined;
    if (m) m.emissiveIntensity = agent.running ? 3 + Math.sin(t * 10) * 2 : 2;
  });
  const glow = agent.running ? "#fbbf24" : "#4ade80";
  return (
    <group position={[Math.sin(angle) * 3.9, 0.25, Math.cos(angle) * 3.9]} rotation={[0, angle + Math.PI, 0]}>
      <group ref={body}>
        <mesh position={[0, 0.65, 0]} castShadow>
          <capsuleGeometry args={[0.28, 0.5, 6, 14]} />
          <meshStandardMaterial color="#d4d4d8" metalness={0.6} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.72, 0.25]}>
          <boxGeometry args={[0.3, 0.18, 0.06]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.5} toneMapped={false} />
        </mesh>
        <mesh position={[0, 1.3, 0]} castShadow>
          <sphereGeometry args={[0.26, 20, 16]} />
          <meshStandardMaterial color="#e4e4e7" metalness={0.5} roughness={0.25} />
        </mesh>
        <mesh ref={eye} position={[0, 1.32, 0.21]}>
          <boxGeometry args={[0.32, 0.07, 0.08]} />
          <meshStandardMaterial color={glow} emissive={glow} emissiveIntensity={2} toneMapped={false} />
        </mesh>
        <mesh position={[0, 1.66, 0]}>
          <cylinderGeometry args={[0.015, 0.015, 0.25, 6]} />
          <meshStandardMaterial color="#a1a1aa" />
        </mesh>
        <mesh position={[0, 1.8, 0]}>
          <sphereGeometry args={[0.05, 10, 8]} />
          <meshStandardMaterial color={glow} emissive={glow} emissiveIntensity={4} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

function Terminal({ status, angle, highlighted }: { status: string; angle: number; highlighted: boolean }) {
  const icon = useRef<Mesh>(null);
  const color = ACTION_COLOR[status] ?? "#a1a1aa";
  useFrame(({ clock }, dt) => {
    if (!icon.current) return;
    icon.current.rotation.y += dt * (status === "proposed" ? 1.6 : 0.5);
    icon.current.position.y = 1.55 + Math.sin(clock.elapsedTime * 2 + angle) * 0.06;
    const m = icon.current.material as MeshStandardMaterial;
    m.emissiveIntensity = status === "proposed" || highlighted ? 3 + Math.sin(clock.elapsedTime * 4) * 1.5 : 2;
  });
  return (
    <group position={[Math.sin(angle) * 2.9, 0.25, Math.cos(angle) * 2.9]} rotation={[0, angle + Math.PI, 0]}>
      <mesh position={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[0.55, 1, 0.4]} />
        <meshStandardMaterial color="#27272a" metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.95, 0.12]} rotation={[-0.6, 0, 0]}>
        <planeGeometry args={[0.45, 0.3]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.4} toneMapped={false} />
      </mesh>
      <mesh ref={icon} position={[0, 1.55, 0]}>
        <octahedronGeometry args={[0.16, 0]} />
        <meshStandardMaterial color={color} emissive={color} toneMapped={false} />
      </mesh>
    </group>
  );
}

export function IncidentRoom({
  pad,
  board,
  agents,
  term,
  running,
  playerRef,
  inside,
}: {
  pad: Pad;
  board?: Board;
  agents: AgentStatus[];
  term: TermLine[];
  running: boolean;
  playerRef: RefObject<PlayerState>;
  inside: boolean;
}) {
  const holo = useRef<Mesh>(null);
  const caps = useRef<MeshStandardMaterial[]>([]);
  const status = board?.incident.status ?? "investigating";
  const color = STATUS_COLOR[status] ?? "#f87171";
  const live = status !== "resolved";
  const door = pad.angle + Math.PI;
  const actions = board?.actions ?? [];
  useFrame(({ clock }, dt) => {
    if (holo.current) {
      holo.current.rotation.y += dt * (live ? 1.2 : 0.3);
      holo.current.rotation.x += dt * 0.4;
      holo.current.position.y = 2.1 + Math.sin(clock.elapsedTime * 1.5) * 0.1;
    }
    for (const m of caps.current) if (m) m.emissiveIntensity = live ? 2 + Math.abs(Math.sin(clock.elapsedTime * 3)) * 3 : 1.2;
  });
  const names = agents.length
    ? agents
    : (board ? [...new Set(board.events.map((e) => e.agent).filter((a) => a !== "system"))] : []).map((n) => ({ name: n, running: false, calls: 0 }));

  return (
    <>
      <group position={[pad.x, 0, pad.z]}>
        <mesh position={[0, 0.12, 0]} receiveShadow>
          <cylinderGeometry args={[ROOM_RADIUS, ROOM_RADIUS + 0.2, 0.25, 48]} />
          <meshStandardMaterial color="#3a3d47" roughness={0.6} metalness={0.2} />
        </mesh>
        <mesh position={[0, 0.26, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[ROOM_RADIUS - 0.35, ROOM_RADIUS - 0.15, 64]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.6} toneMapped={false} />
        </mesh>
        {pillarAngles(pad).map((a, i) => (
          <group key={i} position={[Math.sin(a) * 5, 0, Math.cos(a) * 5]}>
            <mesh position={[0, 1.85, 0]} castShadow>
              <cylinderGeometry args={[0.13, 0.17, 3.3, 10]} />
              <meshStandardMaterial color="#c9c9cf" metalness={0.7} roughness={0.25} />
            </mesh>
            <mesh position={[0, 3.55, 0]}>
              <sphereGeometry args={[0.16, 12, 10]} />
              <meshStandardMaterial
                ref={(m) => {
                  if (m) caps.current[i] = m;
                }}
                color={color}
                emissive={color}
                toneMapped={false}
              />
            </mesh>
          </group>
        ))}
        <mesh position={[0, 3.6, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[5, 0.09, 8, 64]} />
          <meshStandardMaterial color="#d4d4d8" metalness={0.8} roughness={0.2} />
        </mesh>
        <mesh position={[0, 3.6, 0]}>
          <sphereGeometry args={[5.05, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.25}
            transparent
            opacity={inside ? 0.04 : 0.1}
            depthWrite={false}
          />
        </mesh>
        {/* holo table */}
        <mesh position={[0, 0.7, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[1.3, 1.1, 0.9, 32]} />
          <meshStandardMaterial color="#1f2129" metalness={0.5} roughness={0.35} />
        </mesh>
        <mesh position={[0, 1.16, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[1.2, 40]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.8} transparent opacity={0.7} toneMapped={false} />
        </mesh>
        <mesh ref={holo} position={[0, 2.1, 0]}>
          <icosahedronGeometry args={[0.55, 1]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2.5} wireframe toneMapped={false} />
        </mesh>
        <pointLight position={[0, 2.2, 0]} color={color} intensity={live ? 18 : 6} distance={9} decay={1.6} />
        {actions.map((a, i) => (
          <Terminal key={a.id} status={a.status} angle={pad.angle + (i - (actions.length - 1) / 2) * 0.7} highlighted={false} />
        ))}
        {names.slice(0, 6).map((ag, i) => (
          <Robot key={ag.name} agent={ag} angle={door + 0.9 + i * ((Math.PI * 2 - 1.8) / Math.max(names.length, 1)) * 0.5} color={color} />
        ))}
      </group>
      <SandboxScreen
        lines={term}
        running={running}
        position={[pad.x + Math.sin(pad.angle) * 1.2, 4.9, pad.z + Math.cos(pad.angle) * 1.2]}
        source={[pad.x, 2.1, pad.z]}
        playerRef={playerRef}
        title="incident sandbox"
      />
    </>
  );
}
