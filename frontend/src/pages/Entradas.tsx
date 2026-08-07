import { useCallback, useEffect, useState } from "react";
import { api, brl } from "../api";
import { IcEntradas } from "../components/icones";
import { useToast } from "../components/Toast";
import { useAtualizacao, useCompetencia } from "../estado";

type Entrada = { id: number; descricao: string; valor_cents: number; data: string; recorrente: number };

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

  async function excluir(id: number) {
    if (!confirm("Excluir esta entrada?")) return;
    try {
      await api(`/entradas/${id}`, { method: "DELETE" });
      toast("Entrada excluída.");
      atualizar();
    } catch (e) { toast((e as Error).message, "erro"); }
  }

  return (
    <>
      <p className="sub">Total do mês: <strong className="num positivo">{brl(total)}</strong> · troque o mês no topo · use “Adicionar transação” para lançar.</p>
      {erro && <p className="erro">{erro}</p>}

      {carregando ? (
        <div className="skeleton" style={{ height: 200 }} />
      ) : itens.length === 0 ? (
        <p className="card sub">Nenhuma entrada lançada ainda.</p>
      ) : (
        <div className="card" style={{ padding: 0 }}>
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
