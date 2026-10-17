"use client";

import { Sparkles } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef, type RefObject } from "react";
import { Color, type Group, type Mesh, type MeshStandardMaterial, type PointLight } from "three";
import type { PlayerState } from "./Player";

export type OracleMood = "idle" | "listening" | "thinking" | "working" | "speaking";

const MOOD_COLOR: Record<OracleMood, string> = {
  idle: "#fbbf24",
  listening: "#38bdf8",
  thinking: "#c084fc",
  speaking: "#fcd34d",
  working: "#34d399",
};

export function Oracle({ mood, player, level }: { mood: OracleMood; player: RefObject<PlayerState>; level: RefObject<number> }) {
  const float = useRef<Group>(null);
  const facing = useRef<Group>(null);
  const ringA = useRef<Mesh>(null);
  const ringB = useRef<Mesh>(null);
  const halo = useRef<Mesh>(null);
  const core = useRef<Mesh>(null);
  const handL = useRef<Mesh>(null);
  const handR = useRef<Mesh>(null);
  const light = useRef<PointLight>(null);
  const mats = useRef<MeshStandardMaterial[]>([]);
  const tint = useRef(new Color(MOOD_COLOR.idle));

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    tint.current.lerp(new Color(MOOD_COLOR[mood]), 1 - Math.exp(-dt * 4));
    const spin = mood === "thinking" ? 3.2 : mood === "working" ? 4.5 : mood === "listening" ? 1.6 : 0.5;
    const pulse =
      mood === "speaking"
        ? 1 + level.current * 0.7
        : mood === "thinking" || mood === "working"
          ? 1 + Math.sin(t * 6) * 0.15
          : 1 + Math.sin(t * 2) * 0.05;
    if (float.current) float.current.position.y = 2.7 + Math.sin(t * 1.3) * 0.18;
    if (facing.current) {
      const p = player.current;
      const want = Math.atan2(p.x, p.z);
      let d = ((want - facing.current.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (d < -Math.PI) d += Math.PI * 2;
      facing.current.rotation.y += d * (1 - Math.exp(-dt * 2.5));
    }
    if (ringA.current) {
      ringA.current.rotation.z += dt * spin;
      ringA.current.rotation.x = Math.PI / 2 + Math.sin(t * 0.7) * 0.25;
    }
    if (ringB.current) {
      ringB.current.rotation.z -= dt * spin * 0.7;
      ringB.current.rotation.y = Math.sin(t * 0.5) * 0.6;
    }
    if (halo.current) halo.current.rotation.z += dt * 0.8;
    if (core.current) core.current.scale.setScalar(pulse);
    if (handL.current && handR.current) {
      const lift =
        mood === "speaking" ? Math.sin(t * 3) * 0.2 : mood === "listening" ? 0.25 : mood === "working" ? 0.35 + Math.sin(t * 14) * 0.06 : 0;
      handL.current.position.set(-0.95, 0.15 + Math.sin(t * 1.7) * 0.08 + lift, 0.2);
      handR.current.position.set(0.95, 0.15 + Math.cos(t * 1.5) * 0.08 + lift, 0.2);
    }
    for (const m of mats.current) {
      m.emissive.copy(tint.current);
      m.color.copy(tint.current);
    }
    if (light.current) {
      light.current.color.copy(tint.current);
      light.current.intensity = 14 * pulse;
    }
  });

  const glow = (i: number, intensity = 3) => (
    <meshStandardMaterial
      ref={(m) => {
        if (m) mats.current[i] = m;
      }}
      emissive={MOOD_COLOR.idle}
      emissiveIntensity={intensity}
      toneMapped={false}
    />
  );

  return (
    <group>
      {/* pedestal */}
      <mesh position={[0, 0.35, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[2.6, 2.9, 0.5, 48]} />
        <meshStandardMaterial color="#e7e1d4" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.8, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[2.0, 2.3, 0.4, 48]} />
        <meshStandardMaterial color="#d8d0bf" roughness={0.6} />
      </mesh>
      <mesh position={[0, 1.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.55, 1.75, 64]} />
        {glow(0, 2.5)}
      </mesh>

      <group ref={float}>
        <group ref={facing}>
          {/* robe */}
          <mesh position={[0, 0.05, 0]} rotation={[Math.PI, 0, 0]} castShadow>
            <coneGeometry args={[0.85, 1.9, 32, 1, true]} />
            <meshStandardMaterial color="#3a3f8c" roughness={0.4} metalness={0.3} side={2} />
          </mesh>
          <mesh position={[0, 0.98, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.43, 0.03, 8, 40]} />
            <meshStandardMaterial color="#fcd34d" metalness={0.8} roughness={0.25} />
          </mesh>
          <mesh position={[0, 0.88, 0]} castShadow>
            <sphereGeometry args={[0.42, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#3a3f8c" roughness={0.4} metalness={0.3} />
          </mesh>
          {/* core */}
          <mesh ref={core} position={[0, 0.45, 0.42]}>
            <icosahedronGeometry args={[0.2, 0]} />
            {glow(1, 5)}
          </mesh>
          {/* head */}
          <group position={[0, 1.42, 0]}>
            <mesh castShadow>
              <sphereGeometry args={[0.5, 32, 24]} />
              <meshStandardMaterial color="#f1ede4" roughness={0.25} metalness={0.15} />
            </mesh>
            <mesh position={[0, 0.02, 0.3]} scale={[1, 0.55, 0.6]}>
              <sphereGeometry args={[0.38, 32, 16]} />
              <meshStandardMaterial color="#0d0f1c" roughness={0.1} metalness={0.6} />
            </mesh>
            {[-0.13, 0.13].map((x, i) => (
              <mesh key={x} position={[x, 0.03, 0.51]} scale={[1, mood === "listening" ? 1.4 : 1, 1]}>
                <capsuleGeometry args={[0.045, 0.06, 4, 10]} />
                {glow(2 + i, 6)}
              </mesh>
            ))}
            <mesh ref={halo} position={[0, 0.72, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.42, 0.035, 12, 48]} />
              {glow(4, 4)}
            </mesh>
          </group>
          <mesh ref={handL} castShadow>
            <sphereGeometry args={[0.14, 16, 12]} />
            <meshStandardMaterial color="#f1ede4" roughness={0.3} />
          </mesh>
          <mesh ref={handR} castShadow>
            <sphereGeometry args={[0.14, 16, 12]} />
            <meshStandardMaterial color="#f1ede4" roughness={0.3} />
          </mesh>
        </group>
        <mesh ref={ringA} position={[0, 0.7, 0]}>
          <torusGeometry args={[1.45, 0.025, 8, 96]} />
          {glow(5, 3)}
        </mesh>
        <mesh ref={ringB} position={[0, 0.7, 0]} rotation={[Math.PI / 2.4, 0, 0]}>
          <torusGeometry args={[1.85, 0.018, 8, 96]} />
          {glow(6, 2.2)}
        </mesh>
        <pointLight ref={light} position={[0, 0.6, 0.8]} distance={16} decay={1.6} />
        <Sparkles
          count={mood === "thinking" || mood === "working" ? 70 : 28}
          scale={[4, 4, 4]}
          size={mood === "thinking" ? 5 : 3}
          speed={mood === "thinking" ? 1.4 : 0.4}
          color={MOOD_COLOR[mood]}
        />
      </group>
    </group>
  );
}
