import { listarFila } from "./fila";

/** Estado de conectividade e da fila, observável pela UI.
 *
 * `useSyncExternalStore` exige um snapshot estável entre notificações: por isso
 * o estado é um objeto trocado inteiro a cada mudança, e não mutado no lugar. */

export interface EstadoOffline {
  offline: boolean;
  pendentes: number;
  conflitos: number;
  /** ISO do último snapshot servido do cache (null = nada do cache em uso). */
  cacheEm: string | null;
}

let estado: EstadoOffline = { offline: false, pendentes: 0, conflitos: 0, cacheEm: null };
const ouvintes = new Set<() => void>();

function notificar(): void {
  for (const fn of ouvintes) fn();
}

export function estadoOffline(): EstadoOffline {
  return estado;
}

export function subscreverOffline(fn: () => void): () => void {
  ouvintes.add(fn);
  return () => { ouvintes.delete(fn); };
}

function definir(patch: Partial<EstadoOffline>): void {
  estado = { ...estado, ...patch };
  notificar();
}

export async function atualizarContadores(): Promise<void> {
  const itens = await listarFila();
  definir({
    // "Pendentes" inclui os que voltaram com erro 5xx: para quem olha a tela,
    // ambos são escrita que ainda não chegou ao servidor.
    pendentes: itens.filter((i) => i.status === "pendente" || i.status === "erro").length,
    conflitos: itens.filter((i) => i.status === "conflito").length,
  });
}

export function definirOffline(offline: boolean): void {
  if (estado.offline !== offline) definir({ offline });
}

export function registrarCacheEm(em: string | null): void {
  definir({ cacheEm: em });
}
