"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppState } from "./AppState";
import { IconAlert, IconRadar, IconSparkle } from "./Icons";
import { CompanyPicker, PersonPicker } from "./Pickers";

export function Nav() {
  const path = usePathname();
  const { tenant, setTenant, tenants, person, setPerson, people } = useAppState();
  const tab = (href: string, label: string, icon: React.ReactNode) => {
    const active = href === "/" ? path === "/" || path.startsWith("/a/") : path.startsWith(href);
    return (
      <Link
        href={href}
        className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors ${
          active ? "bg-white/[0.07] text-zinc-50" : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100"
        }`}
      >
        {icon}
        {label}
      </Link>
    );
  };
  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center gap-2 bg-canvas px-3 backdrop-blur-xl sm:px-4">
      <Link href="/" className="mr-3 flex items-center gap-2 text-[15px] font-semibold tracking-tight text-zinc-50">
        <span className="relative grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-amber-300 to-amber-500 shadow-[0_0_18px_-2px] shadow-amber-400/50">
          <span className="h-2 w-2 rounded-full bg-zinc-950" />
        </span>
        <span className="max-sm:hidden">Lore</span>
      </Link>
      <nav className="flex items-center gap-0.5">
        {tab("/", "Ask", <IconSparkle size={14} />)}
        {tab("/incidents", "Incidents", <IconAlert size={14} />)}
        {tab("/world", "World", <IconRadar size={14} />)}
      </nav>
      <div className="ml-auto flex items-center gap-2">
        <CompanyPicker value={tenant} options={tenants} onChange={setTenant} />
        <PersonPicker value={person} people={people} onChange={setPerson} />
      </div>
    </header>
  );
}
