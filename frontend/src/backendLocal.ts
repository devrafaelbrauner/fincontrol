import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { appDataDir } from "@tauri-apps/api/path";

/** Backend embutido do app desktop (sidecar iniciado pelo Rust).
 *
 * O Rust sobe o backend numa porta livre com um token novo a cada início e
 * avisa pelo evento `backend-estado`. Base e token ficam SÓ em memória: nada de
 * cofre ou localStorage, porque mudam a cada reinício e o token não pode
 * sobreviver ao processo. Sem acesso a `window` no topo, para importar nos
 * testes node. */

export type EstadoBackend =
  | { estado: "iniciando" }
  | { estado: "pronto" }
  | { estado: "falhou"; motivo: string };

interface InfoBackend {
  base: string;
  token: string;
}

let base: string | null = null;
let token: string | null = null;

/** Base do backend local ("http://127.0.0.1:<porta>") ou null fora do `pronto`. */
export function baseLocal(): string | null {
  return base;
}

/** Token do `X-FinControl-Token` ou null fora do `pronto`. */
export function tokenLocal(): string | null {
  return token;
}

function esquecer(): void {
  base = null;
  token = null;
}

function guardar(info: InfoBackend): void {
  base = info.base.replace(/\/+$/, "");
  token = info.token;
}

/** Sobe a cada aviso do Rust. Uma leitura de `backend_info` que termina depois
 *  de um aviso mais novo é descartada: senão reviveria a base de antes do
 *  reinício, que outro processo pode ter pegado. */
let geracao = 0;

let releitura: Promise<void> | null = null;

/** Relê base e token (o 401 `token_local` diz que o backend reiniciou).
 *
 *  Single-flight: uma tela com várias chamadas recebe vários 401 juntos e
 *  bastaria uma leitura para todas. Em "nao_pronto" (reinício no meio) esquece
 *  a base, e as requisições caem no caminho offline. */
export function relerInfo(): Promise<void> {
  if (!releitura) {
    const minha = geracao;
    releitura = invoke<InfoBackend>("backend_info")
      .then(
        (info) => { if (minha === geracao) guardar(info); },
        (e: unknown) => { if (minha === geracao) esquecer(); throw e; },
      )
      .finally(() => { releitura = null; });
  }
  return releitura;
}

/** Espera antes da segunda tentativa de `backend_info` depois de um `pronto`. */
export const ESPERA_RELEITURA_MS = 300;

/** Motivo exibido quando o `pronto` chega mas o endereço não pode ser lido. */
export const MOTIVO_SEM_INFO = "Não foi possível ler o endereço do backend local.";

/** Acompanha o estado do backend e chama `aoMudar` a cada troca.
 *
 *  O `listen` vem ANTES da leitura do estado atual: assim um aviso emitido
 *  antes de existir ouvinte está coberto pela leitura, e qualquer troca depois
 *  dela chega pelo evento. Em `pronto`, base e token já estão lidos quando
 *  `aoMudar` é chamado. Devolve a função que para de ouvir. */
export async function observarBackend(aoMudar: (estado: EstadoBackend) => void): Promise<() => void> {
  let chegouEvento = false;

  async function aplicar(estado: EstadoBackend): Promise<void> {
    const minha = ++geracao;
    if (estado.estado !== "pronto") {
      esquecer();
      aoMudar(estado);
      return;
    }
    let info: InfoBackend | null = null;
    for (let tentativa = 0; tentativa < 2 && !info; tentativa++) {
      if (tentativa > 0) {
        await new Promise((r) => setTimeout(r, ESPERA_RELEITURA_MS));
        if (minha !== geracao) return;
      }
      info = await invoke<InfoBackend>("backend_info").catch(() => null);
    }
    if (minha !== geracao) return;
    if (!info) {
      // `pronto` sem endereço duas vezes: o Rust pode não avisar de novo, e a
      // tela ficaria em "Abrindo…" para sempre. Vira falha, com "Tentar de novo".
      esquecer();
      aoMudar({ estado: "falhou", motivo: MOTIVO_SEM_INFO });
      return;
    }
    guardar(info);
    aoMudar(estado);
  }

  const parar = await listen<EstadoBackend>("backend-estado", (evento) => {
    chegouEvento = true;
    void aplicar(evento.payload);
  });
  const atual = await invoke<EstadoBackend>("backend_estado");
  // Se um evento já chegou, ele é tão novo quanto a leitura (ou mais).
  if (!chegouEvento) void aplicar(atual);
  return parar;
}

/** Pede ao Rust para reiniciar o backend; o progresso chega pelo evento. */
export async function reiniciar(): Promise<void> {
  await invoke("backend_reiniciar");
}

/** Caminho da pasta de dados do app (banco, anexos, logs), para exibir. */
export function pastaDeDados(): Promise<string> {
  return appDataDir();
}

/** Mostra a pasta de dados no Explorer/Finder. */
export async function abrirPastaDeDados(): Promise<void> {
  const dir = await appDataDir();
  await invoke("plugin:opener|reveal_item_in_dir", { paths: [dir] });
}

/** Só para testes: fixa (ou limpa, com `null`) base e token. */
export function _definirBackendParaTeste(info: InfoBackend | null): void {
  base = info?.base ?? null;
  token = info?.token ?? null;
}
