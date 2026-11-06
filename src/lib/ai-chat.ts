"use client";

import { useSyncExternalStore } from "react";

export type AskEntry = { question: string; answer: string; cards: { id: string; title: string }[]; at: string };

// Conversación de "Preguntale al tablero", por tablero: sobrevive a cerrar el panel y a recargar la pestaña.
const KEY = (boardId: string) => `ask-board:${boardId}`;
const cache = new Map<string, AskEntry[]>();
const listeners = new Set<() => void>();
const EMPTY: AskEntry[] = [];

function read(boardId: string): AskEntry[] {
  if (!cache.has(boardId)) {
    let v: AskEntry[] = EMPTY;
    try {
      const raw = sessionStorage.getItem(KEY(boardId));
      if (raw) v = JSON.parse(raw) as AskEntry[];
    } catch {
      /* almacenamiento no disponible */
    }
    cache.set(boardId, v);
  }
  return cache.get(boardId)!;
}

function write(boardId: string, v: AskEntry[]) {
  cache.set(boardId, v);
  try {
    if (v.length) sessionStorage.setItem(KEY(boardId), JSON.stringify(v));
    else sessionStorage.removeItem(KEY(boardId));
  } catch {
    /* almacenamiento no disponible */
  }
  listeners.forEach((l) => l());
}

export const askHistory = {
  add: (boardId: string, e: AskEntry) => write(boardId, [...read(boardId), e].slice(-20)),
  clear: (boardId: string) => write(boardId, EMPTY),
};

export function useAskHistory(boardId: string) {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => read(boardId),
    () => EMPTY,
  );
}
