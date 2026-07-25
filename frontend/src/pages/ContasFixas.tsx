import { useCallback, useEffect, useState } from "react";
import { api, brl } from "../api";
import AnexoCampo from "../components/AnexoCampo";
import { useToast } from "../components/Toast";
import { useAtualizacao, useCompetencia } from "../estado";

type Lancamento = {
  id: number;
  nome: string;
  valor_cents: number;
  vencimento: string;
  status: "pago" | "pendente" | "atrasado";
  anexo_id: number | null;
};

export default function ContasFixas() {
  const toast = useToast();
  const { competencia } = useCompetencia();
  const { versao } = useAtualizacao();
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(() => {
    setCarregando(true);
    api<Lancamento[]>(`/contas-fixas/lancamentos/${competencia}`)
      .then(setLancamentos)
      .catch((e) => setErro(e.message))
      .finally(() => setCarregando(false));
  }, [competencia]);

  useEffect(carregar, [carregar, versao]);

  async function alternarPago(l: Lancamento) {
    const rota = l.status === "pago" ? "desfazer-pagamento" : "pagar";
    try {
      await api(`/contas-fixas/lancamentos/${l.id}/${rota}`, { method: "POST", body: "{}" });
      toast(l.status === "pago" ? "Pagamento desfeito." : "Marcada como paga.");
      carregar();
    } catch (e) { toast((e as Error).message, "erro"); }
  }

  async function definirAnexo(id: number, anexoId: number | null) {
    await api(`/contas-fixas/lancamentos/${id}/anexo`, { method: "PATCH", body: JSON.stringify({ anexo_id: anexoId }) });
    carregar();
  }

  const totalMes = lancamentos.reduce((s, l) => s + l.valor_cents, 0);
  const mesExtenso = new Date(Number(competencia.slice(0, 4)), Number(competencia.slice(5)) - 1)
    .toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <>
      <h2>Contas fixas</h2>
      <p className="sub">
        Competência {mesExtenso} · total <strong className="num">{brl(totalMes)}</strong> (troque o mês no topo)
      </p>
      {erro && <p className="erro">{erro}</p>}

      {carregando ? (
        <div className="skeleton" style={{ height: 220 }} />
      ) : lancamentos.length === 0 ? (
        <p className="glass card sub">Nenhuma conta fixa. Adicione uma pelo botão “Adicionar transação”.</p>
      ) : (
        <div className="glass card" style={{ padding: 0 }}>
          <table>
            <thead><tr><th>Conta</th><th>Vencimento</th><th>Valor</th><th>Status</th><th>Comprovante</th><th></th></tr></thead>
            <tbody>
              {lancamentos.map((l) => (
                <tr key={l.id}>
                  <td>{l.nome}</td>
                  <td>{new Date(l.vencimento + "T00:00").toLocaleDateString("pt-BR")}</td>
                  <td className="num">{brl(l.valor_cents)}</td>
                  <td><span className={`badge ${l.status}`}>{l.status}</span></td>
                  <td><AnexoCampo anexoId={l.anexo_id} onChange={(a) => definirAnexo(l.id, a)} /></td>
                  <td>
                    <button className={`btn ${l.status === "pago" ? "" : "btn-primario"}`} onClick={() => alternarPago(l)}>
                      {l.status === "pago" ? "Desfazer" : "Pagar"}
                    </button>
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
