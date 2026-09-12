import { useCallback, useEffect, useState } from "react";
import { api, brl, ehConflito } from "../api";
import { IcEntradas, IcFechar } from "../components/icones";
import { useToast } from "../components/Toast";
import { useAtualizacao, useCompetencia } from "../estado";
import ValorHero from "../components/ValorHero";

type Entrada = { id: number; versao: number; descricao: string; valor_cents: number; data: string; recorrente: number };

const ultimoDia = (comp: string) => new Date(Number(comp.slice(0, 4)), Number(comp.slice(5)), 0).getDate();

export default function Entradas() {
  const toast = useToast();
  const { competencia } = useCompetencia();
  const { versao, atualizar } = useAtualizacao();
  const [itens, setItens] = useState<Entrada[]>([]);
  const [total, setTotal] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(() => {
    setCarregando(true);
    const ate = `${competencia}-${String(ultimoDia(competencia)).padStart(2, "0")}`;
    api<{ itens: Entrada[]; total_cents: number }>(`/entradas?de=${competencia}-01&ate=${ate}`)
      .then((r) => { setItens(r.itens); setTotal(r.total_cents); })
      .catch((e) => setErro(e.message))
      .finally(() => setCarregando(false));
  }, [competencia]);

  useEffect(carregar, [carregar, versao]);

  async function excluir(i: Entrada) {
    if (!confirm("Excluir esta entrada?")) return;
    try {
      await api(`/entradas/${i.id}`, { method: "DELETE", headers: { "If-Match": String(i.versao) } });
      toast("Entrada excluída.");
      atualizar();
    } catch (e) {
      toast((e as Error).message, ehConflito(e) ? undefined : "erro");
      if (ehConflito(e)) carregar();
    }
  }

  return (
    <>
      <div className="visao-hero" style={{ marginBottom: "26px" }}>
        <div className="eyebrow">Entradas no mês</div>
        <div className="hero-linha">
          <span className="hero-valor num" style={{ color: "var(--positive)" }}><ValorHero cents={total} /></span>
        </div>
        <p className="leitura">Troque o mês no topo, ou use “Transação” para lançar.</p>
      </div>
      {erro && <p className="erro">{erro}</p>}

      {carregando ? (
        <div className="skeleton" style={{ height: 200 }} />
      ) : itens.length === 0 ? (
        <p className="sub">Nenhuma entrada lançada ainda.</p>
      ) : (
        <div className="tabela-lisa">
          <table>
            <thead><tr><th>Data</th><th>Descrição</th><th>Valor</th><th></th></tr></thead>
            <tbody>
              {itens.map((i) => (
                <tr key={i.id}>
                  <td>{new Date(i.data + "T00:00").toLocaleDateString("pt-BR")}</td>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
                      <IcEntradas /> {i.descricao}
                      {i.recorrente ? <span className="chip">recorrente</span> : null}
                    </span>
                  </td>
                  <td className="num positivo">{brl(i.valor_cents)}</td>
                  <td><button className="btn btn-icone btn-perigo" onClick={() => excluir(i)} aria-label="Excluir"><IcFechar /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
