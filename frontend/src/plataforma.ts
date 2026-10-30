import { Capacitor } from "@capacitor/core";
import { isTauri as tauriInjetado } from "@tauri-apps/api/core";

/** Detecção de plataforma num só lugar.
 *
 * Existe separado de `api.ts` para não criar ciclo: a sessão e o cofre precisam
 * perguntar a plataforma, e o api.ts precisa dos dois. */
export function isTauri(): boolean {
  // Detecção oficial do Tauri 2: ele injeta `isTauri = true` no global da
  // janela. `window.__TAURI__` só existe com `withGlobalTauri`, que não usamos.
  // Lê `globalThis`, então também roda nos testes (vitest/node, sem DOM).
  return tauriInjetado();
}

/** App desktop falando com o backend embutido (sidecar) neste computador.
 *
 *  Hoje é o mesmo que `isTauri()`: todo build Tauri é local, sem servidor
 *  remoto. Fica com nome próprio para as condições do modo local não se
 *  misturarem com as do Tauri em geral (atualizador, cofre). */
export function isDesktopLocal(): boolean {
  return isTauri();
}

/** App Tauri no macOS, onde o prompt do Touch ID prefixa "FinControl está
 *  tentando" ao motivo. Exige o Tauri: o iPadOS em modo desktop também diz
 *  "Macintosh" no user agent. */
export function isTauriMac(): boolean {
  return isTauri() && /Macintosh/.test(navigator.userAgent);
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
