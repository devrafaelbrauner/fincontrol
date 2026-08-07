import { useCallback, useEffect, useMemo, useState } from "react";
import { api, brl } from "../api";
import AnexoCampo from "../components/AnexoCampo";
import { IcBusca, IcExportar, IcExtrair, IcVariaveis } from "../components/icones";
import { useToast } from "../components/Toast";
import { useAtualizacao, useCompetencia } from "../estado";
import ValorHero from "../components/ValorHero";

const ultimoDia = (comp: string) => new Date(Number(comp.slice(0, 4)), Number(comp.slice(5)), 0).getDate();

type Variavel = {
  id: number;
  descricao: string;
  valor_cents: number;
  data: string;
  forma_pagamento: string | null;
  anexo_id: number | null;
  categoria_id: number | null;
  parcelamento_id: number | null;
  parcela_num: number | null;
  parcelas_total: number | null;
};
type Categoria = { id: number; nome: string; tipo: string };

export default function Variaveis() {
  const toast = useToast();
  const { competencia } = useCompetencia();
  const { versao, atualizar } = useAtualizacao();
  const [itens, setItens] = useState<Variavel[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [total, setTotal] = useState(0);
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [categorizando, setCategorizando] = useState(false);

  const carregar = useCallback(() => {
    setCarregando(true);
    const ate = `${competencia}-${String(ultimoDia(competencia)).padStart(2, "0")}`;
    api<{ itens: Variavel[]; total_cents: number }>(`/variaveis?de=${competencia}-01&ate=${ate}`)
      .then((r) => { setItens(r.itens); setTotal(r.total_cents); })
      .catch((e) => setErro(e.message))
      .finally(() => setCarregando(false));
    api<Categoria[]>("/categorias").then((cs) => setCategorias(cs.filter((c) => c.tipo === "variavel"))).catch(() => {});
  }, [competencia]);

  useEffect(carregar, [carregar, versao]);

  const semCategoria = itens.filter((i) => i.categoria_id == null).length;

  function exportarCSV() {
    const nomeCat = new Map(categorias.map((c) => [c.id, c.nome] as const));
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const linhas = [
      ["Data", "Descrição", "Categoria", "Forma", "Valor (R$)"].join(";"),
      ...filtrados.map((i) => [
        i.data,
        esc(i.descricao),
        esc(i.categoria_id != null ? nomeCat.get(i.categoria_id) ?? "" : ""),
        i.forma_pagamento ?? "",
        (i.valor_cents / 100).toFixed(2).replace(".", ","),
      ].join(";")),
    ];
    const blob = new Blob(["﻿" + linhas.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `variaveis-${competencia}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function categorizarTudo() {
    setCategorizando(true);
    try {
      const r = await api<{ categorizados: number; total: number }>("/ia/categorizar-lote", { method: "POST", body: "{}" });
      toast(r.categorizados > 0 ? `${r.categorizados} gasto(s) categorizado(s) pela IA.` : "Nada para categorizar.");
      atualizar();
    } catch (e) { toast((e as Error).message, "erro"); }
    finally { setCategorizando(false); }
  }

  const filtrados = useMemo(
    () => itens.filter((i) => i.descricao.toLowerCase().includes(busca.toLowerCase())),
    [itens, busca]
  );

  async function excluir(i: Variavel) {
    const pergunta = i.parcelamento_id != null
      ? `Excluir só esta parcela (${i.parcela_num}/${i.parcelas_total})? As outras continuam lançadas.`
      : "Excluir este lançamento?";
    if (!confirm(pergunta)) return;
    try {
      await api(`/variaveis/${i.id}`, { method: "DELETE" });
      toast("Lançamento excluído.");
      atualizar();
    } catch (e) { toast((e as Error).message, "erro"); }
  }

  async function excluirParcelamento(i: Variavel) {
    if (!confirm(`Excluir a compra parcelada "${i.descricao}" INTEIRA — todas as ${i.parcelas_total} parcelas, incluindo as de meses passados e futuros?`)) return;
    try {
      const r = await api<{ parcelas_removidas: number }>(`/variaveis/parcelado/${i.parcelamento_id}`, { method: "DELETE" });
      toast(`Compra parcelada excluída (${r.parcelas_removidas} parcelas).`);
      atualizar();
    } catch (e) { toast((e as Error).message, "erro"); }
  }

  async function definirAnexo(id: number, anexoId: number | null) {
    await api(`/variaveis/${id}`, { method: "PATCH", body: JSON.stringify({ anexo_id: anexoId }) });
    carregar();
  }

  async function definirCategoria(item: Variavel, categoriaId: number | null) {
    // Parcela: sem perguntar, mudar só um mês deixaria a MESMA compra com
    // categorias diferentes entre os meses — e as análises por categoria
    // ficariam inconsistentes sem ninguém perceber.
    const todas = item.parcelamento_id != null &&
      confirm(`Aplicar a nova categoria às ${item.parcelas_total} parcelas desta compra?\n\nOK = todas as parcelas · Cancelar = só esta (${item.parcela_num}/${item.parcelas_total})`);
    setItens((l) => l.map((i) => (
      i.id === item.id || (todas && i.parcelamento_id === item.parcelamento_id) ? { ...i, categoria_id: categoriaId } : i
    )));
    try {
      if (todas) {
        await api(`/variaveis/parcelado/${item.parcelamento_id}`, { method: "PATCH", body: JSON.stringify({ categoria_id: categoriaId }) });
      } else {
        await api(`/variaveis/${item.id}`, { method: "PATCH", body: JSON.stringify({ categoria_id: categoriaId }) });
      }
      atualizar();
    } catch (e) { toast((e as Error).message, "erro"); carregar(); }
  }

  return (
    <>
      <div className="visao-hero" style={{ marginBottom: "26px" }}>
        <div className="eyebrow">Gasto variável no mês</div>
        <div className="hero-linha">
          <span className="hero-valor num" style={{ color: "var(--negative)" }}><ValorHero cents={total} /></span>
        </div>
        <p className="leitura">
          {itens.length} {itens.length === 1 ? "lançamento" : "lançamentos"} nesta competência. Troque o mês no topo,
          ou use “Transação” para lançar.
        </p>
      </div>

      <div style={{ display: "flex", gap: "0.6rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <div className="card" style={{ flex: 1, minWidth: 180, padding: "0.4rem 0.6rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <IcBusca /><input placeholder="Buscar por descrição…" value={busca} onChange={(e) => setBusca(e.target.value)}
            aria-label="Buscar" style={{ border: "none", background: "transparent", padding: "0.35rem 0" }} />
        </div>
        {semCategoria > 0 && categorias.length > 0 && (
          <button className="btn" onClick={categorizarTudo} disabled={categorizando} title="Categorizar com IA os gastos sem categoria">
            <IcExtrair />{categorizando ? "Categorizando…" : `Categorizar ${semCategoria} com IA`}
          </button>
        )}
        {filtrados.length > 0 && (
          <button className="btn" onClick={exportarCSV} title="Exportar para CSV"><IcExportar />CSV</button>
        )}
      </div>
      {erro && <p className="erro">{erro}</p>}

      {carregando ? (
        <div className="skeleton" style={{ height: 220 }} />
      ) : filtrados.length === 0 ? (
        <p className="sub">Nenhum gasto {busca ? "encontrado" : "lançado ainda"}.</p>
      ) : (
        <div className="tabela-lisa">
          <table>
            <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Forma</th><th>Valor</th><th>Comprovante</th><th></th></tr></thead>
            <tbody>
              {filtrados.map((i) => (
                <tr key={i.id}>
                  <td>{new Date(i.data + "T00:00").toLocaleDateString("pt-BR")}</td>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
                      <IcVariaveis /> {i.descricao}
                      {i.parcela_num != null && (
                        <span className="chip" title={`Parcela ${i.parcela_num} de ${i.parcelas_total}`}>{i.parcela_num}/{i.parcelas_total}</span>
                      )}
                    </span>
                  </td>
                  <td>
                    <select value={i.categoria_id ?? ""} onChange={(e) => definirCategoria(i, e.target.value ? Number(e.target.value) : null)}
                      aria-label={`Categoria de ${i.descricao}`} style={{ padding: "0.3rem 0.5rem", fontSize: "0.82rem" }}>
                      <option value="">—</option>
                      {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                  </td>
                  <td>{i.forma_pagamento && <span className="chip">{i.forma_pagamento}</span>}</td>
                  <td className="num negativo">{brl(i.valor_cents)}</td>
                  <td><AnexoCampo anexoId={i.anexo_id} onChange={(a) => definirAnexo(i.id, a)} /></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn btn-icone btn-perigo" onClick={() => excluir(i)}
                      aria-label={i.parcelamento_id != null ? "Excluir esta parcela" : "Excluir"}
                      title={i.parcelamento_id != null ? "Excluir só esta parcela" : "Excluir"}>×</button>
                    {i.parcelamento_id != null && (
                      <button className="btn btn-icone btn-perigo" onClick={() => excluirParcelamento(i)}
                        aria-label="Excluir a compra parcelada inteira" title="Excluir a compra parcelada inteira (todas as parcelas)">⨯⨯</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
