import { armazem, LOJA_CACHE } from "./banco";

/** Última resposta boa de um GET, para leitura offline.
 *
 * Guarda o corpo já parseado e o instante em que foi salvo — a UI mostra "dados
 * de 14:32" em vez de fingir que são atuais. Não guarda status nem headers: o
 * que o app precisa é o JSON. */

export interface Rascunho<T> {
  dados: T;
  em: string;
}

interface Registro<T> extends Rascunho<T> {
  chave: string;
}

export async function guardarGet(chave: string, dados: unknown, agora: Date = new Date()): Promise<void> {
  await armazem().gravar(LOJA_CACHE, chave, { chave, dados, em: agora.toISOString() });
}

export async function lerGet<T>(chave: string): Promise<Rascunho<T> | null> {
  const r = await armazem().ler<Registro<T>>(LOJA_CACHE, chave);
  if (!r) return null;
  return { dados: r.dados, em: r.em };
}

/** Chaves em cache (para o update otimista achar as listas do recurso). */
export async function chavesCache(): Promise<string[]> {
  const itens = await armazem().listar<{ chave: string }>(LOJA_CACHE);
  return itens.map((i) => i.chave);
}

/** Depois de uma escrita aplicada, os GETs podem estar velhos — some com tudo. */
export async function limparCache(): Promise<void> {
  await armazem().limpar(LOJA_CACHE);
}
