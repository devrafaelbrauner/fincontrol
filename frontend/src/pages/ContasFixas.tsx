import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, brl, competenciaAtual, paraCents } from "../api";
import AnexoCampo from "../components/AnexoCampo";

type Lancamento = {
  id: number;
  nome: string;
  valor_cents: number;
  vencimento: string;
  status: "pago" | "pendente" | "atrasado";
  anexo_id: number | null;
};

export default function ContasFixas() {
  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([]);
  const [nome, setNome] = useState("");
  const [dia, setDia] = useState("10");
  const [valor, setValor] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    api<Lancamento[]>(`/contas-fixas/lancamentos/${competencia}`)
      .then(setLancamentos)
      .catch((e) => setErro(e.message));
  }, [competencia]);

  useEffect(carregar, [carregar]);

  async function criar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    try {
      await api("/contas-fixas", {
        method: "POST",
        body: JSON.stringify({
          nome,
          dia_vencimento: Number(dia),
          valor_estimado_cents: paraCents(valor),
        }),
      });
      setNome("");
      setValor("");
      carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  async function alternarPago(l: Lancamento) {
    const rota = l.status === "pago" ? "desfazer-pagamento" : "pagar";
    await api(`/contas-fixas/lancamentos/${l.id}/${rota}`, { method: "POST", body: "{}" });
    carregar();
  }

  async function definirAnexo(id: number, anexoId: number | null) {
    await api(`/contas-fixas/lancamentos/${id}/anexo`, { method: "PATCH", body: JSON.stringify({ anexo_id: anexoId }) });
    carregar();
  }

  return (
    <>
      <h2>Contas fixas</h2>
      <input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />

      <form onSubmit={criar} className="linha-form">
        <input placeholder="Nome da conta" value={nome} onChange={(e) => setNome(e.target.value)} required />
        <input type="number" min={1} max={31} value={dia} onChange={(e) => setDia(e.target.value)} title="Dia de vencimento" required />
        <input placeholder="Valor (R$)" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} required />
        <button type="submit">Adicionar</button>
      </form>
      {erro && <p className="erro">{erro}</p>}

      <table>
        <thead>
          <tr><th>Conta</th><th>Vencimento</th><th>Valor</th><th>Status</th><th>Comprovante</th><th></th></tr>
        </thead>
        <tbody>
          {lancamentos.map((l) => (
            <tr key={l.id}>
              <td>{l.nome}</td>
              <td>{l.vencimento}</td>
              <td>{brl(l.valor_cents)}</td>
              <td><span className={`badge ${l.status}`}>{l.status}</span></td>
              <td><AnexoCampo anexoId={l.anexo_id} onChange={(id) => definirAnexo(l.id, id)} /></td>
              <td>
                <button onClick={() => alternarPago(l)}>
                  {l.status === "pago" ? "Desfazer" : "Pagar"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
