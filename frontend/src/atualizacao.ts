import { isTauri } from "./plataforma";

/** Atualização assinada do app desktop (Tauri).
 *
 * O pacote vem do repo público de releases e a assinatura é conferida contra a
 * `pubkey` do `tauri.conf.json` — a chave privada vive só no CI. No web/PWA quem
 * atualiza é o service worker; no Capacitor, o banner de versão. */

type Update = Awaited<ReturnType<typeof import("@tauri-apps/plugin-updater")["check"]>>;

let pendente: NonNullable<Update> | null = null;

export interface ResultadoAtualizacao {
  estado: "indisponivel" | "atual" | "disponivel" | "erro";
  versao?: string;
  erro?: string;
}

export async function verificarAtualizacao(): Promise<ResultadoAtualizacao> {
  if (!isTauri()) return { estado: "indisponivel" };
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    pendente = update ?? null;
    if (!update) return { estado: "atual" };
    return { estado: "disponivel", versao: update.version };
  } catch (e) {
    return { estado: "erro", erro: (e as Error).message };
  }
}

export async function instalarAtualizacao(): Promise<void> {
  if (!pendente) return;
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await pendente.downloadAndInstall();
  pendente = null;
  await relaunch();
}
