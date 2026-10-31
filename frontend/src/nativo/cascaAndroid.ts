import { Capacitor, type Plugin } from "@capacitor/core";
import type { EstadoBackend } from "../backendLocal";

/** Resposta de `info()`: a base HTTP do backend no 127.0.0.1 e o token do processo. */
export interface InfoBackendAndroid {
  base: string;
  token: string;
}
/** Métodos nativos do plugin `BackendLocal` (casca Kotlin, sabor `local`). */
interface BackendLocalNativo {
  estado(): Promise<EstadoBackend>;
  info(): Promise<InfoBackendAndroid>;
  reiniciar(): Promise<void>;
  pastaDeDados(): Promise<{ caminho: string }>;
}

type BackendLocalPlugin = BackendLocalNativo & Plugin;
/** Ponte fina para o plugin `BackendLocal`, só registrado no sabor `local`
 *  (ver `PluginsDoSabor`). Sem lógica de boot: só converte a chamada nativa ao
 *  formato que `backendLocal.ts` espera, como o `nativo/cofre.ts` faz com o
 *  SecureStorage. O plugin real só existe no APK; fora dele (testes, web, iOS,
 *  `nuvem`) `registerPlugin` devolve um proxy que rejeita ao chamar — por isso
 *  ninguém importa este módulo sem `isAndroidLocal()`. */
let instancia: BackendLocalPlugin | null = null;

function plugin(): BackendLocalPlugin {
  // `registerPlugin` sem implementação JS devolve um proxy aos métodos nativos,
  // resolvidos pelos headers que a casca injeta no WebView do APK. Memoizado
  // como o `instancia` do `cofre.ts`: cada chamada depois da primeira soltaria
  // um `console.warn("…already registered…")` no core 8.4.2.
  instancia ??= Capacitor.registerPlugin<BackendLocalPlugin>("BackendLocal");
  return instancia;
}

export type PararDeOuvir = () => void;

/** Lê o estado atual da casca (`iniciando` | `pronto` | `falhou`). */
export function lerEstado(): Promise<EstadoBackend> {
  return plugin().estado();
}

/** Lê base e token do processo. Rejeita `nao_pronto` fora do `pronto`. */
export function lerInfo(): Promise<InfoBackendAndroid> {
  return plugin().info();
}

/** Pede à casca para relançar o processo; o progresso chega pelo evento. */
export function pedirReinicio(): Promise<void> {
  return plugin().reiniciar();
}

/** Caminho da pasta de dados do backend (banco, anexos, logs), para exibir. */
export async function lerPastaDeDados(): Promise<string> {
  return (await plugin().pastaDeDados()).caminho;
}

/** Ouve o evento `estado` da casca. Devolve a função que para de ouvir.
 *
 *  O evento não é retido: registrar o listener ANTES de ler `estado()`, senão
 *  uma troca entre a leitura e o registro se perde. */
export async function ouvirEstado(
  aoMudar: (estado: EstadoBackend) => void,
): Promise<PararDeOuvir> {
  const handle = await plugin().addListener("estado", aoMudar);
  return () => { void handle.remove(); };
}
