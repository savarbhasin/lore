"use client";

import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import { BufferAttribute, Color, InstancedMesh, Mesh, Object3D, PlaneGeometry } from "three";
import { DISTRICT_RADIUS, heightAt, PLAZA_RADIUS, type World } from "./layout";
import { noise } from "./palette";

function Terrain() {
  const geometry = useMemo(() => {
    const g = new PlaneGeometry(170, 170, 220, 220);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const grassA = new Color("#6fa14a");
    const grassB = new Color("#4f8a3c");
    const meadow = new Color("#9cbf5a");
    const sand = new Color("#e3d3a1");
    const wetSand = new Color("#b9a77a");
    const seabed = new Color("#3f6f73");
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = heightAt(x, z);
      pos.setY(i, y);
      const n = noise(x * 0.12, z * 0.12);
      c.copy(grassA).lerp(grassB, n);
      if (noise(x * 0.05 + 9, z * 0.05) > 0.62) c.lerp(meadow, 0.45);
      const r = Math.hypot(x, z);
      if (r > 57) c.lerp(sand, Math.min(1, (r - 57) / 3));
      if (y < -0.2) c.copy(wetSand).lerp(seabed, Math.min(1, (-y - 0.2) / 1.6));
      colors.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute("color", new BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  }, []);
  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial vertexColors roughness={0.95} flatShading />
    </mesh>
  );
}

function Water({ night }: { night: boolean }) {
  const ref = useRef<Mesh>(null);
  const geometry = useMemo(() => {
    const g = new PlaneGeometry(700, 700, 90, 90);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  const base = useMemo(() => Float32Array.from(geometry.attributes.position.array), [geometry]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const g = ref.current?.geometry;
    if (!g) return;
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3];
      const z = base[i * 3 + 2];
      pos.setY(i, Math.sin(x * 0.12 + t * 0.9) * 0.12 + Math.cos(z * 0.15 + t * 0.7) * 0.12);
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
  });
  return (
    <mesh ref={ref} geometry={geometry} position={[0, -0.45, 0]} receiveShadow>
      <meshStandardMaterial color={night ? "#123a52" : "#2f9bb3"} roughness={0.12} metalness={0.25} transparent opacity={0.88} flatShading />
    </mesh>
  );
}

function Plaza({ angles }: { angles: number[] }) {
  return (
    <group>
      <mesh position={[0, 0.06, 0]} receiveShadow>
        <cylinderGeometry args={[PLAZA_RADIUS, PLAZA_RADIUS + 0.3, 0.14, 64]} />
        <meshStandardMaterial color="#d6cfc1" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.14, 0]} receiveShadow>
        <cylinderGeometry args={[6.2, 6.2, 0.04, 64]} />
        <meshStandardMaterial color="#c4b9a6" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.17, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[6.2, 6.5, 64]} />
        <meshStandardMaterial color="#fbbf24" emissive="#f59e0b" emissiveIntensity={1.4} />
      </mesh>
      {angles.map((a) => (
        <mesh
          key={a}
          position={[Math.sin(a) * ((DISTRICT_RADIUS + PLAZA_RADIUS) / 2 - 1), 0.04, Math.cos(a) * ((DISTRICT_RADIUS + PLAZA_RADIUS) / 2 - 1)]}
          rotation={[0, a, 0]}
          receiveShadow
        >
          <boxGeometry args={[2.8, 0.08, DISTRICT_RADIUS - PLAZA_RADIUS - 2]} />
          <meshStandardMaterial color="#cfc5b3" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function Lamps({ angles, night }: { angles: number[]; night: boolean }) {
  const spots = useMemo(() => {
    const out: [number, number][] = [];
    for (let i = 0; i < 12; i++) {
      const a = ((i + 0.5) / 12) * Math.PI * 2;
      out.push([Math.sin(a) * (PLAZA_RADIUS + 0.6), Math.cos(a) * (PLAZA_RADIUS + 0.6)]);
    }
    for (const a of angles)
      for (let r = 13, i = 0; r < DISTRICT_RADIUS - 3; r += 6, i++)
        for (const side of [i % 2 ? -1 : 1]) {
          const ox = Math.cos(a) * 2.1 * side;
          const oz = -Math.sin(a) * 2.1 * side;
          out.push([Math.sin(a) * r + ox, Math.cos(a) * r + oz]);
        }
    return out;
  }, [angles]);
  const poles = useRef<InstancedMesh>(null);
  const bulbs = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const o = new Object3D();
    spots.forEach(([x, z], i) => {
      o.position.set(x, 1.1, z);
      o.updateMatrix();
      poles.current?.setMatrixAt(i, o.matrix);
      o.position.set(x, 2.3, z);
      o.updateMatrix();
      bulbs.current?.setMatrixAt(i, o.matrix);
    });
    if (poles.current) poles.current.instanceMatrix.needsUpdate = true;
    if (bulbs.current) bulbs.current.instanceMatrix.needsUpdate = true;
  }, [spots]);
  return (
    <group>
      <instancedMesh ref={poles} args={[undefined, undefined, spots.length]} castShadow>
        <cylinderGeometry args={[0.045, 0.07, 2.2, 8]} />
        <meshStandardMaterial color="#2c2c33" metalness={0.6} roughness={0.4} />
      </instancedMesh>
      <instancedMesh ref={bulbs} args={[undefined, undefined, spots.length]}>
        <sphereGeometry args={[0.13, 12, 12]} />
        <meshStandardMaterial color="#fff3c4" emissive="#ffd27a" emissiveIntensity={night ? 6 : 1.2} />
      </instancedMesh>
    </group>
  );
}

function Trees({ trees }: { trees: World["trees"] }) {
  const pines = trees.filter((t) => t.kind === 0);
  const rounds = trees.filter((t) => t.kind === 1);
  const trunks = useRef<InstancedMesh>(null);
  const pineLow = useRef<InstancedMesh>(null);
  const pineHigh = useRef<InstancedMesh>(null);
  const crowns = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const o = new Object3D();
    const tint = new Color();
    trees.forEach((t, i) => {
      const y = heightAt(t.x, t.z);
      o.position.set(t.x, y + 0.7 * t.s, t.z);
      o.scale.setScalar(t.s);
      o.rotation.set(0, i, 0);
      o.updateMatrix();
      trunks.current?.setMatrixAt(i, o.matrix);
    });
    pines.forEach((t, i) => {
      const y = heightAt(t.x, t.z);
      o.scale.setScalar(t.s);
      o.rotation.set(0, i * 1.3, 0);
      o.position.set(t.x, y + 2.0 * t.s, t.z);
      o.updateMatrix();
      pineLow.current?.setMatrixAt(i, o.matrix);
      o.position.set(t.x, y + 3.1 * t.s, t.z);
      o.scale.setScalar(t.s * 0.72);
      o.updateMatrix();
      pineHigh.current?.setMatrixAt(i, o.matrix);
      tint.setHSL(0.31 + (i % 5) * 0.012, 0.42, 0.26 + (i % 3) * 0.03);
      pineLow.current?.setColorAt(i, tint);
      pineHigh.current?.setColorAt(i, tint);
    });
    rounds.forEach((t, i) => {
      const y = heightAt(t.x, t.z);
      o.position.set(t.x, y + 2.3 * t.s, t.z);
      o.scale.set(t.s * 1.15, t.s, t.s * 1.15);
      o.rotation.set(i, i * 2, 0);
      o.updateMatrix();
      crowns.current?.setMatrixAt(i, o.matrix);
      tint.setHSL(0.22 + (i % 4) * 0.025, 0.5, 0.36 + (i % 3) * 0.04);
      crowns.current?.setColorAt(i, tint);
    });
    for (const m of [trunks, pineLow, pineHigh, crowns]) {
      if (!m.current) continue;
      m.current.instanceMatrix.needsUpdate = true;
      if (m.current.instanceColor) m.current.instanceColor.needsUpdate = true;
    }
  }, [trees, pines, rounds]);
  return (
    <group>
      <instancedMesh ref={trunks} args={[undefined, undefined, trees.length]} castShadow>
        <cylinderGeometry args={[0.16, 0.24, 1.4, 6]} />
        <meshStandardMaterial color="#6b4a2f" roughness={1} flatShading />
      </instancedMesh>
      <instancedMesh ref={pineLow} args={[undefined, undefined, pines.length]} castShadow receiveShadow>
        <coneGeometry args={[1.4, 2.4, 7]} />
        <meshStandardMaterial roughness={0.9} flatShading />
      </instancedMesh>
      <instancedMesh ref={pineHigh} args={[undefined, undefined, pines.length]} castShadow>
        <coneGeometry args={[1.2, 2.2, 7]} />
        <meshStandardMaterial roughness={0.9} flatShading />
      </instancedMesh>
      <instancedMesh ref={crowns} args={[undefined, undefined, rounds.length]} castShadow receiveShadow>
        <icosahedronGeometry args={[1.35, 0]} />
        <meshStandardMaterial roughness={0.85} flatShading />
      </instancedMesh>
    </group>
  );
}

function Rocks({ rocks }: { rocks: World["rocks"] }) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const o = new Object3D();
    rocks.forEach((r, i) => {
      o.position.set(r.x, heightAt(r.x, r.z) + r.s * 0.3, r.z);
      o.rotation.set(r.r, r.r * 2, r.r * 0.5);
      o.scale.set(r.s * 1.3, r.s * 0.8, r.s);
      o.updateMatrix();
      ref.current?.setMatrixAt(i, o.matrix);
    });
    if (ref.current) ref.current.instanceMatrix.needsUpdate = true;
  }, [rocks]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, rocks.length]} castShadow receiveShadow>
      <dodecahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color="#8f8d88" roughness={0.95} flatShading />
    </instancedMesh>
  );
}

function Pads({ world }: { world: World }) {
  return (
    <group>
      {world.pads.map((p) => (
        <mesh key={p.angle} position={[p.x, 0.03, p.z]} receiveShadow>
          <cylinderGeometry args={[6.2, 6.4, 0.06, 48]} />
          <meshStandardMaterial color="#c9bfae" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

export function Island({ world, night }: { world: World; night: boolean }) {
  const angles = useMemo(() => world.districts.map((d) => d.angle), [world]);
  return (
    <group>
      <Terrain />
      <Water night={night} />
      <Plaza angles={angles} />
      <Pads world={world} />
      <Lamps angles={angles} night={night} />
      <Trees trees={world.trees} />
      <Rocks rocks={world.rocks} />
    </group>
  );
}
