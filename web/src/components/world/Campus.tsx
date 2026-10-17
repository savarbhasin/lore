"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type RefObject } from "react";
import type { Group, Mesh, MeshStandardMaterial } from "three";
import { Character, type Motion } from "./Character";
import type { District, NpcSpot, TowerSpot } from "./layout";
import { hsl, lookFor } from "./palette";
import type { PlayerState } from "./Player";

function Building({ d, night }: { d: District; night: boolean }) {
  const { w, h, d: depth } = d.building;
  const floors = Math.max(2, Math.floor((h - 0.8) / 1.5));
  const wall = hsl(d.hue, 0.12, 0.86);
  const accent = hsl(d.hue, 0.55, 0.52);
  const glass = night ? hsl(d.hue + 20, 0.6, 0.62) : "#9fc4d6";
  return (
    <group position={[d.building.x, 0, d.building.z]} rotation={[0, d.building.facing, 0]}>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, depth]} />
        <meshStandardMaterial color={wall} roughness={0.8} />
      </mesh>
      {/* plinth and roof */}
      <mesh position={[0, 0.15, 0]} receiveShadow>
        <boxGeometry args={[w + 0.6, 0.3, depth + 0.6]} />
        <meshStandardMaterial color="#a8a196" roughness={0.9} />
      </mesh>
      <mesh position={[0, h + 0.12, 0]} castShadow>
        <boxGeometry args={[w + 0.3, 0.24, depth + 0.3]} />
        <meshStandardMaterial color={accent} roughness={0.6} />
      </mesh>
      <mesh position={[-w / 4, h + 0.6, -depth / 5]} castShadow>
        <boxGeometry args={[1.6, 0.8, 1.2]} />
        <meshStandardMaterial color="#9a9aa2" metalness={0.4} roughness={0.5} />
      </mesh>
      {/* window bands, front and back */}
      {Array.from({ length: floors }, (_, f) =>
        [1, -1].map((side) => (
          <mesh key={`${f}${side}`} position={[0, 1.5 + f * 1.5, (side * depth) / 2 + side * 0.02]}>
            <boxGeometry args={[w - 1.2, 0.75, 0.05]} />
            <meshStandardMaterial
              color={glass}
              emissive={glass}
              emissiveIntensity={night ? 2.2 : 0.08}
              metalness={0.5}
              roughness={0.15}
              toneMapped={!night}
            />
          </mesh>
        )),
      )}
      {/* entrance */}
      <mesh position={[0, 1.2, depth / 2 + 0.05]}>
        <boxGeometry args={[1.8, 2.3, 0.1]} />
        <meshStandardMaterial color="#1d2430" metalness={0.5} roughness={0.2} />
      </mesh>
      <mesh position={[0, 2.5, depth / 2 + 0.5]} castShadow>
        <boxGeometry args={[3, 0.12, 1.1]} />
        <meshStandardMaterial color={accent} roughness={0.5} />
      </mesh>
    </group>
  );
}

function TeamSign({ d }: { d: District }) {
  return (
    <group position={[d.sign.x, 0, d.sign.z]}>
      <mesh position={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[0.15, 1, 0.15]} />
        <meshStandardMaterial color="#3a3a42" />
      </mesh>
    </group>
  );
}

function Beacon({ color, height = 40, pulse = false }: { color: string; height?: number; pulse?: boolean }) {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    const m = ref.current?.material as MeshStandardMaterial | undefined;
    if (m) m.opacity = pulse ? 0.15 + Math.abs(Math.sin(clock.elapsedTime * 3)) * 0.2 : 0.16;
  });
  return (
    <mesh ref={ref} position={[0, height / 2, 0]}>
      <cylinderGeometry args={[0.12, 0.28, height, 12, 1, true]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2} transparent opacity={0.22} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

export function QuestMarker({ y, done }: { y: number; done: boolean }) {
  const ref = useRef<Group>(null);
  useFrame(({ clock }, dt) => {
    if (!ref.current) return;
    ref.current.rotation.y += dt * 1.8;
    ref.current.position.y = y + Math.sin(clock.elapsedTime * 2.4) * 0.18;
  });
  const color = done ? "#4ade80" : "#fbbf24";
  return (
    <group>
      <group ref={ref} position={[0, y, 0]}>
        <mesh>
          <octahedronGeometry args={[0.38, 0]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={4} toneMapped={false} />
        </mesh>
      </group>
      {!done && <Beacon color={color} height={30} />}
    </group>
  );
}

function Tower({ t, night, quest, incident, discovered }: { t: TowerSpot; night: boolean; quest: boolean; incident: boolean; discovered: boolean }) {
  const light = useRef<Mesh>(null);
  const siren = useRef<Group>(null);
  const segs = Math.max(2, Math.round(t.height / 2.4));
  const body = hsl(t.hue, 0.1, 0.32);
  const strip = hsl(t.hue, 0.75, 0.6);
  useFrame(({ clock }, dt) => {
    const m = light.current?.material as MeshStandardMaterial | undefined;
    if (m) m.emissiveIntensity = incident ? 3 + Math.sin(clock.elapsedTime * 8) * 3 : Math.sin(clock.elapsedTime * 2 + t.x) > 0.7 ? 5 : 0.6;
    if (siren.current) siren.current.rotation.y += dt * 5;
  });
  return (
    <group position={[t.x, t.y, t.z]}>
      <mesh position={[0, -0.5, 0]} receiveShadow>
        <boxGeometry args={[3.6, 1.2, 3.6]} />
        <meshStandardMaterial color="#76736d" roughness={0.9} />
      </mesh>
      {Array.from({ length: segs }, (_, i) => {
        const hgt = t.height / segs;
        const wdt = 2.6 - i * (0.9 / segs);
        return (
          <group key={i} position={[0, hgt * i + hgt / 2, 0]}>
            <mesh castShadow receiveShadow>
              <boxGeometry args={[wdt, hgt - 0.12, wdt]} />
              <meshStandardMaterial color={body} roughness={0.5} metalness={0.35} />
            </mesh>
            {[0, Math.PI / 2, Math.PI, -Math.PI / 2].map((a) => (
              <mesh key={a} position={[Math.sin(a) * (wdt / 2 + 0.01), 0, Math.cos(a) * (wdt / 2 + 0.01)]} rotation={[0, a, 0]}>
                <planeGeometry args={[wdt * 0.18, hgt * 0.7]} />
                <meshStandardMaterial
                  color={incident ? "#f87171" : strip}
                  emissive={incident ? "#ef4444" : strip}
                  emissiveIntensity={night || incident ? 3 : 1.2}
                  toneMapped={false}
                />
              </mesh>
            ))}
          </group>
        );
      })}
      <mesh position={[0, t.height + 0.6, 0]} castShadow>
        <cylinderGeometry args={[0.04, 0.06, 1.2, 6]} />
        <meshStandardMaterial color="#cfcfd4" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh ref={light} position={[0, t.height + 1.25, 0]}>
        <sphereGeometry args={[0.14, 12, 10]} />
        <meshStandardMaterial color={incident ? "#ef4444" : "#f87171"} emissive={incident ? "#ef4444" : "#fb7185"} toneMapped={false} />
      </mesh>
      {incident && (
        <group ref={siren} position={[0, t.height + 0.2, 0]}>
          <pointLight color="#ef4444" intensity={40} distance={24} decay={1.5} position={[0, 0.8, 0]} />
          <Beacon color="#ef4444" height={45} pulse />
        </group>
      )}
      {quest && <QuestMarker y={t.height + 2.4} done={discovered} />}
    </group>
  );
}

function Npc({
  n,
  player,
  quest,
  discovered,
  near,
  speaking,
  level,
}: {
  n: NpcSpot;
  player: RefObject<PlayerState>;
  quest: boolean;
  discovered: boolean;
  near: boolean;
  speaking: boolean;
  level: RefObject<number>;
}) {
  const look = useMemo(() => lookFor(n.person.id, n.hue), [n]);
  const group = useRef<Group>(null);
  const motion = useRef<Motion>({ speed: 0, talk: 0, wave: 0 });
  useFrame((_, dt) => {
    const p = player.current;
    const d = Math.hypot(p.x - n.x, p.z - n.z);
    motion.current.wave = d < 4.5 && d > 2.2 && near && !speaking ? 1 : 0;
    motion.current.talk = speaking ? Math.max(0.2, level.current) : 0;
    if (!group.current) return;
    const want = d < 7 ? Math.atan2(p.x - n.x, p.z - n.z) : n.facing;
    let diff = ((want - group.current.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    group.current.rotation.y += diff * (1 - Math.exp(-dt * 4));
  });
  return (
    <group position={[n.x, 0, n.z]}>
      <group ref={group} rotation={[0, n.facing, 0]}>
        <Character look={look} motion={motion} />
      </group>
      {quest && <QuestMarker y={3} done={discovered} />}
    </group>
  );
}

export function Campus({
  districts,
  night,
  player,
  quests,
  discovered,
  incidents,
  nearbyId,
  speakingId,
  level,
}: {
  districts: District[];
  night: boolean;
  player: RefObject<PlayerState>;
  quests: Set<string>;
  discovered: Set<string>;
  incidents: Set<string>;
  nearbyId: string | null;
  speakingId: string | null;
  level: RefObject<number>;
}) {
  return (
    <group>
      {districts.map((d) => (
        <group key={d.team}>
          <Building d={d} night={night} />
          <TeamSign d={d} />
          {d.people.map((n) => (
            <Npc
              key={n.person.id}
              n={n}
              player={player}
              quest={quests.has(n.person.id)}
              discovered={discovered.has(n.person.id)}
              near={nearbyId === n.person.id}
              speaking={speakingId === n.person.id}
              level={level}
            />
          ))}
          {d.towers.map((t) => (
            <Tower
              key={t.service.id}
              t={t}
              night={night}
              quest={quests.has(t.service.id)}
              incident={incidents.has(t.service.id)}
              discovered={discovered.has(t.service.id)}
            />
          ))}
        </group>
      ))}
    </group>
  );
}
