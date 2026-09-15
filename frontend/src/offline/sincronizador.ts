import { limparCache } from "./cache";
import { atualizarContadores, definirOffline } from "./estadoOffline";
import { aProcessar, type ItemFila, marcarConflito, marcarErro, marcarPermanente, removerItem } from "./fila";

/** Replay da fila de escritas, em ordem, com conflito por item.
 *
 * Regra de ouro: NUNCA sumir com uma escrita em silêncio.
 * - 2xx: aplicada, sai da fila.
 * - 401/403: tenta renovar a sessão UMA vez e repete o item; se continuar sem
 *   sessão, para tudo e deixa o fluxo normal levar ao login (a fila fica).
 * - 409: conflito — espera a escolha do dono; NÃO bloqueia os próximos itens.
 * - 404 em DELETE: o recurso já não existe — descarta a escrita.
 * - 400/422: erro permanente (payload inválido); não retenta.
 * - 5xx: erro transitório — volta como `erro` para o próximo drain (retry).
 * - falha de REDE: para o replay inteiro (o servidor está fora; insistir só
 *   queima os itens restantes). */

export interface RespostaFila {
  status: number;
  detail?: string;
}

export type Executor = (item: ItemFila) => Promise<RespostaFila>;
/** Renova a sessão; `true` quando há token novo utilizável. */
export type Renovador = () => Promise<boolean>;

export interface Resultado {
  aplicados: number;
  conflitos: number;
  erros: number;
  parouPorRede: boolean;
  precisaLogin: boolean;
}

export async function drenarFila(executor: Executor, renovar?: Renovador): Promise<Resultado> {
  let aplicados = 0;
  let conflitos = 0;
  let erros = 0;

  for (const item of await aProcessar()) {
    let resposta: RespostaFila;
    try {
      resposta = await executor(item);
    } catch {
      definirOffline(true);
      await atualizarContadores();
      return { aplicados, conflitos, erros, parouPorRede: true, precisaLogin: false };
    }

    if (resposta.status === 401 || resposta.status === 403) {
      const renovou = renovar ? await renovar() : false;
      if (renovou) {
        try {
          resposta = await executor(item);
        } catch {
          definirOffline(true);
          await atualizarContadores();
          return { aplicados, conflitos, erros, parouPorRede: true, precisaLogin: false };
        }
      }
      if (resposta.status === 401 || resposta.status === 403) {
        await atualizarContadores();
        return { aplicados, conflitos, erros, parouPorRede: false, precisaLogin: true };
      }
    }

    if (resposta.status >= 200 && resposta.status < 300) {
      await removerItem(item.id);
      aplicados += 1;
    } else if (resposta.status === 409) {
      await marcarConflito(item.id, resposta.detail ?? `HTTP ${resposta.status}`);
      conflitos += 1;
    } else if (resposta.status === 404 && item.method.toUpperCase() === "DELETE") {
      await removerItem(item.id);
      aplicados += 1;
    } else if (resposta.status >= 500) {
      await marcarErro(item.id, resposta.detail ?? `HTTP ${resposta.status}`);
      erros += 1;
    } else if (resposta.status === 400 || resposta.status === 422 || (resposta.status >= 400 && resposta.status < 500)) {
      await marcarPermanente(item.id, resposta.detail ?? `HTTP ${resposta.status}`);
      erros += 1;
    } else {
      await marcarPermanente(item.id, resposta.detail ?? `HTTP ${resposta.status}`);
      erros += 1;
    }
  }

  definirOffline(false);
  if (aplicados > 0) {
    await limparCache();
    // Avisa as telas para revalidarem: os dados do servidor mudaram pelo replay.
    if (typeof window !== "undefined") window.dispatchEvent(new Event("fincontrol:atualizar"));
  }
  await atualizarContadores();
  return { aplicados, conflitos, erros, parouPorRede: false, precisaLogin: false };
}
