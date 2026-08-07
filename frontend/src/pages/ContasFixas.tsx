import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, brl, paraCents } from "../api";
import AnexoCampo from "../components/AnexoCampo";
import Modal from "../components/Modal";
import { useToast } from "../components/Toast";
import { useAtualizacao, useCompetencia } from "../estado";

type Lancamento = {
  id: number;
  conta_fixa_id: number;
  nome: string;
  valor_cents: number;
  dia_vencimento: number;
  vencimento: string;
  status: "pago" | "pendente" | "atrasado";
  anexo_id: number | null;
};
type Edicao = { conta_id: number; nome: string; dia: string; valor: string };

export default function ContasFixas() {
  const toast = useToast();
  const { competencia } = useCompetencia();
  const { versao } = useAtualizacao();
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [edicao, setEdicao] = useState<Edicao | null>(null);

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

  async function excluirConta(l: Lancamento) {
    if (!confirm(`Excluir a conta fixa "${l.nome}" e todo o histórico dela?`)) return;
    try {
      await api(`/contas-fixas/${l.conta_fixa_id}`, { method: "DELETE" });
      toast("Conta fixa excluída.");
      carregar();
    } catch (e) { toast((e as Error).message, "erro"); }
  }

  async function salvarEdicao(e: FormEvent) {
    e.preventDefault();
    if (!edicao) return;
    try {
      await api(`/contas-fixas/${edicao.conta_id}`, {
        method: "PATCH",
        body: JSON.stringify({ nome: edicao.nome, dia_vencimento: Number(edicao.dia), valor_estimado_cents: paraCents(edicao.valor) }),
      });
      toast("Conta fixa atualizada.");
      setEdicao(null);
      carregar();
    } catch (err) { toast((err as Error).message, "erro"); }
  }

  const totalMes = lancamentos.reduce((s, l) => s + l.valor_cents, 0);
  // Os quatro indicadores da faixa. "Em aberto" inclui o atrasado de propósito:
  // é o que ainda vai sair do bolso, e separar as duas coisas faria a soma dos
  // quatro números não fechar com o total.
  const somaSe = (p: (s: string) => boolean) =>
    lancamentos.reduce((s, l) => s + (p(l.status) ? l.valor_cents : 0), 0);
  const totalPago = somaSe((s) => s === "pago");
  const totalAberto = totalMes - totalPago;
  const totalAtrasado = somaSe((s) => s === "atrasado");
  const mesExtenso = new Date(Number(competencia.slice(0, 4)), Number(competencia.slice(5)) - 1)
    .toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <>
      <p className="sub">
        Competência {mesExtenso} · troque o mês no topo
      </p>
      {erro && <p className="erro">{erro}</p>}

      {!carregando && lancamentos.length > 0 && (
        <div className="kpi-faixa">
          <div className="kpi"><span className="eyebrow">Total do mês</span><span className="kpi-valor num">{brl(totalMes)}</span></div>
          <div className="kpi"><span className="eyebrow">Pago</span><span className="kpi-valor num" style={{ color: "var(--positive)" }}>{brl(totalPago)}</span></div>
          <div className="kpi"><span className="eyebrow">Em aberto</span><span className="kpi-valor num">{brl(totalAberto)}</span></div>
          <div className="kpi"><span className="eyebrow">Atrasado</span><span className="kpi-valor num" style={{ color: totalAtrasado > 0 ? "var(--negative)" : undefined }}>{brl(totalAtrasado)}</span></div>
        </div>
      )}

      {carregando ? (
        <div className="skeleton" style={{ height: 220 }} />
      ) : lancamentos.length === 0 ? (
        <p className="sub">Nenhuma conta fixa. Adicione uma pelo botão “Adicionar transação”.</p>
      ) : (
        <div className="tabela-lisa">
          <div className="secao-regua">
            <h3 className="secao-titulo">{lancamentos.length} {lancamentos.length === 1 ? "conta fixa" : "contas fixas"}</h3>
          </div>
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
                  <td style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                    <button className={`btn ${l.status === "pago" ? "" : "btn-primario"}`} onClick={() => alternarPago(l)}>
                      {l.status === "pago" ? "Desfazer" : "Pagar"}
                    </button>
                    <button className="btn btn-icone" onClick={() => setEdicao({ conta_id: l.conta_fixa_id, nome: l.nome, dia: String(l.dia_vencimento), valor: (l.valor_cents / 100).toFixed(2).replace(".", ",") })} aria-label="Editar conta" title="Editar">✎</button>
                    <button className="btn btn-icone btn-perigo" onClick={() => excluirConta(l)} aria-label="Excluir conta" title="Excluir">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td />
                <td className="num">{brl(totalMes)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <Modal titulo="Editar conta fixa" aberto={!!edicao} aoFechar={() => setEdicao(null)}>
        {edicao && (
          <form onSubmit={salvarEdicao} className="campos">
            <div className="campo"><label htmlFor="cf-nome">Nome</label>
              <input id="cf-nome" value={edicao.nome} onChange={(e) => setEdicao({ ...edicao, nome: e.target.value })} required autoFocus /></div>
            <div className="campo"><label htmlFor="cf-dia">Dia de vencimento</label>
              <input id="cf-dia" type="number" min={1} max={31} value={edicao.dia} onChange={(e) => setEdicao({ ...edicao, dia: e.target.value })} required /></div>
            <div className="campo"><label htmlFor="cf-valor">Valor estimado (R$)</label>
              <input id="cf-valor" inputMode="decimal" value={edicao.valor} onChange={(e) => setEdicao({ ...edicao, valor: e.target.value })} required /></div>
            <div className="acoes-modal"><button className="btn btn-primario" type="submit">Salvar</button><button className="btn" type="button" onClick={() => setEdicao(null)}>Cancelar</button></div>
          </form>
        )}
      </Modal>
    </>
  );
}
