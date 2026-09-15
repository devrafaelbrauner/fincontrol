import { armazem, LOJA_FILA } from "./banco";

/** Fila de escritas que não chegaram ao servidor.
 *
 * Cada item carrega o próprio `If-Match` (a versão lida quando a edição
 * começou). É isso que dá reconciliação no replay: se outro aparelho salvou
 * antes, o servidor devolve 409 e o item vira `conflito` em vez de sobrescrever
 * em silêncio. Um item em conflito NÃO derruba os demais — o replay segue. */

export type StatusItem = "pendente" | "conflito" | "erro" | "permanente";

export interface ItemFila {
  id: number;
  method: string;
  path: string; // caminho relativo à API, ex.: "/variaveis/12"
  body: string | null;
  ifMatch: string | null;
  criadoEm: string;
  status: StatusItem;
  erro?: string;
}

export interface NovoItem {
  method: string;
  path: string;
  body?: string | null;
  ifMatch?: string | null;
}

async function proximoId(): Promise<number> {
  const itens = await armazem().listar<ItemFila>(LOJA_FILA);
  return itens.reduce((maior, i) => Math.max(maior, i.id), 0) + 1;
}

export async function enfileirar(novo: NovoItem): Promise<ItemFila> {
  const item: ItemFila = {
    id: await proximoId(),
    method: novo.method,
    path: novo.path,
    body: novo.body ?? null,
    ifMatch: novo.ifMatch ?? null,
    criadoEm: new Date().toISOString(),
    status: "pendente",
  };
  await armazem().gravar(LOJA_FILA, String(item.id), item);
  return item;
}

/** Ordem de criação — o replay precisa respeitar a sequência das edições. */
export async function listarFila(): Promise<ItemFila[]> {
  const itens = await armazem().listar<ItemFila>(LOJA_FILA);
  return itens.sort((a, b) => a.id - b.id);
}

export async function pendentes(): Promise<ItemFila[]> {
  return (await listarFila()).filter((i) => i.status === "pendente");
}

/** Tudo que ainda deve ser reenviado: pendentes E erros (5xx, retry). Conflitos
 *  ficam de fora — esperam a escolha do dono entre local e servidor. */
export async function aProcessar(): Promise<ItemFila[]> {
  return (await listarFila()).filter((i) => i.status === "pendente" || i.status === "erro");
}

export async function conflitos(): Promise<ItemFila[]> {
  return (await listarFila()).filter((i) => i.status === "conflito");
}

export async function removerItem(id: number): Promise<void> {
  await armazem().apagar(LOJA_FILA, String(id));
}

async function atualizarItem(id: number, patch: Partial<ItemFila>): Promise<void> {
  const itens = await listarFila();
  const item = itens.find((i) => i.id === id);
  if (!item) return;
  await armazem().gravar(LOJA_FILA, String(id), { ...item, ...patch });
}

export async function marcarConflito(id: number, erro: string): Promise<void> {
  await atualizarItem(id, { status: "conflito", erro });
}

/** Erro transitório (5xx/servidor fora): volta a tentar num próximo drain. */
export async function marcarErro(id: number, erro: string): Promise<void> {
  await atualizarItem(id, { status: "erro", erro });
}

/** Payload inválido (400/422): não retenta. */
export async function marcarPermanente(id: number, erro: string): Promise<void> {
  await atualizarItem(id, { status: "permanente", erro });
}

/** Descarta um item em conflito — "manter minha edição" desiste da do servidor. */
export async function descartarConflito(id: number): Promise<void> {
  await removerItem(id);
}

/** "Manter minha edição": reaplica sem If-Match, sobrescrevendo o servidor.
 *  É uma escolha EXPLÍCITA do dono na tela de conflito — não um last-write-wins
 *  silencioso. O item volta para a fila como pendente. */
export async function reativarSemIfMatch(id: number): Promise<void> {
  await atualizarItem(id, { ifMatch: null, status: "pendente", erro: undefined });
}

export async function limparFila(): Promise<void> {
  await armazem().limpar(LOJA_FILA);
}
