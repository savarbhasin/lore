"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Source } from "@/lib/api";
import { LABEL_COLORS } from "@/lib/colors";

const ID = /^[A-Za-z][\w:./-]*$/;

/** Turn [PR-482] / [D-17, ADR-012] into cite: links so they render as chips. */
function linkCitations(text: string): string {
  return text.replace(/\[([^\[\]\n]{1,160})\](?!\()/g, (whole, inner: string) => {
    const ids = inner.split(",").map((s) => s.trim()).filter((s) => ID.test(s));
    return ids.length ? ids.map((id) => `[${id}](cite:${encodeURIComponent(id)})`).join(" ") : whole;
  });
}

export function shortId(id: string) {
  const bare = id.replace(/^file:/, "");
  return bare.includes("/") ? bare.split("/").at(-1)! : bare;
}

export function AnswerText({
  text,
  citations,
  onCite,
  active,
}: {
  text: string;
  citations: Source[];
  onCite?: (id: string) => void;
  active?: string | null;
}) {
  const byId = new Map(citations.map((c) => [c.id, c]));
  return (
    <div className="prose-lore text-[15px] text-zinc-300">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(u) => u}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith("cite:")) {
              const id = decodeURIComponent(href.slice(5));
              const src = byId.get(id);
              const color = LABEL_COLORS[src?.kind ?? ""] ?? "#a1a1aa";
              const on = active === id;
              return (
                <button
                  type="button"
                  onClick={() => onCite?.(id)}
                  title={src ? `${src.kind} · ${src.title}` : id}
                  className={`relative -top-px mx-0.5 inline-flex max-w-56 items-center gap-1 rounded-md px-1.5 py-px align-baseline font-mono text-[11px] leading-[1.5] ring-1 transition-colors ${
                    on ? "bg-amber-400/15 text-amber-200 ring-amber-400/60" : "bg-white/[0.04] text-zinc-300 ring-white/10 hover:bg-white/[0.08] hover:ring-white/20"
                  }`}
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
                  <span className="truncate">{shortId(id)}</span>
                </button>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer" className="text-amber-300 underline decoration-amber-300/30 underline-offset-2 hover:decoration-amber-300">
                {children}
              </a>
            );
          },
        }}
      >
        {linkCitations(text)}
      </ReactMarkdown>
    </div>
  );
}
