"use client";

import { BRAND_NAME } from "@/lib/brand";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell, Check, ChevronRight, ChevronsUpDown, LayoutDashboard, LogOut, Menu as MenuIcon, Moon, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings, Sun,
  UserRound, X,
} from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Logo } from "@/components/ui/logo";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/overlay";
import { Button } from "@/components/ui/primitives";
import { Avatar } from "@/components/ui/user-avatar";
import { api } from "@/lib/api";
import { asColor, SWATCH } from "@/lib/colors";
import type { WorkspaceTree } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CommandPalette } from "./command-palette";
import { NotificationBell } from "./notification-bell";
import { OrgProvider, useOrg } from "./org-context";

type ShellUser = { id: string; name: string; email: string; hasAvatar: boolean };

// Preferencia "sidebar compacto" (solo escritorio), guardada en el navegador.
const MINI_KEY = "tableros.sidebarMini";
const MINI_EVENT = "tableros:sidebar";
function subscribeMini(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(MINI_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(MINI_EVENT, cb);
  };
}
function readMini() {
  try {
    // Sin preferencia guardada, arranca como riel de íconos.
    return localStorage.getItem(MINI_KEY) !== "0";
  } catch {
    return false;
  }
}
function setMini(value: boolean) {
  try {
    localStorage.setItem(MINI_KEY, value ? "1" : "0");
  } catch {
    /* almacenamiento no disponible */
  }
  window.dispatchEvent(new Event(MINI_EVENT));
}

export function AppShell({ user, children }: { user: ShellUser; children: ReactNode }) {
  return (
    <OrgProvider>
      <Shell user={user}>{children}</Shell>
    </OrgProvider>
  );
}

function Shell({ user, children }: { user: ShellUser; children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const mini = useSyncExternalStore(subscribeMini, readMini, () => true);
  const pathname = usePathname();
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setNavOpen(false);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setMini(!readMini());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-card focus:px-3 focus:py-2">
        Saltar al contenido
      </a>
      {navOpen && <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setNavOpen(false)} aria-hidden />}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-[17rem] shrink-0 bg-sidebar text-sidebar-foreground transition-[transform,width] md:static md:translate-x-0 md:border-r",
          navOpen ? "translate-x-0" : "-translate-x-full",
          mini && "md:w-[5rem]",
        )}
        aria-label="Navegación principal"
      >
        <Sidebar user={user} mini={mini} onClose={() => setNavOpen(false)} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b bg-sidebar px-4 sm:px-6">
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Abrir menú" onClick={() => setNavOpen(true)}>
            <MenuIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden shrink-0 md:inline-flex"
            aria-label={mini ? "Expandir menú lateral" : "Minimizar menú lateral"}
            aria-pressed={mini}
            title={`${mini ? "Expandir" : "Minimizar"} menú (⌘B)`}
            onClick={() => setMini(!mini)}
          >
            {mini ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex h-10 w-full max-w-xl items-center gap-2.5 rounded-xl border bg-card px-3.5 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <Search className="size-4" />
            <span className="min-w-0 flex-1 truncate text-left">
              <span className="sm:hidden">Buscar…</span>
              <span className="hidden sm:inline">Buscar tareas, tableros, personas…</span>
            </span>
            <kbd className="hidden rounded-md border px-1.5 text-[10px] sm:inline">⌘K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle />
            <NotificationBell />
            <UserMenu user={user} />
          </div>
        </header>
        <main id="main" className="min-h-0 flex-1 overflow-y-auto scroll-thin">
          {children}
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

function NavLink({ href, icon: Icon, label, active, mini }: { href: string; icon: typeof Search; label: string; active: boolean; mini: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      title={mini ? label : undefined}
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        active && "bg-sidebar-primary text-sidebar-primary-foreground shadow-md shadow-primary/25 hover:bg-sidebar-primary hover:text-sidebar-primary-foreground",
        mini &&
          "md:mx-auto md:size-11 md:justify-center md:rounded-full md:bg-sidebar-accent md:p-0 md:shadow-none md:hover:bg-sidebar-accent/70",
        mini && active && "md:bg-sidebar-primary md:shadow-lg md:shadow-primary/30 md:hover:bg-sidebar-primary",
      )}
    >
      <Icon className="size-[1.1rem] shrink-0" /> <span className={cn(mini && "md:hidden")}>{label}</span>
    </Link>
  );
}

function Sidebar({ user, mini, onClose }: { user: ShellUser; mini: boolean; onClose: () => void }) {
  const { me, orgId, currentOrg, setOrgId } = useOrg();
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: tree } = useQuery({
    queryKey: ["workspaces", orgId],
    queryFn: () => api<WorkspaceTree>(`/orgs/${orgId}/workspaces`),
    enabled: !!orgId,
  });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    qc.clear();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="flex h-full flex-col">
      <div className={cn("flex items-center justify-between gap-2 px-5 pt-5 pb-4", mini && "md:flex-col md:px-0")}>
        <Link href="/dashboard" className="flex items-center gap-2.5" aria-label={`${BRAND_NAME}, inicio`}>
          <Logo className="size-9 shrink-0" />
          <span className={cn("leading-tight", mini && "md:hidden")}>
            <span className="block text-lg font-bold tracking-tight text-foreground">{BRAND_NAME}</span>
            <span className="block text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Gestión de proyectos</span>
          </span>
        </Link>
        <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Cerrar menú" onClick={onClose}>
          <X />
        </Button>
      </div>

      <nav className="space-y-1 px-3">
        <NavLink href="/dashboard" icon={LayoutDashboard} label="Inicio" mini={mini} active={pathname === "/dashboard"} />
        <NavLink href="/search" icon={Search} label="Búsqueda" mini={mini} active={pathname === "/search"} />
        <NavLink href="/notifications" icon={Bell} label="Notificaciones" mini={mini} active={pathname === "/notifications"} />
        {orgId && currentOrg?.role !== "guest" && (
          <NavLink href={`/o/${orgId}/settings`} icon={Settings} label="Ajustes" mini={mini} active={pathname === `/o/${orgId}/settings`} />
        )}
      </nav>

      <div className={cn("mx-5 my-4 border-t", mini && "md:mx-6")} />

      {mini && (
        <ul className="hidden min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto pb-4 scroll-thin md:flex" aria-label="Tableros">
          {tree?.workspaces.flatMap((w) => w.boards).map((b) => (
            <li key={b.id}>
              <Link
                href={`/b/${b.id}`}
                title={b.name}
                aria-label={b.name}
                className={cn(
                  "relative flex size-11 items-center justify-center rounded-full border text-sm font-semibold hover:bg-sidebar-accent",
                  pathname === `/b/${b.id}` && "border-primary/60 bg-primary-soft text-sidebar-accent-foreground",
                )}
              >
                {b.name.slice(0, 1).toUpperCase()}
                <span className={cn("absolute right-0.5 bottom-0.5 size-2.5 rounded-full ring-2 ring-background", SWATCH[asColor(b.color)])} aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className={cn("flex min-h-0 flex-1 flex-col", mini && "md:hidden")}>
        <div className="flex items-center justify-between px-6 pb-2">
          <Link href={orgId ? `/o/${orgId}` : "/dashboard"} className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase hover:text-foreground">
            Espacios de trabajo
          </Link>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-4 scroll-thin">
          {!orgId && me && (
            <Link href="/orgs/new" className="block rounded-xl border border-dashed px-3 py-3 text-center text-sm text-muted-foreground hover:text-foreground">
              Creá tu primera organización
            </Link>
          )}
          {tree?.workspaces.map((w) => {
            const isCollapsed = collapsed[w.id];
            return (
              <div key={w.id}>
                <div className="flex items-center gap-1">
                  <button
                    className="rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent"
                    aria-label={isCollapsed ? `Expandir ${w.name}` : `Contraer ${w.name}`}
                    aria-expanded={!isCollapsed}
                    onClick={() => setCollapsed({ ...collapsed, [w.id]: !isCollapsed })}
                  >
                    <ChevronRight className={cn("size-3.5 transition-transform", !isCollapsed && "rotate-90")} />
                  </button>
                  <Link
                    href={`/w/${w.id}`}
                    className={cn("flex-1 truncate rounded-lg px-1.5 py-1.5 text-sm font-semibold hover:bg-sidebar-accent", pathname === `/w/${w.id}` && "text-primary")}
                  >
                    {w.name}
                  </Link>
                </div>
                {!isCollapsed && (
                  <ul className="ml-[1.15rem] space-y-0.5 border-l pl-2">
                    {w.boards.map((b) => (
                      <li key={b.id}>
                        <Link
                          href={`/b/${b.id}`}
                          className={cn(
                            "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                            pathname === `/b/${b.id}` && "bg-sidebar-accent font-semibold text-sidebar-accent-foreground",
                          )}
                        >
                          <span className={cn("size-2 shrink-0 rounded-full", SWATCH[asColor(b.color)])} />
                          <span className="truncate">{b.name}</span>
                        </Link>
                      </li>
                    ))}
                    {w.boards.length === 0 && <li className="px-2 py-1.5 text-xs text-muted-foreground">Sin tableros</li>}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className={cn("m-3 overflow-hidden rounded-2xl border bg-card", mini && "md:mx-auto md:mb-5 md:w-11 md:overflow-visible md:rounded-none md:border-0 md:bg-transparent")}>
        <Menu>
          <MenuTrigger asChild>
            <button
              className={cn("flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-muted", mini && "md:justify-center md:p-0 md:hover:bg-transparent")}
              aria-label={`Organización: ${currentOrg?.name ?? "sin organización"}`}
              title={mini ? currentOrg?.name : undefined}
            >
              <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-sm font-bold text-primary", mini && "md:size-11 md:rounded-full")}>
                {(currentOrg?.name ?? "?").slice(0, 1).toUpperCase()}
              </span>
              <span className={cn("min-w-0 flex-1", mini && "md:hidden")}>
                <span className="block text-[11px] text-muted-foreground">Organización</span>
                <span className="block truncate text-sm font-semibold text-foreground">{currentOrg?.name ?? "Sin organización"}</span>
              </span>
              <ChevronsUpDown className={cn("size-4 text-muted-foreground", mini && "md:hidden")} />
            </button>
          </MenuTrigger>
          <MenuContent align="start" side="top" className="w-60">
            <MenuLabel>Tus organizaciones</MenuLabel>
            {me?.orgs.map((o) => (
              <MenuItem
                key={o.id}
                onSelect={() => {
                  setOrgId(o.id);
                  router.push(`/o/${o.id}`);
                }}
              >
                <span className="flex-1 truncate">{o.name}</span>
                {o.id === orgId && <Check className="text-primary" />}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem onSelect={() => router.push("/orgs/new")}>
              <Plus /> Nueva organización
            </MenuItem>
          </MenuContent>
        </Menu>
        <div
          className={cn(
            "flex items-center justify-between border-t px-3 py-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase",
            mini && "md:mt-3 md:flex-col md:gap-3 md:border-0 md:p-0",
          )}
        >
          <button onClick={logout} className={cn("inline-flex items-center gap-1.5 hover:text-foreground", mini && "md:size-11 md:justify-center md:rounded-full md:bg-sidebar-accent")} aria-label="Salir" title="Salir">
            <LogOut className="size-3.5" /> <span className={cn(mini && "md:hidden")}>Salir</span>
          </button>
          <Link href="/settings" className={cn("inline-flex items-center gap-1.5 hover:text-foreground", mini && "md:size-11 md:justify-center md:rounded-full md:bg-sidebar-accent")} aria-label="Mi cuenta" title={user.email}>
            <UserRound className="size-3.5" /> <span className={cn(mini && "md:hidden")}>Mi cuenta</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const dark = mounted && resolvedTheme === "dark";
  return (
    <Button variant="ghost" size="icon" className="rounded-full" aria-label={dark ? "Usar tema claro" : "Usar tema oscuro"} onClick={() => setTheme(dark ? "light" : "dark")}>
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}

function UserMenu({ user }: { user: ShellUser }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { me } = useOrg();
  const u = me?.user ?? user;
  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    qc.clear();
    router.replace("/login");
    router.refresh();
  }
  return (
    <Menu>
      <MenuTrigger asChild>
        <button className="relative ml-1 rounded-full" aria-label="Menú de usuario">
          <Avatar user={{ id: u.id, name: u.name, hasAvatar: u.hasAvatar }} size={38} />
          <span className="absolute right-0 bottom-0 size-2.5 rounded-full bg-success ring-2 ring-background" aria-hidden />
        </button>
      </MenuTrigger>
      <MenuContent className="w-60">
        <div className="px-2 py-1.5">
          <p className="truncate text-sm font-semibold">{u.name}</p>
          <p className="truncate text-xs text-muted-foreground">{u.email}</p>
        </div>
        <MenuSeparator />
        <MenuItem onSelect={() => router.push("/settings")}>
          <UserRound /> Mi cuenta
        </MenuItem>
        <MenuItem onSelect={() => router.push("/docs/api")}>
          <Settings /> Documentación de la API
        </MenuItem>
        <MenuSeparator />
        <MenuItem danger onSelect={logout}>
          <LogOut /> Cerrar sesión
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
