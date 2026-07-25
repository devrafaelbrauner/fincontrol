import { useEffect, useState } from "react";
import { api, brl, competenciaAtual } from "../api";

type Dash = {
  competencia: string;
  entradas_cents: number;
  fixas_cents: number;
  variaveis_cents: number;
  saldo_cents: number;
  proximos_vencimentos: { id: number; nome: string; valor_cents: number; vencimento: string; status: string }[];
};

export default function Dashboard() {
  const [dash, setDash] = useState<Dash | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [insights, setInsights] = useState<string | null>(null);
  const [carregandoIa, setCarregandoIa] = useState(false);
  const [erroIa, setErroIa] = useState<string | null>(null);

  useEffect(() => {
    api<Dash>(`/dashboard/${competenciaAtual()}`).then(setDash).catch((e) => setErro(e.message));
  }, []);

  async function pedirInsights() {
    setErroIa(null);
    setCarregandoIa(true);
    try {
      const r = await api<{ insights: string }>(`/ia/insights/${competenciaAtual()}`, { method: "POST", body: "{}" });
      setInsights(r.insights);
    } catch (e) {
      setErroIa((e as Error).message);
    } finally {
      setCarregandoIa(false);
    }
  }

  if (erro) return <p className="erro">{erro}</p>;
  if (!dash) return <p>Carregando…</p>;

  return (
    <>
      <h2>Resumo de {dash.competencia}</h2>
      <div className="cards">
        <div className="card">
          <span>Saldo do mês</span>
          <strong className={dash.saldo_cents < 0 ? "negativo" : "positivo"}>{brl(dash.saldo_cents)}</strong>
        </div>
        <div className="card">
          <span>Entradas</span>
          <strong>{brl(dash.entradas_cents)}</strong>
        </div>
        <div className="card">
          <span>Contas fixas</span>
          <strong>{brl(dash.fixas_cents)}</strong>
        </div>
        <div className="card">
          <span>Variáveis</span>
          <strong>{brl(dash.variaveis_cents)}</strong>
        </div>
      </div>

      <div className="insights-cabecalho">
        <h3>Insights de IA</h3>
        <button onClick={pedirInsights} disabled={carregandoIa}>
          {carregandoIa ? "Analisando…" : "✨ analisar mês"}
        </button>
      </div>
      {erroIa && <p className="erro">{erroIa}</p>}
      {insights && <div className="insights-texto">{insights}</div>}

      <h3>Próximos vencimentos</h3>
      {dash.proximos_vencimentos.length === 0 ? (
        <p>Nada pendente neste mês. 🎉</p>
      ) : (
        <table>
          <tbody>
            {dash.proximos_vencimentos.map((v) => (
              <tr key={v.id}>
                <td>{v.nome}</td>
                <td>{v.vencimento}</td>
                <td>{brl(v.valor_cents)}</td>
                <td>
                  <span className={`badge ${v.status}`}>{v.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
