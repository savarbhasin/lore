import type { Person, Service } from "@/lib/api";
import { noise, rng, teamHue } from "./palette";

export const ISLAND_RADIUS = 66;
export const WALK_RADIUS = 57;
export const PLAZA_RADIUS = 9;
export const DISTRICT_RADIUS = 30;
export const ORACLE_HEAD: [number, number, number] = [0, 4.4, 0];

export type Spot = { x: number; z: number };
export type NpcSpot = Spot & { person: Person; facing: number; hue: number };
export type TowerSpot = Spot & { service: Service; height: number; hue: number; y: number };
export type District = {
  team: string;
  angle: number;
  hue: number;
  building: Spot & { w: number; d: number; h: number; facing: number };
  sign: Spot;
  people: NpcSpot[];
  towers: TowerSpot[];
};
/** `see`: the camera may pass through it (people, pillars, tables) instead of being pulled in front of it. */
export type Collider = { x: number; z: number; r: number; see?: boolean };
export type InteractKind = "oracle" | "person" | "service" | "incident";
export type Pad = Spot & { angle: number };
export type Interactable = { id: string; kind: InteractKind; x: number; z: number; r: number; label: string };
export type World = {
  districts: District[];
  colliders: Collider[];
  anchors: Map<string, [number, number, number]>;
  interactables: Interactable[];
  trees: { x: number; z: number; s: number; kind: number }[];
  /** Clearings between the paths where incident war rooms appear. */
  pads: Pad[];
  rocks: { x: number; z: number; s: number; r: number }[];
};

/** Ground height. Flat where people walk, rolling hills toward the shore, beach and seabed beyond. */
export function heightAt(x: number, z: number) {
  const r = Math.hypot(x, z);
  const hills = Math.max(0, Math.min(1, (r - 40) / 12)) * (noise(x * 0.09, z * 0.09) * 1.6 + noise(x * 0.25, z * 0.25) * 0.35);
  if (r < 56) return hills;
  const t = Math.min(1, (r - 56) / 12);
  const shore = hills * (1 - t) - t * t * 2.6;
  return r > 68 ? -2.6 - (r - 68) * 0.08 : shore;
}

function angleDiff(a: number, b: number) {
  const d = Math.abs(((a - b + Math.PI) % (Math.PI * 2)) - Math.PI);
  return Math.min(d, Math.PI * 2 - d);
}

export function buildWorld(people: Person[], services: Service[], self: string): World {
  const teams = [...new Set([...people.map((p) => p.team), ...services.map((s) => s.team ?? "Commons")])].sort();
  const n = Math.max(teams.length, 1);
  const sector = (Math.PI * 2) / n;
  const colliders: Collider[] = [{ x: 0, z: 0, r: 3, see: true }];
  const anchors = new Map<string, [number, number, number]>();
  const interactables: Interactable[] = [{ id: "lore", kind: "oracle", x: 0, z: 0, r: 8.5, label: "Lore" }];

  const districts: District[] = teams.map((team, i) => {
    const angle = i * sector + sector / 2;
    const hue = teamHue(team);
    const members = people.filter((p) => p.team === team && p.id !== self);
    const owned = services.filter((s) => (s.team ?? "Commons") === team);
    const at = (a: number, r: number): Spot => ({ x: Math.sin(a) * r, z: Math.cos(a) * r });

    const bpos = at(angle, DISTRICT_RADIUS + 7);
    const building = { ...bpos, w: 9, d: 7, h: 5 + Math.min(members.length, 6) * 0.7, facing: angle + Math.PI };
    colliders.push({ ...bpos, r: 5.6 });

    const spread = Math.min(0.1, (sector * 0.7) / Math.max(members.length, 1));
    const npcs: NpcSpot[] = members.map((person, j) => {
      const a = angle + (j - (members.length - 1) / 2) * spread;
      const p = at(a, DISTRICT_RADIUS - 2.5 + (j % 2) * 1.8);
      colliders.push({ ...p, r: 0.6, see: true });
      anchors.set(person.id, [p.x, 2.5, p.z]);
      interactables.push({ id: person.id, kind: "person", ...p, r: 2.6, label: person.name });
      return { ...p, person, facing: angle + Math.PI + (((j * 37) % 7) - 3) * 0.12, hue };
    });

    const tspread = Math.min(0.17, (sector * 0.85) / Math.max(owned.length, 1));
    const towers: TowerSpot[] = owned.map((service, k) => {
      const a = angle + (k - (owned.length - 1) / 2) * tspread;
      const p = at(a, 47 + (k % 2) * 4.5);
      const tier = Number(service.tier ?? 2);
      const height = 5 + (3 - Math.min(Math.max(tier, 0), 3)) * 2.6;
      const y = heightAt(p.x, p.z);
      colliders.push({ ...p, r: 2.3 });
      anchors.set(service.id, [p.x, y + height + 0.6, p.z]);
      interactables.push({ id: service.id, kind: "service", ...p, r: 4.2, label: service.id });
      return { ...p, service, height, hue, y };
    });

    return { team, angle, hue, building, sign: at(angle, DISTRICT_RADIUS + 2.6), people: npcs, towers };
  });

  const pads: Pad[] = [];
  for (let i = 1; i < Math.max(n, 4); i++) {
    const angle = (i * Math.PI * 2) / Math.max(n, 4);
    pads.push({ angle, x: Math.sin(angle) * 19.5, z: Math.cos(angle) * 19.5 });
  }

  const rand = rng(7);
  const trees: World["trees"] = [];
  const rocks: World["rocks"] = [];
  const blocked = (x: number, z: number, margin: number) => {
    const r = Math.hypot(x, z);
    if (r < PLAZA_RADIUS + 4 || r > 63) return true;
    if (Math.abs(x) < 7 && z > 10 && z < 34) return true;
    if (pads.some((p) => Math.hypot(x - p.x, z - p.z) < 7.5)) return true;
    if (colliders.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + margin)) return true;
    const a = Math.atan2(x, z);
    for (const d of districts) {
      const off = angleDiff(a, d.angle) * r;
      if (r < DISTRICT_RADIUS + 2 && off < 3) return true;
      if (r > DISTRICT_RADIUS - 7 && r < DISTRICT_RADIUS + 1 && angleDiff(a, d.angle) < sector * 0.4) return true;
    }
    return false;
  };
  for (let t = 0; t < 900 && trees.length < 190; t++) {
    const a = rand() * Math.PI * 2;
    const r = 13 + Math.sqrt(rand()) * 50;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    if (blocked(x, z, 2.2) || trees.some((o) => Math.hypot(o.x - x, o.z - z) < 2.4)) continue;
    trees.push({ x, z, s: 0.75 + rand() * 0.7, kind: rand() < 0.35 ? 1 : 0 });
  }
  for (let t = 0; t < 300 && rocks.length < 50; t++) {
    const a = rand() * Math.PI * 2;
    const r = 14 + rand() * 52;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    if (blocked(x, z, 1.5)) continue;
    rocks.push({ x, z, s: 0.3 + rand() * 0.9, r: rand() * Math.PI });
  }
  for (const tr of trees) colliders.push({ x: tr.x, z: tr.z, r: 0.5 * tr.s });

  return { districts, colliders, anchors, interactables, trees, rocks, pads };
}
