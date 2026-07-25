import { useCallback, useEffect, useMemo, useState } from "react";
import { api, brl } from "../api";
import AnexoCampo from "../components/AnexoCampo";
import { IcBusca, IcVariaveis } from "../components/icones";
import { useToast } from "../components/Toast";
import { useAtualizacao } from "../estado";

type Variavel = {
  id: number;
  descricao: string;
  valor_cents: number;
  data: string;
  forma_pagamento: string | null;
  anexo_id: number | null;
};

export default function Variaveis() {
  const toast = useToast();
  const { versao, atualizar } = useAtualizacao();
  const [itens, setItens] = useState<Variavel[]>([]);
  const [total, setTotal] = useState(0);
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(() => {
    setCarregando(true);
    api<{ itens: Variavel[]; total_cents: number }>("/variaveis")
      .then((r) => { setItens(r.itens); setTotal(r.total_cents); })
      .catch((e) => setErro(e.message))
      .finally(() => setCarregando(false));
  }, []);

  useEffect(carregar, [carregar, versao]);

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

  return (
    <>
      <h2>Gastos variáveis</h2>
      <p className="sub">Total: <strong className="num negativo">{brl(total)}</strong> · use “Adicionar transação” para lançar.</p>

      <div className="busca-wrap glass card" style={{ padding: "0.4rem 0.6rem", display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
        <IcBusca /><input placeholder="Buscar por descrição…" value={busca} onChange={(e) => setBusca(e.target.value)}
          aria-label="Buscar" style={{ border: "none", background: "transparent", padding: "0.35rem 0" }} />
      </div>
      {erro && <p className="erro">{erro}</p>}

      {carregando ? (
        <div className="skeleton" style={{ height: 220 }} />
      ) : filtrados.length === 0 ? (
        <p className="glass card sub">Nenhum gasto {busca ? "encontrado" : "lançado ainda"}.</p>
      ) : (
        <div className="glass card" style={{ padding: 0 }}>
          <table>
            <thead><tr><th>Data</th><th>Descrição</th><th>Forma</th><th>Valor</th><th>Comprovante</th><th></th></tr></thead>
            <tbody>
              {filtrados.map((i) => (
                <tr key={i.id}>
                  <td>{new Date(i.data + "T00:00").toLocaleDateString("pt-BR")}</td>
                  <td><span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}><IcVariaveis /> {i.descricao}</span></td>
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
