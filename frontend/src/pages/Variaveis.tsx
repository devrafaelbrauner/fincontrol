import { useCallback, useEffect, useMemo, useState } from "react";
import { api, brl } from "../api";
import AnexoCampo from "../components/AnexoCampo";
import { IcBusca, IcExportar, IcExtrair, IcVariaveis } from "../components/icones";
import { useToast } from "../components/Toast";
import { useAtualizacao, useCompetencia } from "../estado";

const ultimoDia = (comp: string) => new Date(Number(comp.slice(0, 4)), Number(comp.slice(5)), 0).getDate();

type Variavel = {
  id: number;
  descricao: string;
  valor_cents: number;
  data: string;
  forma_pagamento: string | null;
  anexo_id: number | null;
  categoria_id: number | null;
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

  async function excluir(id: number) {
    if (!confirm("Excluir este lançamento?")) return;
    try {
      await api(`/variaveis/${id}`, { method: "DELETE" });
      toast("Lançamento excluído.");
      atualizar();
    } catch (e) { toast((e as Error).message, "erro"); }
  }

  async function definirAnexo(id: number, anexoId: number | null) {
    await api(`/variaveis/${id}`, { method: "PATCH", body: JSON.stringify({ anexo_id: anexoId }) });
    carregar();
  }

  async function definirCategoria(id: number, categoriaId: number | null) {
    setItens((l) => l.map((i) => (i.id === id ? { ...i, categoria_id: categoriaId } : i)));
    try {
      await api(`/variaveis/${id}`, { method: "PATCH", body: JSON.stringify({ categoria_id: categoriaId }) });
      atualizar();
    } catch (e) { toast((e as Error).message, "erro"); carregar(); }
  }

  return (
    <>
      <h2>Gastos variáveis</h2>
      <p className="sub">Total do mês: <strong className="num negativo">{brl(total)}</strong> · troque o mês no topo · use “Adicionar transação” para lançar.</p>

      <div style={{ display: "flex", gap: "0.6rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <div className="busca-wrap glass card" style={{ flex: 1, minWidth: 180, padding: "0.4rem 0.6rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
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
        <p className="glass card sub">Nenhum gasto {busca ? "encontrado" : "lançado ainda"}.</p>
      ) : (
        <div className="glass card" style={{ padding: 0 }}>
          <table>
            <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Forma</th><th>Valor</th><th>Comprovante</th><th></th></tr></thead>
            <tbody>
              {filtrados.map((i) => (
                <tr key={i.id}>
                  <td>{new Date(i.data + "T00:00").toLocaleDateString("pt-BR")}</td>
                  <td><span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}><IcVariaveis /> {i.descricao}</span></td>
                  <td>
                    <select value={i.categoria_id ?? ""} onChange={(e) => definirCategoria(i.id, e.target.value ? Number(e.target.value) : null)}
                      aria-label={`Categoria de ${i.descricao}`} style={{ padding: "0.3rem 0.5rem", fontSize: "0.82rem" }}>
                      <option value="">—</option>
                      {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                  </td>
                  <td>{i.forma_pagamento && <span className="chip">{i.forma_pagamento}</span>}</td>
                  <td className="num negativo">{brl(i.valor_cents)}</td>
                  <td><AnexoCampo anexoId={i.anexo_id} onChange={(a) => definirAnexo(i.id, a)} /></td>
                  <td><button className="btn btn-icone btn-perigo" onClick={() => excluir(i.id)} aria-label="Excluir">×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
