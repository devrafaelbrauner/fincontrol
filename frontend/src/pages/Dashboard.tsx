import { useCallback, useEffect, useState } from "react";
import { api, brl } from "../api";
import { AreaChart, COR_SEM_CATEGORIA, Donut, FatiaDonut, PALETA_SERIES, SerieMes } from "../components/graficos";
import { IcEconomia, IcEntradas, IcExtrair, IcSaldo, IcVariaveis } from "../components/icones";
import StatCard from "../components/StatCard";
import { useAtualizacao, useCompetencia } from "../estado";

type Dash = {
  competencia: string;
  entradas_cents: number;
  fixas_cents: number;
  variaveis_cents: number;
  saldo_cents: number;
  proximos_vencimentos: { id: number; nome: string; valor_cents: number; vencimento: string; status: string }[];
};
type Categoria = { id: number; nome: string; cor: string | null };
type Variavel = { valor_cents: number; categoria_id: number | null };
type Insights = { destaques: string[]; alertas: string[]; sugestao: string };


/** Lista de N competências terminando em `fim` (inclusive), da mais antiga à mais nova. */
function ultimasCompetencias(fim: string, n: number): string[] {
  let [ano, mes] = fim.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.unshift(`${ano}-${String(mes).padStart(2, "0")}`);
    mes--;
    if (mes === 0) { mes = 12; ano--; }
  }
  return out;
}

const mesCurto = (comp: string) =>
  new Date(Number(comp.slice(0, 4)), Number(comp.slice(5, 7)) - 1, 1).toLocaleDateString("pt-BR", { month: "short" });

const variacao = (atual: number, ant: number): number | null =>
  ant === 0 ? null : Math.round(((atual - ant) / Math.abs(ant)) * 1000) / 10;

export default function Dashboard() {
  const { competencia } = useCompetencia();
  const { versao } = useAtualizacao();
  const [meses, setMeses] = useState<Dash[]>([]);
  const [donut, setDonut] = useState<FatiaDonut[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [insights, setInsights] = useState<Insights | null>(null);
  const [geradoEm, setGeradoEm] = useState<string | null>(null);
  const [iaCarregando, setIaCarregando] = useState(false);
  const [iaErro, setIaErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const comps = ultimasCompetencias(competencia, 6);
      const dados = await Promise.all(comps.map((c) => api<Dash>(`/dashboard/${c}`)));
      setMeses(dados);

      const [ano, mes] = competencia.split("-");
      const ate = new Date(Number(ano), Number(mes), 0).getDate();
      const [vars, cats] = await Promise.all([
        api<{ itens: Variavel[] }>(`/variaveis?de=${competencia}-01&ate=${competencia}-${String(ate).padStart(2, "0")}`),
        api<Categoria[]>("/categorias"),
      ]);
      const nomes = new Map(cats.map((c) => [c.id, c] as const));
      const soma = new Map<string, { valor: number; cor: string | null }>();
      for (const v of vars.itens) {
        const c = v.categoria_id != null ? nomes.get(v.categoria_id) : undefined;
        const nome = c?.nome ?? "Sem categoria";
        const at = soma.get(nome) ?? { valor: 0, cor: c?.cor ?? null };
        at.valor += v.valor_cents;
        soma.set(nome, at);
      }
      const fatias = [...soma.entries()]
        .sort((a, b) => b[1].valor - a[1].valor)
        .map(([rotulo, x], i): FatiaDonut => ({
          rotulo,
          valor: x.valor,
          cor: rotulo === "Sem categoria" ? COR_SEM_CATEGORIA : x.cor ?? PALETA_SERIES[i % PALETA_SERIES.length],
        }));
      setDonut(fatias);

      // Insights: carrega do cache (instantâneo, sem re-cobrar).
      const cache = await api<{ insights: Insights | null; gerado_em?: string }>(`/ia/insights/${competencia}`);
      setInsights(cache.insights);
      setGeradoEm(cache.gerado_em ?? null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [competencia, versao]);

  useEffect(() => { carregar(); }, [carregar]);

  async function pedirInsights() {
    setIaErro(null);
    setIaCarregando(true);
    try {
      const r = await api<{ insights: Insights | null; gerado_em?: string }>(`/ia/insights/${competencia}`, { method: "POST", body: "{}" });
      setInsights(r.insights);
      setGeradoEm(r.gerado_em ?? null);
    } catch (e) {
      setIaErro((e as Error).message);
    } finally {
      setIaCarregando(false);
    }
  }

  if (erro) return <p className="erro">{erro}</p>;

  if (carregando) {
    return (
      <>
        <h2>Visão geral</h2>
        <div className="grid-stats">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 150 }} />)}</div>
      </>
    );
  }

  const atual = meses[meses.length - 1];
  const ant = meses[meses.length - 2];
  const despesas = (d: Dash) => d.fixas_cents + d.variaveis_cents;
  const serie = (sel: (d: Dash) => number) => meses.map(sel);
  const fluxo: SerieMes[] = meses.map((d) => ({ rotulo: mesCurto(d.competencia), entradas: d.entradas_cents, despesas: despesas(d), saldo: d.saldo_cents }));

  return (
    <>
      <h2>Visão geral</h2>
      <p className="sub">Resumo de {mesCurto(competencia)} de {competencia.slice(0, 4)}</p>

      <div className="grid-stats">
        <StatCard rotulo="Saldo do mês" cents={atual.saldo_cents} icone={<IcSaldo />} atraso={1}
          cor={atual.saldo_cents < 0 ? "var(--negative)" : "var(--positive)"}
          variacao={ant ? variacao(atual.saldo_cents, ant.saldo_cents) : null} serie={serie((d) => d.saldo_cents)} />
        <StatCard rotulo="Receitas" cents={atual.entradas_cents} icone={<IcEntradas />} cor="var(--positive)" atraso={2}
          variacao={ant ? variacao(atual.entradas_cents, ant.entradas_cents) : null} serie={serie((d) => d.entradas_cents)} />
        <StatCard rotulo="Despesas" cents={despesas(atual)} icone={<IcVariaveis />} cor="var(--negative)" atraso={3} menosMelhor
          variacao={ant ? variacao(despesas(atual), despesas(ant)) : null} serie={serie(despesas)} />
        <StatCard rotulo="Economia" cents={atual.saldo_cents} icone={<IcEconomia />} cor="var(--accent)" atraso={4}
          variacao={ant ? variacao(atual.saldo_cents, ant.saldo_cents) : null} serie={serie((d) => d.saldo_cents)} />
      </div>

      <div className="grid-2 secao">
        <section className="card surgir">
          <h3>Fluxo financeiro</h3>
          <AreaChart dados={fluxo} />
          <div className="legenda" style={{ flexDirection: "row", gap: "1rem", marginTop: "0.5rem" }}>
            <span className="item"><span className="ponto" style={{ background: "var(--positive)" }} />Receitas</span>
            <span className="item"><span className="ponto" style={{ background: "var(--negative)" }} />Despesas</span>
            <span className="item"><span className="ponto" style={{ background: "var(--accent)" }} />Saldo</span>
          </div>
        </section>

        <section className="card surgir" style={{ display: "flex", flexDirection: "column" }}>
          <h3>Distribuição de despesas</h3>
          <div style={{ flex: 1, display: "grid", alignItems: "center" }}>
            <Donut fatias={donut} />
          </div>
        </section>
      </div>

      <section className="secao">
        <h3>Próximos vencimentos</h3>
        {atual.proximos_vencimentos.length === 0 ? (
          <p className="card sub">Nada pendente neste mês. 🎉</p>
        ) : (
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead><tr><th>Conta</th><th>Vencimento</th><th>Valor</th><th>Status</th></tr></thead>
              <tbody>
                {atual.proximos_vencimentos.map((v) => (
                  <tr key={v.id}>
                    <td>{v.nome}</td>
                    <td>{new Date(v.vencimento + "T00:00").toLocaleDateString("pt-BR")}</td>
                    <td className="num">{brl(v.valor_cents)}</td>
                    <td><span className={`badge ${v.status}`}>{v.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="secao">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3>Insights de IA</h3>
          <button className="btn btn-primario" onClick={pedirInsights} disabled={iaCarregando}>
            <IcExtrair />{iaCarregando ? "Analisando…" : insights ? "Recalcular" : "Analisar mês"}
          </button>
        </div>
        {iaErro && <p className="erro">{iaErro}</p>}
        {!insights && !iaCarregando && !iaErro && (
          <p className="card sub">Clique em “Analisar mês” para a IA comentar suas finanças.</p>
        )}
        {iaCarregando && !insights && <div className="skeleton" style={{ height: 120 }} />}
        {insights && (
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
            {insights.destaques?.length > 0 && (
              <ul className="insights-lista">
                {insights.destaques.map((d, i) => <li key={i}><span className="ponto-in" style={{ background: "var(--accent)" }} />{d}</li>)}
              </ul>
            )}
            {insights.alertas?.length > 0 && (
              <ul className="insights-lista">
                {insights.alertas.map((a, i) => <li key={i}><span className="ponto-in" style={{ background: "var(--warning)" }} />⚠️ {a}</li>)}
              </ul>
            )}
            {insights.sugestao && (
              <div className="insights-sugestao"><strong>Sugestão:</strong> {insights.sugestao}</div>
            )}
            {geradoEm && <div className="sub" style={{ fontSize: "0.72rem" }}>Gerado em {new Date(geradoEm.replace(" ", "T") + "Z").toLocaleString("pt-BR")}</div>}
          </div>
        )}
      </section>
    </>
  );
}
