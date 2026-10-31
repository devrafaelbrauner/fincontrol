import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { appDataDir } from "@tauri-apps/api/path";
import {
  lerEstado as lerEstadoAndroid,
  lerInfo as lerInfoAndroid,
  lerPastaDeDados as lerPastaDeDadosAndroid,
  ouvirEstado as ouvirEstadoAndroid,
  pedirReinicio as pedirReinicioAndroid,
} from "./nativo/cascaAndroid";
import { isAndroidLocal } from "./plataforma";

/** Backend embutido: o sidecar do app desktop (Rust) ou o processo Python
 *  dentro do APK do sabor `local` (casca Kotlin).
 *
 * O Rust e a casca sobem o backend numa porta livre com um token novo a cada
 * início e avisam pelo evento de estado. `info` devolve `{base, token}` no
 * mesmo formato nos dois. Base e token ficam SÓ em memória: mudam a cada
 * reinício e o token não pode sobreviver ao processo. Sem acesso a `window` no
 * topo, para importar nos testes node. */

export type EstadoBackend =
  | { estado: "iniciando" }
  | { estado: "pronto" }
  | { estado: "falhou"; motivo: string };

interface InfoBackend {
  base: string;
  token: string;
}

/** A casca da plataforma atual: só converte a chamada nativa ao formato do
 *  núcleo abaixo (mesmo papel do `Cofre` em `nativo/cofre.ts`). O núcleo
 *  (`observarBackend`, geração, single-flight) é único para Tauri e Capacitor. */
export interface Casca {
  lerEstado(): Promise<EstadoBackend>;
  lerInfo(): Promise<InfoBackend>;
  pedirReinicio(): Promise<void>;
  ouvirEstado(aoMudar: (estado: EstadoBackend) => void): Promise<() => void>;
}

const cascaTauri: Casca = {
  lerEstado: () => invoke<EstadoBackend>("backend_estado"),
  lerInfo: () => invoke<InfoBackend>("backend_info"),
  pedirReinicio: () => invoke("backend_reiniciar").then(() => undefined),
  // Só repassa: o `aplicar` (geração, leitura do `info`) fica só no
  // `observarBackend`, uma vez por evento. Quem desembrulha o envelope do
  // Tauri (`evento.payload`) é este adaptador.
  ouvirEstado: (aoMudar) =>
    listen<EstadoBackend>("backend-estado", (evento) => {
      aoMudar(evento.payload);
    }),
};

const cascaAndroid: Casca = {
  lerEstado: () => lerEstadoAndroid(),
  lerInfo: () => lerInfoAndroid(),
  pedirReinicio: () => pedirReinicioAndroid(),
  // Só repassa: o `aplicar` fica só no `observarBackend`. O payload do plugin
  // já vem desembrulhado, então a referência direta basta.
  ouvirEstado: (aoMudar) => ouvirEstadoAndroid(aoMudar),
};

let casca: Casca | null = null;

/** A casca da plataforma atual, resolvida e memoizada na primeira chamada. */
function cascaAtual(): Casca {
  if (!casca) casca = isAndroidLocal() ? cascaAndroid : cascaTauri;
  return casca;
}

/** Só para os testes: injeta uma casca falsa / limpa a memoizada. */
export function _definirCascaParaTeste(c: Casca | null): void {
  casca = c;
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

/** Sobe a cada aviso da casca. Uma leitura de `info` que termina depois
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
    releitura = cascaAtual()
      .lerInfo()
      .then(
        (info) => { if (minha === geracao) guardar(info); },
        (e: unknown) => { if (minha === geracao) esquecer(); throw e; },
      )
      .finally(() => { releitura = null; });
  }
  return releitura;
}

/** Espera antes da segunda tentativa de `info` depois de um `pronto`. */
export const ESPERA_RELEITURA_MS = 300;

/** Motivo exibido quando o `pronto` chega mas o endereço não pode ser lido. */
export const MOTIVO_SEM_INFO = "Não foi possível ler o endereço do backend local.";

/** Aplica um aviso da casca à base/token em memória e repassa a quem ouve. */
async function aplicar(aoMudar: (estado: EstadoBackend) => void, estado: EstadoBackend): Promise<void> {
  const minha = ++geracao;
  if (estado.estado !== "pronto") {
    esquecer();
    aoMudar(estado);
    return;
  }
  let info: InfoBackend | null = null;
  const c = cascaAtual();
  for (let tentativa = 0; tentativa < 2 && !info; tentativa++) {
    if (tentativa > 0) {
      await new Promise((r) => setTimeout(r, ESPERA_RELEITURA_MS));
      if (minha !== geracao) return;
    }
    info = await c.lerInfo().catch(() => null);
  }
  if (minha !== geracao) return;
  if (!info) {
    // `pronto` sem endereço duas vezes: a casca pode não avisar de novo, e a
    // tela ficaria em "Abrindo…" para sempre. Vira falha, com "Tentar de novo".
    esquecer();
    aoMudar({ estado: "falhou", motivo: MOTIVO_SEM_INFO });
    return;
  }
  guardar(info);
  aoMudar(estado);
}

/** Acompanha o estado do backend e chama `aoMudar` a cada troca.
 *
 *  O `ouvirEstado` vem ANTES da leitura do estado atual: assim um aviso
 *  emitido antes de existir ouvinte está coberto pela leitura, e qualquer
 *  troca depois dela chega pelo evento. Em `pronto`, base e token já estão
 *  lidos quando `aoMudar` é chamado. Devolve a função que para de ouvir. */
export async function observarBackend(aoMudar: (estado: EstadoBackend) => void): Promise<() => void> {
  let chegouEvento = false;
  const c = cascaAtual();
  const parar = await c.ouvirEstado((estado) => {
    chegouEvento = true;
    void aplicar(aoMudar, estado);
  });
  const atual = await c.lerEstado();
  // Se um evento já chegou, ele é tão novo quanto a leitura (ou mais).
  if (!chegouEvento) void aplicar(aoMudar, atual);
  return parar;
}

/** Pede à casca para reiniciar o backend; o progresso chega pelo evento. */
export async function reiniciar(): Promise<void> {
  await cascaAtual().pedirReinicio();
}

/** Caminho da pasta de dados do app (banco, anexos, logs), para exibir.
 *  No Android a casca responde; no desktop, o caminho do Tauri. */
export function pastaDeDados(): Promise<string> {
  if (isAndroidLocal()) return lerPastaDeDadosAndroid();
  return appDataDir();
}

/** Mostra a pasta de dados no Explorer/Finder. Só no desktop: o Android não
 *  tem "abrir pasta" (anexos abrem pela rota `/abrir`, que a S2 leva ao
 *  FileProvider). */
export async function abrirPastaDeDados(): Promise<void> {
  const dir = await appDataDir();
  await invoke("plugin:opener|reveal_item_in_dir", { paths: [dir] });
}

/** Só para testes: fixa (ou limpa, com `null`) base e token. */
export function _definirBackendParaTeste(info: InfoBackend | null): void {
  base = info?.base ?? null;
  token = info?.token ?? null;
}
