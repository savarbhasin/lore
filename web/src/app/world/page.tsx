"use client";

import dynamic from "next/dynamic";
import { Spinner } from "@/components/Icons";

const Game = dynamic(() => import("@/components/world/Game"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center bg-black text-zinc-500">
      <Spinner size={20} />
    </div>
  ),
});

export default function WorldPage() {
  return <Game />;
}
