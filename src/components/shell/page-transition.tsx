"use client";

import { usePathname } from "next/navigation";
import { ViewTransition, type ReactNode } from "react";

/**
 * Transición suave entre pantallas: la pantalla anterior se desvanece rápido y la nueva entra
 * con un leve desplazamiento. La navegación de Next es una transición de React, así que
 * <ViewTransition> anima solo al cambiar de ruta (no en cada actualización de datos).
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <ViewTransition key={pathname} enter="page-enter" exit="page-exit" default="none">
      {children}
    </ViewTransition>
  );
}
