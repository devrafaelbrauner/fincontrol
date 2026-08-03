import { useCallback, useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { api, brl } from "../api";
import { AreaChart, COR_SEM_CATEGORIA, Donut, FatiaDonut, PALETA_SERIES, SerieMes } from "../components/graficos";
import { IcEconomia, IcEntradas, IcExtrair, IcMetas, IcVariaveis } from "../components/icones";
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
type Insights = { destaques: string[]; alertas: string[]; acoes?: string[]; sugestao: string };
type MetaResumo = { id: number; nome: string; valor_total_cents: number; valor_atual_cents: number; prazo: string };
type Orcamento = { categoria_id: number; nome: string; cor: string | null; limite_cents: number; gasto_cents: number };

/** Cor da barra de orçamento: julga o consumo, não decora. */
const corOrcamento = (pct: number) => (pct >= 100 ? "var(--negative)" : pct >= 80 ? "var(--warning)" : "var(--positive)");

/** O mês contado numa única barra: entradas consumidas por fixas e variáveis; o que resta é a sobra. */
function FioDoMes({ entradas, fixas, variaveis }: { entradas: number; fixas: number; variaveis: number }) {
  const despesas = fixas + variaveis;
  const base = Math.max(entradas, despesas, 1);
  const sobra = entradas - despesas;
  const pct = (v: number) => `${((v / base) * 100).toFixed(2)}%`;
  return (
    <div className="fio">
      <div className="fio-barra" role="img"
        aria-label={`Entradas ${brl(entradas)}; fixas ${brl(fixas)}; variáveis ${brl(variaveis)}; ${sobra >= 0 ? "sobra" : "excedente"} ${brl(Math.abs(sobra))}`}>
        {fixas > 0 && <span className="seg fixas" style={{ width: pct(fixas) }} />}
        {variaveis > 0 && <span className="seg variaveis" style={{ width: pct(variaveis) }} />}
        {sobra > 0 && <span className="seg sobra" style={{ width: pct(sobra) }} />}
      </div>
      <div className="fio-legenda">
        <span><i className="entradas" />Entradas <b className="num">{brl(entradas)}</b></span>
        <span><i className="fixas" />Fixas <b className="num">{brl(fixas)}</b></span>
        <span><i className="variaveis" />Variáveis <b className="num">{brl(variaveis)}</b></span>
        <span><i className={sobra >= 0 ? "sobra" : "excede"} />{sobra >= 0 ? "Sobra" : "Excedente"} <b className="num">{brl(Math.abs(sobra))}</b></span>
      </div>
      {entradas === 0 && despesas > 0 && (
        <p className="sub" style={{ fontSize: "0.78rem" }}>Sem entradas neste mês — registre suas receitas para o fio fazer sentido.</p>
      )}
    </div>
  );
}


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
  const [metas, setMetas] = useState<MetaResumo[]>([]);
  const [orcamentos, setOrcamentos] = useState<Orcamento[]>([]);
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
      const [vars, cats, listaMetas, orcs] = await Promise.all([
        api<{ itens: Variavel[] }>(`/variaveis?de=${competencia}-01&ate=${competencia}-${String(ate).padStart(2, "0")}`),
        api<Categoria[]>("/categorias"),
        // Metas e orçamentos alimentam cards secundários: uma falha aqui não
        // pode trocar a página inteira por uma mensagem de erro.
        api<MetaResumo[]>("/metas").catch(() => [] as MetaResumo[]),
        api<Orcamento[]>(`/orcamentos?competencia=${competencia}`).catch(() => [] as Orcamento[]),
      ]);
      setMetas(listaMetas);
      setOrcamentos(orcs);
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

  // Gasto médio por dia: no mês corrente divide pelos dias já decorridos.
  // Só sobre as variáveis. As fixas são lançadas de uma vez na virada da competência
  // (gerar_lancamentos_fixos), independente do vencimento, então incluí-las faria o
  // dia 2 de um mês com R$ 3.000 de contas fixas exibir R$ 1.500/dia.
  const [anoC, mesC] = competencia.split("-").map(Number);
  const agora = new Date();
  const ehMesAtual = agora.getFullYear() === anoC && agora.getMonth() + 1 === mesC;
  const diasBase = ehMesAtual ? agora.getDate() : new Date(anoC, mesC, 0).getDate();
  const mediaDia = Math.round(atual.variaveis_cents / Math.max(diasBase, 1));
  const varSaldo = ant ? variacao(atual.saldo_cents, ant.saldo_cents) : null;

  return (
    <>
      <h2>Visão geral</h2>
      <p className="sub">Resumo de {mesCurto(competencia)} de {competencia.slice(0, 4)}</p>

      <section className="card hero-mes surgir">
        <div className="hero-topo">
          <div>
            <span className="eyebrow">{atual.saldo_cents >= 0 ? "Sobra do mês" : "Faltando no mês"}</span>
            <div className="hero-valor num" style={{ color: atual.saldo_cents >= 0 ? "var(--positive)" : "var(--negative)" }}>
              {brl(atual.saldo_cents)}
            </div>
          </div>
          {varSaldo != null && (
            <span className="chip" title="Variação do saldo vs. mês anterior">
              {varSaldo > 0 ? "▲" : varSaldo < 0 ? "▼" : "•"} {Math.abs(varSaldo)}% vs. {mesCurto(ant.competencia)}
            </span>
          )}
        </div>
        <FioDoMes entradas={atual.entradas_cents} fixas={atual.fixas_cents} variaveis={atual.variaveis_cents} />
      </section>

      <div className="grid-stats secao">
        <StatCard rotulo="Receitas" cents={atual.entradas_cents} icone={<IcEntradas />} cor="var(--positive)" atraso={1}
          variacao={ant ? variacao(atual.entradas_cents, ant.entradas_cents) : null} serie={serie((d) => d.entradas_cents)} />
        <StatCard rotulo="Despesas" cents={despesas(atual)} icone={<IcVariaveis />} cor="var(--negative)" atraso={2} menosMelhor
          variacao={ant ? variacao(despesas(atual), despesas(ant)) : null} serie={serie(despesas)} />
        <StatCard rotulo={ehMesAtual ? "Gasto variável/dia (até hoje)" : "Gasto variável/dia"} cents={mediaDia}
          icone={<IcEconomia />} cor="var(--warning)" atraso={3} />
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

      <div className="grid-2 secao">
        <section className="card surgir" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <h3>Metas em andamento</h3>
          {metas.length === 0 ? (
            <p className="sub">Nenhuma meta ativa. <NavLink to="/metas" style={{ color: "var(--accent-vivid)", fontWeight: 600 }}>Crie a primeira</NavLink> e planeje os itens dela.</p>
          ) : (
            metas.map((m) => {
              const pct = Math.min((m.valor_atual_cents / Math.max(m.valor_total_cents, 1)) * 100, 100);
              return (
                <NavLink key={m.id} to="/metas" className="meta-mini">
                  <div className="meta-mini-linha">
                    <strong style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}><IcMetas /> {m.nome}</strong>
                    <span className="sub num" style={{ fontSize: "0.8rem" }}>{brl(m.valor_atual_cents)} / {brl(m.valor_total_cents)}</span>
                  </div>
                  <div className="barra-mini"><span style={{ width: `${pct}%` }} /></div>
                </NavLink>
              );
            })
          )}
        </section>

        <section className="surgir">
        <h3 style={{ marginBottom: "0.75rem" }}>Próximos vencimentos</h3>
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
      </div>

      {orcamentos.length > 0 && (
        <section className="card surgir secao">
          <h3>Orçamentos do mês</h3>
          {/* O limite não é versionado por mês — num mês antigo, o vermelho
              compara o gasto de lá com o limite DE HOJE. Dizer isso evita o
              susto de "estourei março" num mês em que o orçamento nem existia. */}
          <p className="sub">Gasto variável do mês exibido contra o limite atual de cada categoria.</p>
          <div className="legenda" style={{ gap: "0.8rem", marginTop: "0.5rem" }}>
            {orcamentos.map((o) => {
              const pct = (o.gasto_cents / o.limite_cents) * 100;
              return (
                <NavLink key={o.categoria_id} to="/analises" style={{ color: "inherit", textDecoration: "none" }}>
                  <div className="item" style={{ marginBottom: "0.25rem" }}>
                    <span className="ponto" style={{ background: corOrcamento(pct) }} />
                    <span>{o.nome}</span>
                    <span className="pct num">{brl(o.gasto_cents)} de {brl(o.limite_cents)} · {Math.round(pct)}%</span>
                  </div>
                  <div className="progresso"><i style={{ width: `${Math.min(pct, 100)}%`, background: corOrcamento(pct) }} /></div>
                </NavLink>
              );
            })}
          </div>
        </section>
      )}

      <section className="secao">
        <div className="insights-cabecalho">
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
            {insights.acoes && insights.acoes.length > 0 && (
              <ul className="insights-lista">
                {insights.acoes.map((a, i) => <li key={i}><span className="ponto-in" style={{ background: "var(--positive)" }} />{a}</li>)}
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
