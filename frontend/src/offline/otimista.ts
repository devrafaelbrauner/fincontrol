import { chavesCache, guardarGet, lerGet } from "./cache";
import type { ItemFila } from "./fila";

/** Update otimista do cache de leitura.
 *
 * Quando uma escrita não pode ir ao servidor e entra na fila, a tela seguinte
 * refaria um GET que, offline, lê o cache — e mostraria o dado VELHO, como se a
 * ação não tivesse acontecido. Aqui a escrita é aplicada ao snapshot em cache,
 * com o mesmo formato que o backend devolveria, para a leitura offline refletir
 * o que o dono acabou de fazer. Quando o replay passar, o cache é limpo e o
 * servidor manda a versão final (inclusive ids de verdade).
 *
 * Só toca nos recursos cujo formato de lista é conhecido. Onde não se sabe a
 * forma (Resumo de contas bancárias, lançamentos de contas fixas), NÃO adivinha:
 * prefere mostrar o dado antigo a inventar estrutura. */

interface Recurso {
  prefixo: string;
  campoId: string;
  /** Nome do campo que guarda a lista; `null` = a raiz já é a lista. */
  container: string | null;
  aceitaPost: boolean;
}

// Prefixos mais específicos primeiro.
const RECURSOS: Recurso[] = [
  { prefixo: "/variaveis", campoId: "id", container: "itens", aceitaPost: true },
  { prefixo: "/entradas", campoId: "id", container: "itens", aceitaPost: true },
  { prefixo: "/metas", campoId: "id", container: null, aceitaPost: true },
  { prefixo: "/categorias", campoId: "id", container: null, aceitaPost: true },
  { prefixo: "/orcamentos", campoId: "categoria_id", container: null, aceitaPost: false },
  { prefixo: "/compromissos", campoId: "id", container: null, aceitaPost: true },
];

export interface Alvo {
  recurso: Recurso;
  id: number | null;
  /** `/variaveis/parcelado/{id}` é uma operação de GRUPO: não dá para aplicar
   *  em uma linha só, então o otimista não mexe. */
  ehGrupo: boolean;
}

export function ehIdOtimista(id: unknown): boolean {
  return typeof id === "number" && Number.isInteger(id) && id < 0;
}

export function localizarRecurso(path: string): Alvo | null {
  for (const recurso of RECURSOS) {
    if (path !== recurso.prefixo && !path.startsWith(`${recurso.prefixo}/`)) continue;
    const resto = path.slice(recurso.prefixo.length);
    if (resto === "") return { recurso, id: null, ehGrupo: false };
    if (!resto.startsWith("/")) continue;
    const partes = resto.slice(1).split("/");
    if (partes[0] === "parcelado") return { recurso, id: null, ehGrupo: true };
    const id = Number(partes[0]);
    if (Number.isInteger(id) && id > 0) return { recurso, id, ehGrupo: false };
  }
  return null;
}

function corpoDe(item: ItemFila): Record<string, unknown> | null {
  if (!item.body) return null;
  try {
    const v = JSON.parse(item.body);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A data do corpo cai no intervalo (`de`..`ate`) da chave em cache?
 *  Sem data ou sem intervalo, aceita: melhor esforço. */
function dentroDoIntervalo(chave: string, corpo: Record<string, unknown> | null): boolean {
  const data = typeof corpo?.data === "string" ? corpo.data : null;
  if (!data) return true;
  const q = chave.includes("?") ? new URLSearchParams(chave.slice(chave.indexOf("?") + 1)) : null;
  const de = q?.get("de");
  const ate = q?.get("ate");
  if (de && data < de) return false;
  if (ate && data > ate) return false;
  return true;
}

function listar(container: string | null, dados: unknown): Record<string, unknown>[] | null {
  const alvo = container === null
    ? dados
    : (dados as Record<string, unknown> | null)?.[container];
  return Array.isArray(alvo) ? (alvo as Record<string, unknown>[]) : null;
}

/** Aplica a escrita pendente a UM snapshot já parseado. Devolve o novo valor. */
export function aplicarEmSnapshot(
  dados: unknown,
  item: ItemFila,
  alvo: Alvo,
  corpo: Record<string, unknown> | null,
  chave: string,
): unknown {
  if (alvo.ehGrupo) return dados;
  const itens = listar(alvo.recurso.container, dados);
  if (!itens) return dados;

  const metodo = item.method.toUpperCase();
  let novos: Record<string, unknown>[];

  if ((metodo === "PATCH" || metodo === "PUT" || metodo === "DELETE") && ehIdOtimista(alvo.id)) {
    return dados;
  }

  if (metodo === "POST") {
    if (!alvo.recurso.aceitaPost || alvo.id !== null || !corpo) return dados;
    if (!dentroDoIntervalo(chave, corpo)) return dados;
    // Id negativo e temporário: distingue da linha do servidor até o replay.
    novos = [{ ...corpo, id: -item.id, __pendente: true }, ...itens];
  } else if (metodo === "DELETE") {
    if (alvo.id === null) return dados;
    novos = itens.filter((o) => o[alvo.recurso.campoId] !== alvo.id);
  } else {
    if (alvo.id === null || !corpo) return dados;
    novos = itens.map((o) => (o[alvo.recurso.campoId] === alvo.id ? { ...o, ...corpo } : o));
  }

  if (alvo.recurso.container === null) return novos;
  return { ...(dados as Record<string, unknown>), [alvo.recurso.container]: novos };
}

/** Escreve o update otimista nos snapshots do recurso. Nunca lança: falhar em
 *  aplicar o otimista não pode derrubar a escrita que já está na fila. */
export async function aplicarOtimista(item: ItemFila): Promise<void> {
  try {
    const alvo = localizarRecurso(item.path);
    if (!alvo || alvo.ehGrupo) return;
    const corpo = corpoDe(item);
    const chaves = (await chavesCache()).filter(
      (c) => c === alvo.recurso.prefixo || c.startsWith(`${alvo.recurso.prefixo}?`),
    );
    for (const chave of chaves) {
      const rascunho = await lerGet(chave);
      if (!rascunho) continue;
      const novo = aplicarEmSnapshot(rascunho.dados, item, alvo, corpo, chave);
      if (novo !== rascunho.dados) await guardarGet(chave, novo, new Date(rascunho.em));
    }
  } catch {
    // Sem armazém ou JSON inesperado: a fila continua válida; o dado fica velho.
  }
}
