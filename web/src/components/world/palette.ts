import { Color } from "three";

export function hash(s: string) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}

export function hsl(h: number, s: number, l: number) {
  return `#${new Color().setHSL((((h % 360) + 360) % 360) / 360, s, l).getHexString()}`;
}

const TEAM_HUES = [205, 152, 28, 265, 340, 48, 182, 8, 96, 300, 230, 120];

export function teamHue(team: string) {
  return TEAM_HUES[hash(team) % TEAM_HUES.length];
}

const SKINS = ["#f1c9a5", "#e0ac83", "#c68a5e", "#a8704a", "#7d4f32", "#f5d7bd"];
const HAIRS = ["#2b1d14", "#4a2f1d", "#0f0f12", "#8a5a2b", "#c9a15a", "#6b6b72", "#a3392b"];

export type Look = { skin: string; hair: string; shirt: string; pants: string; hairStyle: 0 | 1 | 2 | 3 };

export function lookFor(id: string, hue: number): Look {
  const h = hash(id);
  return {
    skin: SKINS[h % SKINS.length],
    hair: HAIRS[(h >>> 3) % HAIRS.length],
    shirt: hsl(hue + (((h >>> 6) % 30) - 15), 0.5, 0.5),
    pants: hsl(220 + ((h >>> 9) % 40), 0.18, 0.22 + ((h >>> 12) % 10) / 100),
    hairStyle: ((h >>> 15) % 4) as Look["hairStyle"],
  };
}

/** Deterministic PRNG so the island looks the same on every visit. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lattice(x: number, z: number) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function noise(x: number, z: number) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = lattice(xi, zi);
  const b = lattice(xi + 1, zi);
  const c = lattice(xi, zi + 1);
  const d = lattice(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
