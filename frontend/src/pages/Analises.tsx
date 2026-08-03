import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api, brl } from "../api";
import { BarChart, BarrasRank, BarraMes, COR_SEM_CATEGORIA, Donut, FatiaDonut, PALETA_SERIES, Sparkline } from "../components/graficos";
import { useToast } from "../components/Toast";
import { useAtualizacao, useCompetencia } from "../estado";
import {
  Delta, GastoCategoriaMes, PontoHistorico,
  comparativo as calcComparativo, tendenciasPorCategoria,
} from "../historico";

type Categoria = { id: number; nome: string; tipo: string; cor: string | null; ativa: number };
type Variavel = { valor_cents: number; categoria_id: number | null; forma_pagamento: string | null };

const FORMA_ROTULO: Record<string, string> = { pix: "Pix", credito: "Crédito", debito: "Débito", dinheiro: "Dinheiro", boleto: "Boleto" };
const PERIODOS = [6, 12, 24] as const;

const mesCurto = (c: string) => new Date(Number(c.slice(0, 4)), Number(c.slice(5, 7)) - 1, 1).toLocaleDateString("pt-BR", { month: "short" });

/** Linha da tabela de comparativo. `menosMelhor`: em gastos, subir é ruim —
 *  a cor segue o julgamento (bom/ruim), a seta segue a direção. */
function LinhaComparativo({ rotulo, d, menosMelhor = false }: { rotulo: string; d: Delta; menosMelhor?: boolean }) {
  const subiu = d.delta > 0;
  const bom = menosMelhor ? !subiu : subiu;
  return (
    <tr>
      <td>{rotulo}</td>
      <td className="num" style={{ color: "var(--content-2)", fontVariantNumeric: "tabular-nums" }}>{brl(d.anterior)}</td>
      <td className="num" style={{ fontVariantNumeric: "tabular-nums" }}>{brl(d.atual)}</td>
      <td style={{ fontVariantNumeric: "tabular-nums" }}>
        {d.delta === 0 ? (
          <span className="pct">sem variação</span>
        ) : (
          <span style={{ color: bom ? "var(--positive)" : "var(--negative)" }}>
            {subiu ? "▲" : "▼"} {brl(Math.abs(d.delta))}
            {d.pct != null && <span className="pct" style={{ marginLeft: "0.35rem" }}>{d.pct > 0 ? "+" : ""}{d.pct}%</span>}
          </span>
        )}
      </td>
    </tr>
  );
}

export default function Analises() {
  const toast = useToast();
  const { competencia } = useCompetencia();
  const { versao, atualizar } = useAtualizacao();

  const [periodo, setPeriodo] = useState<(typeof PERIODOS)[number]>(12);
  const [serie, setSerie] = useState<PontoHistorico[]>([]);
  const [gastosCat, setGastosCat] = useState<GastoCategoriaMes[]>([]);
  const [porCategoria, setPorCategoria] = useState<FatiaDonut[]>([]);
  const [porForma, setPorForma] = useState<FatiaDonut[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState("variavel");
  const [cor, setCor] = useState("#60a5fa");

  // Trocar período/competência com resposta anterior ainda em voo: a última
  // requisição disparada é a única que pode escrever no estado — sem isto, a
  // resposta lenta de "24 meses" sobrescreveria a tela já em "6 meses".
  const requisicao = useRef(0);

  const carregar = useCallback(async () => {
    const id = ++requisicao.current;
    setCarregando(true);
    setErro(null);
    try {
      const ate = new Date(Number(competencia.slice(0, 4)), Number(competencia.slice(5)), 0).getDate();
      const [hist, vars, cats] = await Promise.all([
        api<{ serie: PontoHistorico[]; por_categoria: GastoCategoriaMes[] }>(`/analises/historico?ate=${competencia}&meses=${periodo}`),
        api<{ itens: Variavel[] }>(`/variaveis?de=${competencia}-01&ate=${competencia}-${String(ate).padStart(2, "0")}`),
        // todas=1: os gráficos precisam resolver nome/cor de categorias já
        // desativadas — sem isso o gasto delas viraria "Sem categoria".
        api<Categoria[]>("/categorias?todas=1"),
      ]);
      if (id !== requisicao.current) return; // resposta obsoleta
      setSerie(hist.serie);
      setGastosCat(hist.por_categoria);
      setCategorias(cats);
      const mapaCat = new Map(cats.map((c) => [c.id, c] as const));

      const somaCat = new Map<string, { valor: number; cor: string }>();
      const somaForma = new Map<string, number>();
      let i = 0;
      for (const v of vars.itens) {
        const c = v.categoria_id != null ? mapaCat.get(v.categoria_id) : undefined;
        const nomeCat = c?.nome ?? "Sem categoria";
        const corCat = nomeCat === "Sem categoria" ? COR_SEM_CATEGORIA : (c?.cor ?? PALETA_SERIES[i++ % PALETA_SERIES.length]);
        const at = somaCat.get(nomeCat) ?? { valor: 0, cor: corCat };
        at.valor += v.valor_cents; somaCat.set(nomeCat, at);
        const f = v.forma_pagamento ?? "outro";
        somaForma.set(f, (somaForma.get(f) ?? 0) + v.valor_cents);
      }
      setPorCategoria([...somaCat.entries()].map(([rotulo, x]) => ({ rotulo, valor: x.valor, cor: x.cor })).sort((a, b) => b.valor - a.valor));
      setPorForma([...somaForma.entries()].map(([f, valor], j) => ({ rotulo: FORMA_ROTULO[f] ?? f, valor, cor: PALETA_SERIES[j % PALETA_SERIES.length] })).sort((a, b) => b.valor - a.valor));
    } catch (e) {
      if (id === requisicao.current) setErro((e as Error).message);
    } finally {
      if (id === requisicao.current) setCarregando(false);
    }
  }, [competencia, periodo, versao]);

  useEffect(() => { carregar(); }, [carregar]);

  async function criarCategoria(e: FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return;
    try {
      await api("/categorias", { method: "POST", body: JSON.stringify({ nome: nome.trim(), tipo, cor }) });
      toast("Categoria criada.");
      setNome("");
      atualizar();
    } catch (err) { toast((err as Error).message, "erro"); }
  }

  async function mudarCor(id: number, novaCor: string) {
    await api(`/categorias/${id}`, { method: "PATCH", body: JSON.stringify({ cor: novaCor }) });
    atualizar();
  }

  async function desativar(id: number) {
    if (!confirm("Desativar esta categoria? Ela some das listas (os lançamentos existentes são mantidos).")) return;
    await api(`/categorias/${id}`, { method: "PATCH", body: JSON.stringify({ ativa: false }) });
    toast("Categoria desativada.");
    atualizar();
  }

  const mesExtenso = new Date(Number(competencia.slice(0, 4)), Number(competencia.slice(5)) - 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  if (erro) return <p className="erro">{erro}</p>;

  // Série cruzando a virada do ano: "jan." sozinho não diz de qual ano é —
  // e com 24 meses cada nome de mês aparece duas vezes.
  const multiAno = new Set(serie.map((p) => p.competencia.slice(0, 4))).size > 1;
  const rotuloMes = (c: string) => (multiAno ? `${mesCurto(c)} ${c.slice(2, 4)}` : mesCurto(c));

  const barras: BarraMes[] = serie.map((p) => ({ rotulo: rotuloMes(p.competencia), entradas: p.entradas_cents, gastos: p.fixas_cents + p.variaveis_cents }));
  const comp = calcComparativo(serie, competencia);
  const tendencias = tendenciasPorCategoria(serie.map((p) => p.competencia), gastosCat);

  return (
    <>
      <h2>Análises</h2>
      <p className="sub">Entradas × gastos, evolução histórica e distribuição por categoria — {mesExtenso} (troque o mês no topo).</p>

      {carregando ? (
        <div className="skeleton" style={{ height: 260 }} />
      ) : (
        <>
          <section className="card surgir">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
              <h3>Entradas × Gastos</h3>
              <div className="seg" role="group" aria-label="Período do histórico">
                {PERIODOS.map((p) => (
                  <button key={p} type="button" className={periodo === p ? "btn btn-primario" : "btn"}
                    aria-pressed={periodo === p} onClick={() => setPeriodo(p)}>
                    {p} meses
                  </button>
                ))}
              </div>
            </div>
            <BarChart dados={barras} />
            <div className="legenda" style={{ flexDirection: "row", gap: "1rem", marginTop: "0.5rem" }}>
              <span className="item"><span className="ponto" style={{ background: "var(--positive)" }} />Entradas</span>
              <span className="item"><span className="ponto" style={{ background: "var(--negative)" }} />Gastos</span>
            </div>
          </section>

          <section className="card surgir secao">
            <h3>Mês vs mês anterior</h3>
            {comp ? (
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th />
                      <th className="num">{rotuloMes(comp.anterior)}</th>
                      <th className="num">{rotuloMes(competencia)}</th>
                      <th>Variação</th>
                    </tr>
                  </thead>
                  <tbody>
                    <LinhaComparativo rotulo="Entradas" d={comp.entradas} />
                    <LinhaComparativo rotulo="Gastos fixos" d={comp.fixas} menosMelhor />
                    <LinhaComparativo rotulo="Gastos variáveis" d={comp.variaveis} menosMelhor />
                    <LinhaComparativo rotulo="Saldo" d={comp.saldo} />
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="sub">O primeiro mês do período não tem mês anterior para comparar — amplie o período acima.</p>
            )}
          </section>

          <section className="card surgir secao">
            <h3>Tendência por categoria</h3>
            <p className="sub">Gastos fixos + variáveis por mês, maiores do período primeiro. O donut abaixo mostra só as variáveis do mês.</p>
            {tendencias.length === 0 ? (
              <p className="sub">Sem gastos categorizáveis no período.</p>
            ) : (
              <div className="legenda" style={{ gap: "0.85rem", marginTop: "0.5rem" }}>
                {tendencias.map((t, i) => {
                  const cor = t.nome == null ? COR_SEM_CATEGORIA : t.cor ?? PALETA_SERIES[i % PALETA_SERIES.length];
                  const vAtual = t.valores[t.valores.length - 1];
                  const vAnterior = t.valores[t.valores.length - 2] ?? 0;
                  return (
                    <div key={t.categoria_id ?? "sem"} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 1fr) 2fr auto", gap: "0.75rem", alignItems: "center" }}>
                      <span className="item" style={{ minWidth: 0 }}>
                        <span className="ponto" style={{ background: cor }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.nome ?? "Sem categoria"}</span>
                      </span>
                      <Sparkline valores={t.valores} cor={cor} />
                      <span className="pct num" title={`${brl(vAnterior)} no mês anterior`}>
                        {brl(vAtual)}{vAtual !== vAnterior && (vAtual > vAnterior ? " ▲" : " ▼")}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <div className="grid-2 secao">
            <section className="card surgir">
              <h3>Gastos por categoria</h3>
              <Donut fatias={porCategoria} />
              <div style={{ marginTop: "1rem" }}><BarrasRank fatias={porCategoria} /></div>
            </section>
            <section className="card surgir">
              <h3>Por forma de pagamento</h3>
              <BarrasRank fatias={porForma} />
            </section>
          </div>
        </>
      )}

      <section className="card surgir secao">
        <h3>Categorias</h3>
        <p className="sub">Crie categorias para classificar seus gastos. Atribua nos gastos (aba Variáveis) ou no cadastro de transação.</p>
        {/* A lista veio com todas=1 (os gráficos precisam das desativadas);
            aqui, que é gestão, só as ativas aparecem. */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", margin: "0.75rem 0" }}>
          {categorias.filter((c) => c.ativa).length === 0 && <span className="sub">Nenhuma categoria ainda.</span>}
          {categorias.filter((c) => c.ativa).map((c) => (
            <span key={c.id} className="chip" style={{ gap: "0.5rem" }}>
              <input type="color" value={c.cor ?? "#60a5fa"} onChange={(e) => mudarCor(c.id, e.target.value)}
                aria-label={`Cor de ${c.nome}`} style={{ width: 20, height: 20, padding: 0, border: "none", background: "none", borderRadius: 6 }} />
              {c.nome}
              <span className="pct" style={{ marginLeft: 0 }}>({c.tipo})</span>
              <button className="anexo-remover" onClick={() => desativar(c.id)} aria-label={`Desativar ${c.nome}`}>×</button>
            </span>
          ))}
        </div>
        <form onSubmit={criarCategoria} className="linha-form">
          <input placeholder="Nova categoria" value={nome} onChange={(e) => setNome(e.target.value)} style={{ flex: "1 1 160px" }} />
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo">
            <option value="variavel">Variável</option>
            <option value="fixa">Fixa</option>
            <option value="entrada">Entrada</option>
          </select>
          <input type="color" value={cor} onChange={(e) => setCor(e.target.value)} aria-label="Cor" style={{ width: 44, padding: 4 }} />
          <button className="btn btn-primario" type="submit">Adicionar</button>
        </form>
      </section>
    </>
  );
}
