import { Capacitor } from "@capacitor/core";
import { isTauri as tauriInjetado } from "@tauri-apps/api/core";

/** Detecção de plataforma num só lugar, e o service worker, que depende só dela.
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

/** APK Android do sabor `local`: o backend roda dentro do app, e a casca expõe o
 *  plugin `BackendLocal`, que só esse sabor registra. Decidido em tempo de
 *  execução: o mesmo `dist/` vai para os dois sabores, o iOS, o web e o desktop. */
export function isAndroidLocal(): boolean {
  return Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("BackendLocal");
}

/** O backend mora no aparelho (desktop ou Android local): a API vai ao
 *  127.0.0.1 com o token da casca, e o boot passa pela `TelaBackend`. Fora dele
 *  (web, iOS, APK `nuvem`) a API é a do servidor. */
export function isBackendLocal(): boolean {
  return isDesktopLocal() || isAndroidLocal();
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

/** Registra o service worker onde o front vem de um servidor e o desliga no modo local.
 *
 *  Web, iOS e APK `nuvem` registram o `/sw.js` como o `injectRegister` do
 *  vite-plugin-pwa fazia: só no build, no `load`, com escopo `/`. No modo local,
 *  front e backend vêm no mesmo pacote, e um SW servindo o bundle de antes de uma
 *  atualização quebraria o par. Lá nada é registrado, e o que builds antigos
 *  deixaram sai: no desktop, o sw.js do cliente da VPS no perfil do WebView2
 *  (no Windows o lib.rs também apaga a pasta, porque a atualização dele falha);
 *  no Android, o dos APKs `.local` anteriores à S1b. Chamar antes do primeiro
 *  `await` do boot: o `load` ainda não passou. */
export function prepararServiceWorker(): void {
  const sw = typeof navigator === "undefined" ? undefined : navigator.serviceWorker;
  if (!sw) return;
  if (isBackendLocal()) {
    void sw.getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .catch(() => {});
    return;
  }
  if (!import.meta.env.PROD) return;
  const registrar = () => { void sw.register("/sw.js", { scope: "/" }); };
  if (document.readyState === "complete") registrar();
  else window.addEventListener("load", registrar, { once: true });
}
