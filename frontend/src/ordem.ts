import { useSyncExternalStore } from "react";

/** Store leve da ordem das abas (compartilhado entre a sidebar e as Configurações). */
const CHAVE = "ordem-abas";

function ler(): string[] {
  try {
    const a = JSON.parse(localStorage.getItem(CHAVE) || "[]");
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

let ordem: string[] = ler();
const ouvintes = new Set<() => void>();

export function definirOrdem(nova: string[]): void {
  ordem = nova;
  localStorage.setItem(CHAVE, JSON.stringify(nova));
  ouvintes.forEach((f) => f());
}

/** Volta à ordem padrão (a sidebar reconcilia [] para a ordem original das abas). */
export function resetarOrdem(): void {
  definirOrdem([]);
}

export function useOrdem(): string[] {
  return useSyncExternalStore(
    (cb) => { ouvintes.add(cb); return () => ouvintes.delete(cb); },
    () => ordem,
    () => ordem,
  );
}
