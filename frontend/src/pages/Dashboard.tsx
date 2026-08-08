import { useCallback, useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { api, brl } from "../api";
import AnimatedNumber from "../components/AnimatedNumber";
import ValorHero from "../components/ValorHero";
import { Fio } from "../components/Fio";
import { AreaChart, BarrasRank, COR_SEM_CATEGORIA, FatiaDonut, ROTULO_SEM_CATEGORIA, SerieMes, Sparkline, dobrarEmOutros, resolverCores } from "../components/graficos";
import { IcDesceu, IcEstavel, IcExtrair, IcMetas, IcSubiu } from "../components/icones";
import { useAtualizacao, useCompetencia } from "../estado";

type Dash = {
  competencia: string;
  entradas_cents: number;
  fixas_cents: number;
  variaveis_cents: number;
  saldo_cents: number;
  // valor_cents nulo = compromisso registrado sem valor (o prazo e o valor são
  // opcionais desde a migration 014). Nunca renderizar como 0: R$ 0,00 se lê como
  // "não devo nada", que é o oposto de "ainda não sei quanto".
  proximos_vencimentos: { id: number; nome: string; valor_cents: number | null; vencimento: string; status: string }[];
};
type Categoria = { id: number; nome: string; cor: string | null };
type Variavel = { valor_cents: number; categoria_id: number | null };
type Insights = { destaques: string[]; alertas: string[]; acoes?: string[]; sugestao: string };
type MetaResumo = { id: number; nome: string; valor_total_cents: number; valor_atual_cents: number; prazo: string };
type Orcamento = { categoria_id: number; nome: string; cor: string | null; limite_cents: number; gasto_cents: number };

/** Cor da barra de orçamento: julga o consumo, não decora. */
const corOrcamento = (pct: number) => (pct >= 100 ? "var(--negative)" : pct >= 80 ? "var(--warning)" : "var(--positive)");

/** O mês contado numa única barra: entradas consumidas por fixas e variáveis; o que resta é a sobra. */
/** Item do trilho lateral: rótulo, variação, valor e sparkline, separados por
 *  régua. Substitui o card com ícone e borda — no redesign o que separa é o
 *  espaço e a linha de 1px, não uma caixa. */
function TrilhoItem({ rotulo, cents, cor, variacao: v, menosMelhor, serie }: {
  rotulo: string; cents: number; cor: string;
  variacao?: number | null; menosMelhor?: boolean; serie?: number[];
}) {
  const bom = v == null ? null : menosMelhor ? v <= 0 : v >= 0;
  return (
    <div className="trilho-item">
      <div className="trilho-topo">
        <span className="trilho-rotulo">{rotulo}</span>
        {v != null && (
          <span className="trilho-var num" style={{ color: bom ? "var(--positive)" : "var(--negative)" }}>
            {v >= 0 ? <IcSubiu /> : <IcDesceu />} {Math.abs(v).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="trilho-valor num" style={{ color: cor }}><AnimatedNumber cents={cents} /></div>
      {serie && serie.length > 1 && <div className="trilho-spark"><Sparkline valores={serie} cor={cor} /></div>}
    </div>
  );
}

function FioDoMes({ entradas, fixas, variaveis }: { entradas: number; fixas: number; variaveis: number }) {
  const despesas = fixas + variaveis;
  const sobra = entradas - despesas;
  return (
    <>
      {/* `base` é o maior entre o que entrou e o que saiu: é o que faz a barra
          mostrar que as despesas NÃO consumiram tudo. Sem "Entradas" na
          legenda — o total já é a barra inteira, e ele sai por extenso no
          parágrafo de leitura logo acima. */}
      <Fio
        base={Math.max(entradas, despesas, 1)}
        rotuloAria={`Entradas ${brl(entradas)}; fixas ${brl(fixas)}; variáveis ${brl(variaveis)}; ${sobra >= 0 ? "economia" : "excedente"} ${brl(Math.abs(sobra))}`}
        fatias={[
          { rotulo: "Fixas", valor: fixas, cor: "var(--accent)" },
          { rotulo: "Variáveis", valor: variaveis, cor: "var(--warning)" },
          {
            rotulo: sobra >= 0 ? "Economia" : "Excedente",
            // Negativo entra na legenda e fica fora da barra: mês no vermelho
            // não tem pedaço a desenhar.
            valor: sobra >= 0 ? sobra : -Math.abs(sobra),
            cor: sobra >= 0 ? "var(--positive)" : "var(--negative)",
          },
        ]}
      />
      {entradas === 0 && despesas > 0 && (
        <p className="sub" style={{ fontSize: "0.78rem" }}>Sem entradas neste mês — registre suas receitas para o fio fazer sentido.</p>
      )}
    </>
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
      const soma = new Map<number | null, { nome: string; valor: number }>();
      for (const v of vars.itens) {
        const c = v.categoria_id != null ? nomes.get(v.categoria_id) : undefined;
        const chave = c?.id ?? null;
        const at = soma.get(chave) ?? { nome: c?.nome ?? ROTULO_SEM_CATEGORIA, valor: 0 };
        at.valor += v.valor_cents;
        soma.set(chave, at);
      }
      // Cores resolvidas de uma vez, na ordem de leitura (maior gasto
      // primeiro), para as linhas do topo ficarem com cores distintas.
      const porGasto = [...soma.entries()].sort((a, b) => b[1].valor - a[1].valor);
      const cores = resolverCores(porGasto.map(([id]) => nomes.get(id as number)).filter((c): c is NonNullable<typeof c> => c != null));
      // Cinco linhas como antes, mas a quinta agora SOMA a cauda em vez de
      // recortá-la fora: com o `slice(0, 5)` os percentuais exibidos não
      // fechavam com o total impresso ao lado da seção.
      const fatias: FatiaDonut[] = porGasto.map(([id, x]) => ({
        rotulo: x.nome, valor: x.valor,
        cor: id == null ? COR_SEM_CATEGORIA : cores.get(id) ?? COR_SEM_CATEGORIA,
      }));
      setDonut(dobrarEmOutros(fatias, 5));

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
  // "MAR — AGO": diz de quando a quando o gráfico fala, sem ocupar um eixo.
  const periodoFluxo = meses.length > 1 ? `${mesCurto(meses[0].competencia)} — ${mesCurto(atual.competencia)}` : "";

  return (
    <>
      <p className="sub">Resumo de {mesCurto(competencia)} de {competencia.slice(0, 4)}</p>

      <div className="visao-topo surgir">
        <div className="visao-hero">
          <div className="eyebrow">{atual.saldo_cents >= 0 ? "Economia mensal" : "Faltando no mês"}</div>
          <div className="hero-linha">
            <span className="hero-valor num" style={{ color: atual.saldo_cents >= 0 ? "var(--positive)" : "var(--negative)" }}>
              <ValorHero cents={atual.saldo_cents} />
            </span>
            {varSaldo != null && (
              <span className={`chip-var ${varSaldo >= 0 ? "bom" : "ruim"}`} title="Variação vs. mês anterior">
                {varSaldo > 0 ? <IcSubiu /> : varSaldo < 0 ? <IcDesceu /> : <IcEstavel />} {Math.abs(varSaldo)}% vs. {mesCurto(ant.competencia)}
              </span>
            )}
          </div>
          <p className="leitura">
            Você recebeu <b className="num">{brl(atual.entradas_cents)}</b>
            {atual.entradas_cents > 0 && <> e comprometeu <b>{Math.round((despesas(atual) / atual.entradas_cents) * 100)}%</b> disso</>}
            {" "}com contas fixas e gastos variáveis.{" "}
            {atual.saldo_cents >= 0 ? "No ritmo atual, fecha o mês com economia." : "No ritmo atual, o mês fecha no vermelho."}
          </p>
          <FioDoMes entradas={atual.entradas_cents} fixas={atual.fixas_cents} variaveis={atual.variaveis_cents} />
        </div>

        <div className="visao-divisor" />

        <div className="trilho">
          <TrilhoItem rotulo="Receitas" cents={atual.entradas_cents} cor="var(--positive)"
            variacao={ant ? variacao(atual.entradas_cents, ant.entradas_cents) : null} serie={serie((d) => d.entradas_cents)} />
          <TrilhoItem rotulo="Despesas" cents={despesas(atual)} cor="var(--negative)" menosMelhor
            variacao={ant ? variacao(despesas(atual), despesas(ant)) : null} serie={serie(despesas)} />
          <TrilhoItem rotulo={ehMesAtual ? "Variável por dia (até hoje)" : "Variável por dia"} cents={mediaDia} cor="var(--warning)" />
        </div>
      </div>

      <div className="grid-2 secao">
        <section className="surgir">
          <div className="secao-regua">
            <h3 className="secao-titulo">Fluxo dos últimos 6 meses</h3>
            <span className="eyebrow">{periodoFluxo}</span>
          </div>
          {/* A legenda manual que ficava aqui saiu: a linha de leitura do
              próprio gráfico já traz ponto colorido, nome e valor do mês em
              foco — duas legendas diriam a mesma coisa duas vezes. */}
          <AreaChart dados={fluxo} />
        </section>

        {/* Barras no lugar do donut: o design ranqueia para responder "onde foi
            o dinheiro", pergunta que uma rosca responde pior — comparar arcos é
            mais difícil que comparar comprimentos. */}
        <section className="surgir">
          <div className="secao-regua">
            <h3 className="secao-titulo">Onde foi o variável</h3>
            <span className="eyebrow">{brl(atual.variaveis_cents)}</span>
          </div>
          <BarrasRank fatias={donut} total={atual.variaveis_cents} />
        </section>
      </div>

      <div className="grid-2 secao">
        <section className="surgir">
          <div className="secao-regua"><h3 className="secao-titulo">Metas em andamento</h3></div>
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
        <div className="secao-regua"><h3 className="secao-titulo">Próximos vencimentos</h3></div>
        {atual.proximos_vencimentos.length === 0 ? (
          <p className="sub">Nada pendente neste mês. 🎉</p>
        ) : (
          <div className="tabela-lisa">
            <table>
              <thead><tr><th>Conta</th><th>Vencimento</th><th>Valor</th><th>Status</th></tr></thead>
              <tbody>
                {atual.proximos_vencimentos.map((v) => (
                  <tr key={v.id}>
                    <td>{v.nome}</td>
                    <td>{new Date(v.vencimento + "T00:00").toLocaleDateString("pt-BR")}</td>
                    <td className="num">{v.valor_cents === null ? <span style={{ color: "var(--content-3)" }}>sem valor</span> : brl(v.valor_cents)}</td>
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
        <section className="surgir secao">
          <div className="secao-regua"><h3 className="secao-titulo">Orçamentos do mês</h3></div>
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
          <h3 className="secao-titulo">Insights de IA</h3>
          <button className="btn btn-primario" onClick={pedirInsights} disabled={iaCarregando}>
            <IcExtrair />{iaCarregando ? "Analisando…" : insights ? "Recalcular" : "Analisar mês"}
          </button>
        </div>
        {iaErro && <p className="erro">{iaErro}</p>}
        {!insights && !iaCarregando && !iaErro && (
          <p className="sub">Clique em “Analisar mês” para a IA comentar suas finanças.</p>
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
