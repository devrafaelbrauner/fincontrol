import { Capacitor } from "@capacitor/core";

/** Detecção de plataforma num só lugar.
 *
 * Existe separado de `api.ts` para não criar ciclo: a sessão e o cofre precisam
 * perguntar a plataforma, e o api.ts precisa dos dois. */
export function isTauri(): boolean {
  // `typeof window` antes de tocá-la: os testes (vitest/node) importam estes
  // módulos sem DOM, e `window` nu lançaria ReferenceError no import.
  return typeof window !== "undefined"
    && typeof (window as unknown as { __TAURI__?: unknown }).__TAURI__ !== "undefined";
}

export function isCapacitorNativo(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** App nativo: Capacitor (iOS/Android) OU Tauri (macOS/Windows/Linux). */
export function isNativo(): boolean {
  return isTauri() || isCapacitorNativo();
}
