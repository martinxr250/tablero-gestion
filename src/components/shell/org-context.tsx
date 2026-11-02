"use client";

import { useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { Me } from "@/lib/types";

type Ctx = { me: Me | undefined; orgId: string | null; setOrgId: (id: string) => void; currentOrg: Me["orgs"][number] | undefined };
const OrgContext = createContext<Ctx | null>(null);
const KEY = "faro.currentOrg";
const EVENT = "faro:org";

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}
function readStored() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null; // almacenamiento no disponible
  }
}

export function OrgProvider({ children }: { children: ReactNode }) {
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });
  const selected = useSyncExternalStore(subscribe, readStored, () => null);

  const setOrgId = useCallback((id: string) => {
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* almacenamiento no disponible */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);

  const value = useMemo(() => {
    const orgs = me?.orgs ?? [];
    const current = orgs.find((o) => o.id === selected) ?? orgs[0];
    return { me, orgId: current?.id ?? null, setOrgId, currentOrg: current };
  }, [me, selected, setOrgId]);

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg fuera de OrgProvider");
  return ctx;
}

/** Las páginas que conocen su organización (tablero, espacio) la marcan como actual. */
export function useSyncOrg(orgId: string | undefined) {
  const { setOrgId, orgId: current } = useOrg();
  useEffect(() => {
    if (orgId && orgId !== current) setOrgId(orgId);
  }, [orgId, current, setOrgId]);
}
