import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import { api, apiUpload, brl, abrirAnexo, hojeISO, paraCents } from "../api";
import { IcAnexo, IcExtrair, IcFechar, IcImportar, IcOk } from "../components/icones";
import { useToast } from "../components/Toast";
import { useAtualizacao } from "../estado";

type Tipo = "variavel" | "entrada" | "fixa";
type Categoria = { id: number; nome: string; tipo: string };
type Extraido = {
  tipo?: Tipo | null; descricao?: string | null; fornecedor?: string | null;
  valor_cents?: number | null; data?: string | null; vencimento?: string | null;
  forma_pagamento?: string | null; categoria?: string | null; confianca?: number | null;
};

type Status = "enviando" | "extraindo" | "pronto" | "salvando" | "confirmado" | "erro";
type Linha = { sel: boolean; descricao: string; valor: string; data: string; categoriaId: string };
type ItensExtraidos = {
  fornecedor?: string | null;
  total_cents?: number | null;
  itens: { descricao?: string | null; valor_cents?: number | null; data?: string | null; categoria?: string | null }[];
  confianca?: number | null;
};
type Item = {
  key: number;
  nomeArquivo: string;
  anexoId: number | null;
  status: Status;
  erro?: string;
  confianca?: number | null;
  // campos editáveis do cartão
  tipo: Tipo;
  descricao: string;
  valor: string;
  data: string;
  dia: string;
  forma: string;
  categoriaId: string;
  // extração itemizada (fatura/extrato → tabela)
  linhas?: Linha[];
  lendoItens?: boolean;
  lancandoItens?: boolean;
  itensLancados?: number;
};

const FORMAS = [
  ["pix", "Pix"], ["credito", "Crédito"], ["debito", "Débito"], ["dinheiro", "Dinheiro"], ["boleto", "Boleto"],
] as const;
const TIPOS: [Tipo, string][] = [["variavel", "Despesa"], ["entrada", "Receita"], ["fixa", "Conta fixa"]];

let proximaKey = 1;

/** Zona de importação: solte PDFs/fotos, a IA extrai os dados e cada documento vira
 *  um cartão editável; confirmar cria o lançamento com o comprovante anexado. */
export default function Importar() {
  const toast = useToast();
  const { versao, atualizar } = useAtualizacao();
  const [itens, setItens] = useState<Item[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [sobre, setSobre] = useState(false);
  const [iaConfigurada, setIaConfigurada] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<Categoria[]>("/categorias").then(setCategorias).catch(() => {});
    api<{ configurada: boolean }>("/ia/config").then((c) => setIaConfigurada(c.configurada)).catch(() => {});
  }, [versao]);

  function mudar(key: number, mudancas: Partial<Item>) {
    setItens((l) => l.map((i) => (i.key === key ? { ...i, ...mudancas } : i)));
  }

  async function processar(arquivo: File) {
    const key = proximaKey++;
    const novo: Item = {
      key, nomeArquivo: arquivo.name, anexoId: null, status: "enviando",
      tipo: "variavel", descricao: "", valor: "", data: hojeISO(), dia: "10", forma: "pix", categoriaId: "",
    };
    setItens((l) => [...l, novo]);
    try {
      const { id } = await apiUpload<{ id: number }>("/anexos", arquivo);
      mudar(key, { anexoId: id, status: "extraindo" });
      const d = await api<Extraido>(`/ia/extrair/${id}`, { method: "POST", body: "{}" });
      const cat = d.categoria ? categorias.find((c) => c.nome === d.categoria) : undefined;
      const venc = d.vencimento ?? null;
      mudar(key, {
        status: "pronto",
        confianca: d.confianca,
        tipo: d.tipo === "entrada" || d.tipo === "fixa" ? d.tipo : "variavel",
        descricao: d.descricao || d.fornecedor || "",
        valor: d.valor_cents != null ? (d.valor_cents / 100).toFixed(2).replace(".", ",") : "",
        data: d.data || venc || hojeISO(),
        dia: venc ? String(Number(venc.slice(8, 10)) || 10) : "10",
        forma: d.forma_pagamento || "pix",
        categoriaId: cat ? String(cat.id) : "",
      });
    } catch (err) {
      mudar(key, { status: "erro", erro: (err as Error).message });
    }
  }

  function receberArquivos(lista: FileList | File[]) {
    const arquivos = Array.from(lista).filter(
      (a) => a.type === "application/pdf" || a.type.startsWith("image/")
    );
    if (arquivos.length === 0) {
      toast("Solte PDFs ou fotos.", "erro");
      return;
    }
    arquivos.forEach(processar);
  }

  function soltar(e: DragEvent) {
    e.preventDefault();
    setSobre(false);
    receberArquivos(e.dataTransfer.files);
  }

  function selecionar(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files) receberArquivos(e.target.files);
    e.target.value = "";
  }

  async function confirmar(item: Item) {
    const cents = paraCents(item.valor);
    if (!item.descricao.trim() || isNaN(cents) || cents <= 0) {
      mudar(item.key, { erro: "Confira descrição e valor antes de confirmar." });
      return;
    }
    mudar(item.key, { status: "salvando", erro: undefined });
    const cat = item.categoriaId ? Number(item.categoriaId) : null;
    try {
      if (item.tipo === "variavel") {
        await api("/variaveis", {
          method: "POST",
          body: JSON.stringify({
            descricao: item.descricao, valor_cents: cents, data: item.data,
            forma_pagamento: item.forma, categoria_id: cat, anexo_id: item.anexoId,
          }),
        });
      } else if (item.tipo === "entrada") {
        await api("/entradas", {
          method: "POST",
          body: JSON.stringify({ descricao: item.descricao, valor_cents: cents, data: item.data, recorrente: false, categoria_id: cat }),
        });
      } else {
        await api("/contas-fixas", {
          method: "POST",
          body: JSON.stringify({ nome: item.descricao, dia_vencimento: Number(item.dia) || 10, valor_estimado_cents: cents }),
        });
      }
      mudar(item.key, { status: "confirmado" });
      atualizar();
    } catch (err) {
      mudar(item.key, { status: "pronto", erro: (err as Error).message });
    }
  }

  async function confirmarTodos() {
    for (const i of itens.filter((i) => i.status === "pronto")) await confirmar(i);
  }

  /** Extração itemizada: lê os lançamentos individuais do documento e monta a tabela. */
  async function lerItens(item: Item) {
    if (!item.anexoId) return;
    mudar(item.key, { lendoItens: true, erro: undefined });
    try {
      const d = await api<ItensExtraidos>(`/ia/extrair-itens/${item.anexoId}`, { method: "POST", body: "{}" });
      const linhas: Linha[] = d.itens
        .filter((l) => l.valor_cents != null && l.valor_cents > 0)
        .map((l) => {
          const cat = l.categoria ? categorias.find((c) => c.nome === l.categoria && c.tipo === "variavel") : undefined;
          return {
            sel: true,
            descricao: l.descricao || "(sem descrição)",
            valor: ((l.valor_cents as number) / 100).toFixed(2).replace(".", ","),
            data: l.data || item.data,
            categoriaId: cat ? String(cat.id) : "",
          };
        });
      if (linhas.length === 0) {
        mudar(item.key, { lendoItens: false, erro: "A IA não encontrou lançamentos individuais neste documento." });
        return;
      }
      mudar(item.key, { lendoItens: false, linhas, confianca: d.confianca ?? item.confianca });
    } catch (err) {
      mudar(item.key, { lendoItens: false, erro: (err as Error).message });
    }
  }

  function mudarLinha(item: Item, idx: number, mudancas: Partial<Linha>) {
    mudar(item.key, { linhas: item.linhas?.map((l, i) => (i === idx ? { ...l, ...mudancas } : l)) });
  }

  /** Lança cada linha selecionada como gasto variável, todas vinculadas ao mesmo anexo. */
  async function lancarItens(item: Item) {
    const selecionadas = (item.linhas ?? []).filter((l) => l.sel);
    if (selecionadas.length === 0) return;
    mudar(item.key, { lancandoItens: true, erro: undefined });
    let lancados = 0;
    try {
      for (const l of selecionadas) {
        const cents = paraCents(l.valor);
        if (!l.descricao.trim() || isNaN(cents) || cents <= 0) continue;
        await api("/variaveis", {
          method: "POST",
          body: JSON.stringify({
            descricao: l.descricao, valor_cents: cents, data: l.data,
            forma_pagamento: item.forma, categoria_id: l.categoriaId ? Number(l.categoriaId) : null,
            anexo_id: item.anexoId,
          }),
        });
        lancados++;
      }
      mudar(item.key, { lancandoItens: false, status: "confirmado", itensLancados: lancados });
      toast(`${lancados} lançamento(s) criado(s) a partir do documento.`);
      atualizar();
    } catch (err) {
      mudar(item.key, { lancandoItens: false, erro: `Lançados ${lancados} de ${selecionadas.length}: ${(err as Error).message}` });
    }
  }

  const prontos = itens.filter((i) => i.status === "pronto").length;
  const catsDoTipo = (t: Tipo) => categorias.filter((c) => c.tipo === (t === "fixa" ? "fixa" : t));

  return (
    <>
      <p className="sub">
        Solte boletos, notas, recibos ou fotos de comprovantes — a IA lê cada um e preenche
        valor, data, descrição e categoria para você só conferir e confirmar.
      </p>
      {iaConfigurada === false && (
        <p className="erro">Configure a chave do OpenRouter em Configurações para a extração por IA funcionar.</p>
      )}

      <div
        className={`dropzone${sobre ? " ativo" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setSobre(true); }}
        onDragLeave={() => setSobre(false)}
        onDrop={soltar}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
        aria-label="Enviar documentos (PDF ou foto)"
      >
        <IcImportar />
        <strong>Arraste arquivos aqui ou toque para escolher</strong>
        <span className="sub">PDF, JPEG, PNG, HEIC ou WEBP · até 15 MB cada · vários de uma vez</span>
        <input ref={inputRef} type="file" accept="application/pdf,image/*" multiple hidden onChange={selecionar} />
      </div>

      {prontos > 1 && (
        <div style={{ margin: "1rem 0" }}>
          <button className="btn btn-primario" onClick={confirmarTodos}>Confirmar todos ({prontos})</button>
        </div>
      )}

      <div className="importar-lista">
        {itens.map((i) => (
          <div key={i.key} className={`card importar-item${i.status === "confirmado" ? " confirmado" : ""}`}>
            <div className="importar-topo">
              <span className="sub" style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", minWidth: 0 }}>
                <IcAnexo />
                {i.anexoId ? (
                  <button type="button" className="anexo-link" onClick={() => abrirAnexo(i.anexoId!)}>{i.nomeArquivo}</button>
                ) : (
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.nomeArquivo}</span>
                )}
              </span>
              {i.status === "enviando" && <span className="chip">Enviando…</span>}
              {i.status === "extraindo" && <span className="chip"><IcExtrair /> Lendo com IA…</span>}
              {i.status === "pronto" && i.confianca != null && (
                <span className="chip" title="Confiança da IA na extração">IA {Math.round(i.confianca * 100)}%</span>
              )}
              {i.status === "confirmado" && <span className="chip"><IcOk width={14} height={14} /> Lançado</span>}
              <button className="btn btn-icone" style={{ marginLeft: "auto" }} aria-label="Remover da lista"
                onClick={() => setItens((l) => l.filter((x) => x.key !== i.key))}><IcFechar /></button>
            </div>

            {(i.status === "enviando" || i.status === "extraindo") && <div className="skeleton" style={{ height: 56 }} />}

            {(i.status === "pronto" || i.status === "salvando") && (
              <>
                <div className="linha-form" style={{ flexWrap: "wrap" }}>
                  <select value={i.tipo} onChange={(e) => mudar(i.key, { tipo: e.target.value as Tipo })} aria-label="Tipo">
                    {TIPOS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                  </select>
                  <input style={{ flex: 2, minWidth: 140 }} placeholder={i.tipo === "fixa" ? "Nome da conta" : "Descrição"}
                    value={i.descricao} onChange={(e) => mudar(i.key, { descricao: e.target.value })} aria-label="Descrição" />
                  <input style={{ width: 110 }} inputMode="decimal" placeholder="0,00"
                    value={i.valor} onChange={(e) => mudar(i.key, { valor: e.target.value })} aria-label="Valor (R$)" />
                  {i.tipo === "fixa" ? (
                    <input style={{ width: 90 }} type="number" min={1} max={31} title="Dia de vencimento"
                      value={i.dia} onChange={(e) => mudar(i.key, { dia: e.target.value })} aria-label="Dia de vencimento" />
                  ) : (
                    <input type="date" value={i.data} onChange={(e) => mudar(i.key, { data: e.target.value })} aria-label="Data" />
                  )}
                  {i.tipo === "variavel" && (
                    <select value={i.forma} onChange={(e) => mudar(i.key, { forma: e.target.value })} aria-label="Forma de pagamento">
                      {FORMAS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                    </select>
                  )}
                  {i.tipo !== "fixa" && catsDoTipo(i.tipo).length > 0 && (
                    <select value={i.categoriaId} onChange={(e) => mudar(i.key, { categoriaId: e.target.value })} aria-label="Categoria">
                      <option value="">— categoria —</option>
                      {catsDoTipo(i.tipo).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                  )}
                  <button className="btn btn-primario" onClick={() => confirmar(i)} disabled={i.status === "salvando"}>
                    {i.status === "salvando" ? "Salvando…" : "Confirmar"}
                  </button>
                  {!i.linhas && (
                    <button className="btn" onClick={() => lerItens(i)} disabled={i.lendoItens}
                      title="Ler os lançamentos individuais do documento (fatura, extrato, nota com vários itens)">
                      <IcExtrair />{i.lendoItens ? "Lendo itens…" : "Ler itens (tabela)"}
                    </button>
                  )}
                </div>

                {i.lendoItens && <div className="skeleton" style={{ height: 120, marginTop: "0.8rem" }} />}

                {i.linhas && i.linhas.length > 0 && (
                  <div style={{ marginTop: "0.8rem", overflowX: "auto" }}>
                    <table>
                      <thead>
                        <tr>
                          <th>
                            <input type="checkbox" style={{ width: "auto" }}
                              checked={i.linhas.every((l) => l.sel)}
                              onChange={(e) => mudar(i.key, { linhas: i.linhas!.map((l) => ({ ...l, sel: e.target.checked })) })}
                              aria-label="Selecionar todos" />
                          </th>
                          <th>Descrição</th><th>Data</th><th>Categoria</th><th>Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {i.linhas.map((l, idx) => (
                          <tr key={idx} style={{ opacity: l.sel ? 1 : 0.45 }}>
                            <td>
                              <input type="checkbox" style={{ width: "auto" }} checked={l.sel}
                                onChange={(e) => mudarLinha(i, idx, { sel: e.target.checked })} aria-label="Incluir" />
                            </td>
                            <td>
                              <input value={l.descricao} onChange={(e) => mudarLinha(i, idx, { descricao: e.target.value })}
                                style={{ minWidth: 160 }} aria-label="Descrição do item" />
                            </td>
                            <td>
                              <input type="date" value={l.data} onChange={(e) => mudarLinha(i, idx, { data: e.target.value })}
                                aria-label="Data do item" />
                            </td>
                            <td>
                              <select value={l.categoriaId} onChange={(e) => mudarLinha(i, idx, { categoriaId: e.target.value })}
                                aria-label="Categoria do item">
                                <option value="">—</option>
                                {catsDoTipo("variavel").map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                              </select>
                            </td>
                            <td>
                              <input inputMode="decimal" value={l.valor} onChange={(e) => mudarLinha(i, idx, { valor: e.target.value })}
                                style={{ width: 100 }} className="num" aria-label="Valor do item" />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="linha-form" style={{ marginTop: "0.6rem", alignItems: "center" }}>
                      <strong className="num">
                        Selecionados: {brl(i.linhas.filter((l) => l.sel).reduce((s, l) => s + (paraCents(l.valor) || 0), 0))}
                        {" "}({i.linhas.filter((l) => l.sel).length} de {i.linhas.length})
                      </strong>
                      <button className="btn btn-primario" onClick={() => lancarItens(i)}
                        disabled={i.lancandoItens || i.linhas.filter((l) => l.sel).length === 0}>
                        {i.lancandoItens ? "Lançando…" : `Lançar ${i.linhas.filter((l) => l.sel).length} selecionado(s)`}
                      </button>
                      <span className="sub">Cada linha vira um gasto variável ({i.forma}) com o documento anexado.</span>
                    </div>
                  </div>
                )}
                {i.tipo !== "variavel" && i.anexoId && (
                  <p className="sub" style={{ margin: "0.4rem 0 0" }}>
                    O arquivo fica guardado em Anexos; o vínculo direto ao lançamento existe só para despesas.
                  </p>
                )}
              </>
            )}

            {i.status === "confirmado" && (
              <p className="sub" style={{ margin: 0 }}>
                {i.itensLancados
                  ? `${i.itensLancados} lançamento(s) criado(s) a partir do documento`
                  : `${TIPOS.find(([v]) => v === i.tipo)?.[1]} · ${i.descricao} · ${brl(paraCents(i.valor))}`}
              </p>
            )}

            {i.erro && <p className="erro" style={{ margin: "0.4rem 0 0" }}>{i.erro}</p>}
          </div>
        ))}
      </div>
    </>
  );
}
