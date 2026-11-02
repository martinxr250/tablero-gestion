"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

export function ThemeSwitch() {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const { resolvedTheme, setTheme } = useTheme();
  const dark = mounted && resolvedTheme === "dark";
  return <button type="button" className="auth-theme-switch" aria-label={dark ? "Usar tema claro" : "Usar tema oscuro"} onClick={() => setTheme(dark ? "light" : "dark")}>{dark ? <Sun aria-hidden /> : <Moon aria-hidden />}</button>;
}
