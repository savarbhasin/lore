"use client";

import { useFrame } from "@react-three/fiber";
import { useRef, type RefObject } from "react";
import type { Group, Mesh } from "three";
import type { Look } from "./palette";

export type Motion = { speed: number; talk: number; wave: number };

function Hair({ look }: { look: Look }) {
  const mat = <meshStandardMaterial color={look.hair} roughness={0.8} />;
  switch (look.hairStyle) {
    case 1:
      return (
        <group>
          <mesh position={[0, 0.06, -0.02]} castShadow>
            <sphereGeometry args={[0.3, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
            {mat}
          </mesh>
          <mesh position={[0, 0.12, -0.3]} castShadow>
            <sphereGeometry args={[0.13, 14, 12]} />
            {mat}
          </mesh>
        </group>
      );
    case 2:
      return (
        <group>
          <mesh position={[0, 0.04, -0.02]} castShadow>
            <sphereGeometry args={[0.305, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.6]} />
            {mat}
          </mesh>
          <mesh position={[0, -0.2, -0.12]} castShadow>
            <boxGeometry args={[0.56, 0.42, 0.28]} />
            {mat}
          </mesh>
        </group>
      );
    case 3:
      return (
        <group>
          <mesh position={[0, 0.05, -0.03]} castShadow>
            <sphereGeometry args={[0.305, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
            {mat}
          </mesh>
          <mesh position={[0, 0.2, 0.12]} rotation={[0.5, 0, 0]} castShadow>
            <sphereGeometry args={[0.16, 14, 10]} />
            {mat}
          </mesh>
        </group>
      );
    default:
      return (
        <mesh position={[0, 0.07, -0.01]} castShadow>
          <sphereGeometry args={[0.295, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.45]} />
          {mat}
        </mesh>
      );
  }
}

export function Character({ look, motion, scale = 1 }: { look: Look; motion: RefObject<Motion>; scale?: number }) {
  const body = useRef<Group>(null);
  const head = useRef<Group>(null);
  const legL = useRef<Group>(null);
  const legR = useRef<Group>(null);
  const armL = useRef<Group>(null);
  const armR = useRef<Group>(null);
  const phase = useRef(-1);
  const mouth = useRef<Mesh>(null);

  useFrame((state, dt) => {
    const m = motion.current;
    const t = state.clock.elapsedTime;
    const walk = Math.min(m.speed / 4, 1.4);
    if (phase.current < 0) phase.current = Math.random() * 10;
    phase.current += dt * (4 + m.speed * 2.2);
    const s = Math.sin(phase.current);
    if (legL.current && legR.current) {
      legL.current.rotation.x = s * 0.75 * walk;
      legR.current.rotation.x = -s * 0.75 * walk;
    }
    if (armL.current && armR.current) {
      armL.current.rotation.x = -s * 0.65 * walk;
      armR.current.rotation.x = m.wave > 0 ? 0 : s * 0.65 * walk;
      armR.current.rotation.z = m.wave > 0 ? 2.6 + Math.sin(t * 10) * 0.35 : 0.08;
      armL.current.rotation.z = -0.08 - (m.talk > 0 ? Math.abs(Math.sin(t * 3.1)) * 0.25 : 0);
    }
    if (body.current) {
      body.current.position.y = Math.abs(Math.cos(phase.current)) * 0.07 * walk + Math.sin(t * 1.6) * 0.012;
      body.current.rotation.x = walk * 0.08;
    }
    if (mouth.current) mouth.current.scale.set(1 + m.talk * 2.2, 1, 1);
    if (head.current) {
      head.current.rotation.x = m.talk > 0 ? Math.sin(t * 9) * 0.04 * (0.5 + m.talk) : Math.sin(t * 0.8) * 0.03;
      head.current.rotation.y = Math.sin(t * 0.5 + phase.current * 0.01) * 0.08;
    }
  });

  return (
    <group scale={scale}>
      <group ref={body}>
        {/* legs */}
        {[
          [legL, -0.13],
          [legR, 0.13],
        ].map(([ref, x], i) => (
          <group key={i} ref={ref as RefObject<Group>} position={[x as number, 0.82, 0]}>
            <mesh position={[0, -0.4, 0]} castShadow>
              <capsuleGeometry args={[0.1, 0.55, 6, 12]} />
              <meshStandardMaterial color={look.pants} roughness={0.8} />
            </mesh>
            <mesh position={[0, -0.78, 0.05]} castShadow>
              <boxGeometry args={[0.17, 0.1, 0.3]} />
              <meshStandardMaterial color="#1f1f24" roughness={0.6} />
            </mesh>
          </group>
        ))}
        {/* torso */}
        <mesh position={[0, 1.15, 0]} castShadow>
          <capsuleGeometry args={[0.26, 0.42, 8, 16]} />
          <meshStandardMaterial color={look.shirt} roughness={0.75} />
        </mesh>
        <mesh position={[0, 1.42, 0]} castShadow>
          <cylinderGeometry args={[0.09, 0.11, 0.12, 12]} />
          <meshStandardMaterial color={look.skin} roughness={0.7} />
        </mesh>
        {/* arms */}
        {[
          [armL, -0.36],
          [armR, 0.36],
        ].map(([ref, x], i) => (
          <group key={i} ref={ref as RefObject<Group>} position={[x as number, 1.36, 0]}>
            <mesh position={[0, -0.28, 0]} castShadow>
              <capsuleGeometry args={[0.075, 0.42, 6, 12]} />
              <meshStandardMaterial color={look.shirt} roughness={0.75} />
            </mesh>
            <mesh position={[0, -0.6, 0]} castShadow>
              <sphereGeometry args={[0.075, 12, 10]} />
              <meshStandardMaterial color={look.skin} roughness={0.7} />
            </mesh>
          </group>
        ))}
        {/* head */}
        <group ref={head} position={[0, 1.78, 0]}>
          <mesh castShadow>
            <sphereGeometry args={[0.28, 24, 20]} />
            <meshStandardMaterial color={look.skin} roughness={0.65} />
          </mesh>
          <Hair look={look} />
          {[-0.1, 0.1].map((x) => (
            <mesh key={x} position={[x, 0.02, 0.255]}>
              <sphereGeometry args={[0.038, 10, 8]} />
              <meshStandardMaterial color="#141418" roughness={0.3} />
            </mesh>
          ))}
          <mesh ref={mouth} position={[0, -0.1, 0.262]} rotation={[0, 0, Math.PI / 2]}>
            <capsuleGeometry args={[0.018, 0.07, 4, 8]} />
            <meshStandardMaterial color="#7a3b33" roughness={0.6} />
          </mesh>
        </group>
      </group>
    </group>
  );
}
