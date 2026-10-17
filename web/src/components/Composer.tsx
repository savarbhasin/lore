"use client";

import { useEffect, useRef } from "react";
import { IconArrowUp, Spinner } from "./Icons";

export function Composer({
  value,
  onChange,
  onSubmit,
  busy,
  placeholder,
  autoFocus,
  size = "md",
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  placeholder: string;
  autoFocus?: boolean;
  size?: "md" | "lg";
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  const canSend = value.trim().length > 0 && !busy;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSubmit();
      }}
      onClick={() => ref.current?.focus()}
      className={`group relative flex cursor-text items-end gap-2 border border-line-strong bg-elevated shadow-[0_8px_40px_-12px_rgba(0,0,0,0.8)] transition-colors focus-within:border-white/20 ${
        size === "lg" ? "rounded-3xl p-4 pl-6" : "rounded-2xl p-2 pl-4"
      }`}
    >
      <textarea
        ref={ref}
        rows={1}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (canSend) onSubmit();
          }
        }}
        placeholder={placeholder}
        className={`max-h-[220px] min-w-0 flex-1 resize-none bg-transparent leading-6 text-zinc-100 outline-none placeholder:text-zinc-500 ${
          size === "lg" ? "min-h-[104px] py-2 text-[17px] leading-7" : "py-1.5 text-[15px]"
        }`}
      />
      <button
        type="submit"
        disabled={!canSend}
        aria-label="Send"
        className={`grid shrink-0 place-items-center rounded-xl bg-zinc-50 text-zinc-950 transition-all hover:bg-white disabled:bg-white/10 disabled:text-zinc-500 ${size === "lg" ? "h-11 w-11" : "h-9 w-9"}`}
      >
        {busy ? <Spinner size={15} /> : <IconArrowUp size={17} strokeWidth={2.2} />}
      </button>
    </form>
  );
}
