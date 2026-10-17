"use client";

import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { BufferAttribute, BufferGeometry, Quaternion, Vector3, type Group, type Mesh, type MeshStandardMaterial } from "three";
import type { Evidence, GNode } from "@/lib/api";
import { LABEL_COLORS } from "@/lib/colors";
import { ORACLE_HEAD } from "./layout";

const CENTER = new Vector3(0, 7.5, 0);
const UP = new Vector3(0, 1, 0);

function slot(i: number, n: number) {
  const total = Math.max(n, 10);
  const y = 1 - ((i + 0.5) / total) * 0.9;
  const r = Math.sqrt(1 - y * y);
  const th = i * 2.399963;
  return new Vector3(Math.cos(th) * (3.5 + r * 6.5), y * 3.2, Math.sin(th) * (3.5 + r * 6.5)).add(CENTER);
}

function Orb({
  node,
  target,
  positions,
  cited,
  focused,
  onPick,
  onHover,
}: {
  node: GNode;
  target: Vector3;
  positions: Map<string, Vector3>;
  cited: boolean;
  focused: boolean;
  onPick: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const ref = useRef<Group>(null);
  const mesh = useRef<Mesh>(null);
  const born = useRef(-1);
  const [hover, setHover] = useState(false);
  const color = LABEL_COLORS[node.label] ?? "#a1a1aa";
  useFrame(({ clock }, dt) => {
    const g = ref.current;
    if (!g) return;
    if (born.current < 0) {
      born.current = clock.elapsedTime;
      g.position.set(ORACLE_HEAD[0], ORACLE_HEAD[1], ORACLE_HEAD[2]);
    }
    g.position.lerp(target, 1 - Math.exp(-dt * 2.5));
    const age = clock.elapsedTime - born.current;
    const base = (cited ? 0.42 : 0.28) * (focused || hover ? 1.5 : 1);
    g.scale.setScalar(Math.min(1, age * 2) * (base + Math.sin(clock.elapsedTime * 2 + target.x) * 0.03));
    positions.set(node.id, g.position);
    const m = mesh.current?.material as MeshStandardMaterial | undefined;
    if (m) m.emissiveIntensity = focused ? 8 : cited ? 5 : 2.2;
  });
  return (
    <group ref={ref}>
      <mesh
        ref={mesh}
        onClick={(e) => {
          e.stopPropagation();
          onPick(node.id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
          onHover(node.id);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHover(false);
          onHover(null);
          document.body.style.cursor = "";
        }}
      >
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial color={color} emissive={color} toneMapped={false} flatShading />
      </mesh>
    </group>
  );
}

function Beam({ from, to, color, strong }: { from: Vector3; to: Vector3; color: string; strong: boolean }) {
  const packet = useRef<Mesh>(null);
  const { mid, quat, len } = useMemo(() => {
    const dir = to.clone().sub(from);
    return {
      mid: from.clone().add(to).multiplyScalar(0.5),
      quat: new Quaternion().setFromUnitVectors(UP, dir.clone().normalize()),
      len: dir.length(),
    };
  }, [from, to]);
  const offset = Math.abs(to.x * 0.137 + to.z * 0.071) % 1;
  useFrame(({ clock }) => {
    if (!packet.current) return;
    const t = (clock.elapsedTime * (strong ? 0.6 : 0.35) + offset) % 1;
    packet.current.position.copy(from).lerp(to, t);
  });
  return (
    <group>
      <mesh position={mid} quaternion={quat}>
        <cylinderGeometry args={[strong ? 0.05 : 0.018, strong ? 0.05 : 0.018, len, 6, 1, true]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={strong ? 3 : 1.2}
          transparent
          opacity={strong ? 0.8 : 0.3}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={packet}>
        <sphereGeometry args={[strong ? 0.16 : 0.09, 10, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={6} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Edges({
  evidence,
  positions,
  anchors,
}: {
  evidence: Evidence;
  positions: Map<string, Vector3>;
  anchors: Map<string, [number, number, number]>;
}) {
  const geometry = useMemo(() => new BufferGeometry(), []);
  const count = evidence.edges.length;
  useLayoutEffect(() => {
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(Math.max(count, 1) * 6), 3));
  }, [geometry, count]);
  useFrame(() => {
    const attr = geometry.getAttribute("position") as BufferAttribute | undefined;
    if (!attr) return;
    const at = (id: string): Vector3 | null => {
      const p = positions.get(id);
      if (p) return p;
      const a = anchors.get(id);
      return a ? new Vector3(...a) : null;
    };
    let i = 0;
    for (const e of evidence.edges) {
      const a = at(e.from);
      const b = at(e.to);
      if (a && b) {
        attr.setXYZ(i * 2, a.x, a.y, a.z);
        attr.setXYZ(i * 2 + 1, b.x, b.y, b.z);
      } else {
        attr.setXYZ(i * 2, 0, -50, 0);
        attr.setXYZ(i * 2 + 1, 0, -50, 0);
      }
      i++;
    }
    attr.needsUpdate = true;
    geometry.computeBoundingSphere();
  });
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#c7d2fe" transparent opacity={0.22} depthWrite={false} toneMapped={false} />
    </lineSegments>
  );
}

export function Constellation({
  evidence,
  cited,
  quests,
  focus,
  anchors,
  positions,
  onPick,
  onHover,
  origin = ORACLE_HEAD,
}: {
  origin?: [number, number, number];
  evidence: Evidence;
  cited: Set<string>;
  quests: Set<string>;
  focus: string | null;
  anchors: Map<string, [number, number, number]>;
  positions: Map<string, Vector3>;
  onPick: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const floating = evidence.nodes.filter((n) => !anchors.has(n.id));
  const grounded = evidence.nodes.filter((n) => anchors.has(n.id));
  const head = useMemo(() => new Vector3(...origin), [origin]);
  const targets = useMemo(() => floating.map((_, i) => slot(i, floating.length)), [floating.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <group>
      {floating.map((n, i) => (
        <Orb
          key={n.id}
          node={n}
          target={targets[i]}
          positions={positions}
          cited={cited.has(n.id)}
          focused={focus === n.id}
          onPick={onPick}
          onHover={onHover}
        />
      ))}
      {grounded.map((n) => (
        <Beam
          key={n.id}
          from={head}
          to={new Vector3(...anchors.get(n.id)!)}
          color={cited.has(n.id) ? "#fbbf24" : (LABEL_COLORS[n.label] ?? "#a1a1aa")}
          strong={quests.has(n.id) || focus === n.id}
        />
      ))}
      {evidence.edges.length > 0 && <Edges evidence={evidence} positions={positions} anchors={anchors} />}
    </group>
  );
}
