"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { api } from "@/lib/api";
import type { BoardData } from "@/lib/types";

/** Precarga los datos de un tablero al pasar el mouse o enfocar su enlace: al abrirlo ya están. */
export function usePrefetchBoard() {
  const qc = useQueryClient();
  return useCallback(
    (boardId: string) => {
      void qc.prefetchQuery({ queryKey: ["board", boardId], queryFn: () => api<BoardData>(`/boards/${boardId}`), staleTime: 15_000 });
    },
    [qc],
  );
}
