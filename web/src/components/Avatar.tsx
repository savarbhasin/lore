const HUES = [24, 45, 160, 190, 215, 250, 280, 320, 350, 100];

function hueFor(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts.at(-1)![0] : "")).toUpperCase() || "?";
}

export function Avatar({ name, seed, size = 24, square = false }: { name: string; seed?: string; size?: number; square?: boolean }) {
  const hue = hueFor(seed ?? name);
  return (
    <span
      className={`inline-grid shrink-0 select-none place-items-center font-semibold ${square ? "rounded-md" : "rounded-full"}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        color: `hsl(${hue} 85% 78%)`,
        background: `hsl(${hue} 45% 22% / 0.9)`,
        boxShadow: `inset 0 0 0 1px hsl(${hue} 60% 60% / 0.25)`,
      }}
    >
      {initials(name)}
    </span>
  );
}
