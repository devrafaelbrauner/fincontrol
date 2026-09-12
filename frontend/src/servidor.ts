import { cofre } from "./nativo/cofre";
import { isNativo } from "./plataforma";

/** Base da API em runtime.
 *
 * Antes ela era só `VITE_API_BASE`, congelado no bundle: trocar de servidor
 * exigia recompilar. Agora, no nativo, vale a ordem:
 *
 *   cofre (o que o dono digitou em Configurações)  >  VITE_API_BASE (default
 *   que o CI bakeou)  >  "" (web same-origin, atrás do Caddy).
 *
 * O valor do cofre é lido uma vez no boot para uma variável de módulo, porque o
 * `fetch` precisa da base de forma SÍNCRONA em cada request. */

const CHAVE = "api_base";

let salva: string | null = null;

const limpar = (url: string) => url.replace(/\/+$/, "");

/** Base efetiva. Sem cofre nem VITE_API_BASE, devolve "" (web usa same-origin). */
export function getApiBase(): string {
  if (salva != null) return salva;
  return limpar(import.meta.env.VITE_API_BASE ?? "");
}

/** true quando há uma base utilizável nesta plataforma. */
export function temApiBase(): boolean {
  return getApiBase().length > 0;
}

/** Carrega a base salva no cofre (nativo). No web é no-op. */
export async function carregarServidor(): Promise<void> {
  if (!isNativo()) return;
  const valor = await (await cofre()).ler(CHAVE);
  if (valor) salva = limpar(valor);
}

/** Grava (ou apaga, com `null`) a URL do servidor. Trocar encerra a sessão. */
export async function definirServidor(url: string | null): Promise<void> {
  const c = await cofre();
  const limpa = url ? limpar(url) : null;
  salva = limpa;
  if (limpa) await c.gravar(CHAVE, limpa);
  else await c.apagar(CHAVE);
}

/** A base atual veio do cofre (foi escolhida pelo dono nesta instalação)? */
export function servidorDoUsuario(): boolean {
  return salva != null && salva.length > 0;
}
