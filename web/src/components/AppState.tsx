"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { api, type Person } from "@/lib/api";

type State = {
  tenant: string;
  setTenant: (t: string) => void;
  person: string;
  setPerson: (p: string) => void;
  people: Person[];
  tenants: string[];
};

const Ctx = createContext<State | null>(null);

function stored(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [tenant, setTenantRaw] = useState("northwind");
  const [person, setPersonRaw] = useState("maya");
  const [people, setPeople] = useState<Person[]>([]);
  const [tenants, setTenants] = useState<string[]>(["northwind"]);

  useEffect(() => {
    // Read persisted choices after hydration (localStorage isn't available during SSR).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTenantRaw(stored("lore.tenant", "northwind"));
    setPersonRaw(stored("lore.person", "maya"));
    api<string[]>("/api/tenants").then(setTenants).catch(() => {});
  }, []);

  useEffect(() => {
    api<Person[]>(`/api/people?tenant=${tenant}`)
      .then((p) => {
        setPeople(p);
        if (p.length && !p.some((x) => x.id === person)) setPersonRaw(p[0].id);
      })
      .catch(() => setPeople([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant]);

  const save = (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {}
  };
  const setTenant = (t: string) => {
    setTenantRaw(t);
    save("lore.tenant", t);
  };
  const setPerson = (p: string) => {
    setPersonRaw(p);
    save("lore.person", p);
  };

  return <Ctx.Provider value={{ tenant, setTenant, person, setPerson, people, tenants }}>{children}</Ctx.Provider>;
}

export function useAppState() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppState outside provider");
  return v;
}
