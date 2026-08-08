import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api, brl, paraCents } from "../api";
import { BarChart, BarrasRank, BarraMes, COR_SEM_CATEGORIA, FatiaDonut, PALETA_SERIES, ROTULO_SEM_CATEGORIA, Sparkline, corDaCategoria, dobrarEmOutros, resolverCores } from "../components/graficos";
import { Fio } from "../components/Fio";
import { IcFechar } from "../components/icones";
import { useToast } from "../components/Toast";
import { useAtualizacao, useCompetencia } from "../estado";
import {
  Delta, GastoCategoriaMes, PontoHistorico,
  comparativo as calcComparativo, tendenciasPorCategoria,
} from "../historico";

type Categoria = { id: number; nome: string; tipo: string; cor: string | null; ativa: number };
type Variavel = { valor_cents: number; categoria_id: number | null; forma_pagamento: string | null };
type Orcamento = { categoria_id: number; nome: string; cor: string | null; limite_cents: number; gasto_cents: number };

const corOrcamento = (pct: number) => (pct >= 100 ? "var(--negative)" : pct >= 80 ? "var(--warning)" : "var(--positive)");

const FORMA_ROTULO: Record<string, string> = { pix: "Pix", credito: "Crédito", debito: "Débito", dinheiro: "Dinheiro", boleto: "Boleto" };

/** Forma de pagamento é um conjunto fechado, então a cor de cada uma é fixa.
 *  Com o índice da ordem de chegada, bastava um mês sem boleto para repintar
 *  todas as outras. */
const FORMA_COR: Record<string, string> = {
  pix: PALETA_SERIES[0], credito: PALETA_SERIES[1], debito: PALETA_SERIES[2],
  dinheiro: PALETA_SERIES[3], boleto: PALETA_SERIES[4],
};

/** Cartela da paleta, no lugar do <input type="color">.
 *
 *  O seletor livre deixava uma categoria de gasto se pintar do verde que
 *  significa "entrada" no resto do app, ou de um tom que ninguém com
 *  daltonismo distingue da categoria vizinha — as duas coisas que a paleta
 *  validada existe para impedir.
 *
 *  Guarda o TOKEN (`var(--chart-3)`), não o hex: o tema claro tem valores
 *  próprios, então a categoria acompanha o tema em vez de carregar para o
 *  papel um tom escolhido no preto. Cores antigas, gravadas em hex pelo
 *  seletor livre, seguem sendo respeitadas — só não são mais oferecidas. */
function Cartela({ valor, aoEscolher, rotulo }: { valor: string | null; aoEscolher: (cor: string) => void; rotulo: string }) {
  return (
    <span className="cartela" role="group" aria-label={rotulo}>
      {PALETA_SERIES.map((c, i) => (
        <button key={c} type="button" className="cartela-cor" style={{ background: c }}
          aria-label={`Cor ${i + 1}`} aria-pressed={valor === c} onClick={() => aoEscolher(c)} />
      ))}
    </span>
  );
}
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
  // Resolvido uma vez por carga e lido por todas as seções desta tela.
  const [coresCat, setCoresCat] = useState<Map<number, string>>(new Map());
  const totalCategorias = porCategoria.reduce((s, f) => s + f.valor, 0);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState("variavel");
  // null = "não escolhi", e não "a primeira da paleta".
  const [cor, setCor] = useState<string | null>(null);
  // Qual categoria está com a cartela aberta. A cartela não cabe dentro do
  // chip (seis amostras alargariam cada um em ~110px), então ela abre numa
  // linha só, abaixo da lista.
  const [editandoCor, setEditandoCor] = useState<number | null>(null);

  const [orcamentos, setOrcamentos] = useState<Orcamento[]>([]);
  const [orcCategoria, setOrcCategoria] = useState("");
  const [orcValor, setOrcValor] = useState("");

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
      const [hist, vars, cats, orcs] = await Promise.all([
        api<{ serie: PontoHistorico[]; por_categoria: GastoCategoriaMes[] }>(`/analises/historico?ate=${competencia}&meses=${periodo}`),
        api<{ itens: Variavel[] }>(`/variaveis?de=${competencia}-01&ate=${competencia}-${String(ate).padStart(2, "0")}`),
        // todas=1: os gráficos precisam resolver nome/cor de categorias já
        // desativadas — sem isso o gasto delas viraria "Sem categoria".
        api<Categoria[]>("/categorias?todas=1"),
        api<Orcamento[]>(`/orcamentos?competencia=${competencia}`).catch(() => [] as Orcamento[]),
      ]);
      if (id !== requisicao.current) return; // resposta obsoleta
      setSerie(hist.serie);
      setGastosCat(hist.por_categoria);
      setOrcamentos(orcs);
      setCategorias(cats);
      const mapaCat = new Map(cats.map((c) => [c.id, c] as const));

      const somaCat = new Map<number | null, { nome: string; valor: number }>();
      const somaForma = new Map<string, number>();
      for (const v of vars.itens) {
        const c = v.categoria_id != null ? mapaCat.get(v.categoria_id) : undefined;
        const chave = c?.id ?? null;
        const at = somaCat.get(chave) ?? { nome: c?.nome ?? ROTULO_SEM_CATEGORIA, valor: 0 };
        at.valor += v.valor_cents; somaCat.set(chave, at);
        const f = v.forma_pagamento ?? "outro";
        somaForma.set(f, (somaForma.get(f) ?? 0) + v.valor_cents);
      }

      // UM mapa de cor para a tela inteira: "Gastos por categoria" e
      // "Tendência por categoria" mostram as mesmas categorias, e resolver a
      // cor em cada seção separadamente já as fez divergir na mesma página.
      // A ordem é a de leitura — maior gasto do mês primeiro, depois as que só
      // aparecem na tendência —, então as vagas distintas vão para quem o
      // leitor vê no topo.
      const ordenadasPorGasto = [...somaCat.entries()]
        .filter(([id]) => id != null)
        .sort((a, b) => b[1].valor - a[1].valor)
        .map(([id]) => mapaCat.get(id as number)!)
        .filter(Boolean);
      const daTendencia = hist.por_categoria
        .map((t) => (t.categoria_id != null ? mapaCat.get(t.categoria_id) : undefined))
        .filter((c): c is Categoria => c != null);
      const cores = resolverCores([...ordenadasPorGasto, ...daTendencia]);
      setCoresCat(cores);

      const corDe = (id: number | null) => (id == null ? COR_SEM_CATEGORIA : cores.get(id) ?? COR_SEM_CATEGORIA);
      setPorCategoria(dobrarEmOutros([...somaCat.entries()].map(([id, x]) => ({ rotulo: x.nome, valor: x.valor, cor: corDe(id) }))));
      setPorForma([...somaForma.entries()].map(([f, valor]) => ({ rotulo: FORMA_ROTULO[f] ?? f, valor, cor: FORMA_COR[f] ?? COR_SEM_CATEGORIA })).sort((a, b) => b.valor - a.valor));
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
      // Sem escolha explícita, `cor` NÃO vai no corpo: a categoria nasce sem
      // cor e cai no slot da paleta. Mandar um padrão daqui faria toda
      // categoria criada pela tela nascer da mesma cor — que é justamente a
      // colisão de matiz que a paleta existe para evitar.
      await api("/categorias", { method: "POST", body: JSON.stringify({ nome: nome.trim(), tipo, ...(cor ? { cor } : {}) }) });
      toast("Categoria criada.");
      setNome("");
      setCor(null);
      atualizar();
    } catch (err) { toast((err as Error).message, "erro"); }
  }

  async function mudarCor(id: number, novaCor: string) {
    // Com try/catch como os irmãos daqui: a cartela fecha ao escolher, então
    // um PATCH que falha em silêncio deixaria a tela dizendo que a cor mudou.
    try {
      await api(`/categorias/${id}`, { method: "PATCH", body: JSON.stringify({ cor: novaCor }) });
      atualizar();
    } catch (err) { toast((err as Error).message, "erro"); }
  }

  async function desativar(id: number) {
    if (!confirm("Desativar esta categoria? Ela some das listas (os lançamentos existentes são mantidos).")) return;
    await api(`/categorias/${id}`, { method: "PATCH", body: JSON.stringify({ ativa: false }) });
    toast("Categoria desativada.");
    atualizar();
  }

  async function definirOrcamento(e: FormEvent) {
    e.preventDefault();
    const cents = paraCents(orcValor);
    if (!orcCategoria || !Number.isFinite(cents) || cents <= 0) {
      toast("Escolha a categoria e um limite maior que zero.", "erro");
      return;
    }
    try {
      await api(`/orcamentos/${orcCategoria}`, { method: "PUT", body: JSON.stringify({ limite_cents: cents }) });
      toast("Orçamento definido.");
      setOrcCategoria(""); setOrcValor("");
      atualizar();
    } catch (err) { toast((err as Error).message, "erro"); }
  }

  async function removerOrcamento(o: Orcamento) {
    if (!confirm(`Remover o orçamento de ${o.nome}? Os lançamentos não mudam — só o limite deixa de existir.`)) return;
    try {
      await api(`/orcamentos/${o.categoria_id}`, { method: "DELETE" });
      toast("Orçamento removido.");
      atualizar();
    } catch (err) { toast((err as Error).message, "erro"); }
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
      <p className="sub">Entradas × gastos, evolução histórica e distribuição por categoria — {mesExtenso} (troque o mês no topo).</p>

      {carregando ? (
        <div className="skeleton" style={{ height: 260 }} />
      ) : (
        <>
          <section className="ficha surgir">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
              <h3 className="secao-titulo">Entradas × Gastos</h3>
              <div className="seg" role="group" aria-label="Período do histórico">
                {PERIODOS.map((p) => (
                  <button key={p} type="button" className={periodo === p ? "btn btn-primario" : "btn"}
                    aria-pressed={periodo === p} onClick={() => setPeriodo(p)}>
                    {p} meses
                  </button>
                ))}
              </div>
            </div>
            {/* Sem legenda separada: a linha de leitura do gráfico já mostra
                ponto colorido, nome e valor do mês em foco. */}
            <BarChart dados={barras} />
          </section>

          <section className="surgir secao">
            <h3 className="secao-titulo">Mês vs mês anterior</h3>
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

          <section className="surgir secao">
            <h3 className="secao-titulo">Tendência por categoria</h3>
            <p className="sub">Gastos fixos + variáveis por mês, maiores do período primeiro. A distribuição abaixo mostra só as variáveis do mês.</p>
            {tendencias.length === 0 ? (
              <p className="sub">Sem gastos categorizáveis no período.</p>
            ) : (
              <div className="legenda" style={{ gap: "0.85rem", marginTop: "0.5rem" }}>
                {tendencias.map((t) => {
                  // Mesmo mapa da seção de gastos: é o que garante que a
                  // categoria saia da MESMA cor nas duas, o que antes não valia.
                  const cor = t.categoria_id == null ? COR_SEM_CATEGORIA : coresCat.get(t.categoria_id) ?? COR_SEM_CATEGORIA;
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
            <section className="ficha surgir">
              <h3 className="secao-titulo">Gastos por categoria</h3>
              {/* Duas perguntas, duas formas, sem repetir os mesmos números
                  duas vezes: o fio responde "que fatia do mês é isso" e o
                  ranking responde "quanto foi, e qual veio antes". Antes eram
                  um donut e um ranking dos MESMOS valores, lado a lado. */}
              {porCategoria.length > 0 && (
                <Fio pct fatias={porCategoria} rotuloAria={`Distribuição dos gastos por categoria, total ${brl(totalCategorias)}`} />
              )}
              <div style={{ marginTop: "1.1rem" }}><BarrasRank fatias={porCategoria} /></div>
            </section>
            <section className="ficha surgir">
              <h3 className="secao-titulo">Por forma de pagamento</h3>
              <BarrasRank fatias={porForma} />
            </section>
          </div>
        </>
      )}

      <section className="surgir secao">
        <h3 className="secao-titulo">Orçamentos por categoria</h3>
        <p className="sub">Limite mensal para gastos variáveis. Ao estourar, chega um aviso push (com os lembretes diários). Barras do mês selecionado.</p>
        <div className="legenda" style={{ gap: "0.8rem", margin: "0.75rem 0" }}>
          {orcamentos.length === 0 && <span className="sub">Nenhum orçamento definido ainda.</span>}
          {orcamentos.map((o) => {
            const pct = (o.gasto_cents / o.limite_cents) * 100;
            return (
              <div key={o.categoria_id}>
                <div className="item" style={{ marginBottom: "0.25rem" }}>
                  <span className="ponto" style={{ background: corOrcamento(pct) }} />
                  <span>{o.nome}</span>
                  <span className="pct num">{brl(o.gasto_cents)} de {brl(o.limite_cents)} · {Math.round(pct)}%</span>
                  <button className="anexo-remover" onClick={() => removerOrcamento(o)} aria-label={`Remover orçamento de ${o.nome}`}><IcFechar width={15} height={15} /></button>
                </div>
                <div className="progresso"><i style={{ width: `${Math.min(pct, 100)}%`, background: corOrcamento(pct) }} /></div>
              </div>
            );
          })}
        </div>
        <form onSubmit={definirOrcamento} className="linha-form">
          <select value={orcCategoria} onChange={(e) => setOrcCategoria(e.target.value)} aria-label="Categoria do orçamento" style={{ flex: "1 1 160px" }}>
            <option value="">Categoria…</option>
            {/* Desativada com orçamento continua editável: o limite dela segue
                vivo na lista e no push — sem isto dava para remover, mas não
                ajustar, sem reativar a categoria. */}
            {categorias.filter((c) => c.tipo === "variavel" && (c.ativa || orcamentos.some((o) => o.categoria_id === c.id))).map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}{!c.ativa ? " (desativada)" : orcamentos.some((o) => o.categoria_id === c.id) ? " (editar)" : ""}
              </option>
            ))}
          </select>
          <input placeholder="Limite mensal (R$)" inputMode="decimal" value={orcValor} onChange={(e) => setOrcValor(e.target.value)}
            aria-label="Limite mensal em reais" style={{ flex: "1 1 140px" }} />
          <button className="btn btn-primario" type="submit">Definir</button>
        </form>
      </section>

      <section className="surgir secao">
        <h3 className="secao-titulo">Categorias</h3>
        <p className="sub">Crie categorias para classificar seus gastos. Atribua nos gastos (aba Variáveis) ou no cadastro de transação.</p>
        {/* A lista veio com todas=1 (os gráficos precisam das desativadas);
            aqui, que é gestão, só as ativas aparecem. */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", margin: "0.75rem 0" }}>
          {categorias.filter((c) => c.ativa).length === 0 && <span className="sub">Nenhuma categoria ainda.</span>}
          {categorias.filter((c) => c.ativa).map((c) => (
            <span key={c.id} className="chip" style={{ gap: "0.5rem" }}>
              {/* A cor do chip é a mesma que os gráficos usam. Fora deles (uma
                  categoria sem gasto no mês), cai no slot determinístico. */}
              <button type="button" className="cartela-cor" style={{ background: coresCat.get(c.id) ?? corDaCategoria(c) }}
                aria-label={`Mudar a cor de ${c.nome}`} aria-expanded={editandoCor === c.id}
                onClick={() => setEditandoCor(editandoCor === c.id ? null : c.id)} />
              {c.nome}
              <span className="pct" style={{ marginLeft: 0 }}>({c.tipo})</span>
              <button className="anexo-remover" onClick={() => desativar(c.id)} aria-label={`Desativar ${c.nome}`}><IcFechar width={15} height={15} /></button>
            </span>
          ))}
        </div>
        {editandoCor != null && (
          <div className="cartela-linha">
            <span className="eyebrow">Cor de {categorias.find((c) => c.id === editandoCor)?.nome}</span>
            <Cartela rotulo="Escolha a cor da categoria"
              valor={categorias.find((c) => c.id === editandoCor)?.cor ?? null}
              aoEscolher={(novaCor) => { mudarCor(editandoCor, novaCor); setEditandoCor(null); }} />
            <button className="btn" type="button" onClick={() => setEditandoCor(null)}>Fechar</button>
          </div>
        )}
        <form onSubmit={criarCategoria} className="linha-form">
          <input placeholder="Nova categoria" value={nome} onChange={(e) => setNome(e.target.value)} style={{ flex: "1 1 160px" }} />
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo">
            <option value="variavel">Variável</option>
            <option value="fixa">Fixa</option>
            <option value="entrada">Entrada</option>
          </select>
          <Cartela valor={cor} aoEscolher={setCor} rotulo="Cor da nova categoria" />
          <button className="btn btn-primario" type="submit">Adicionar</button>
        </form>
      </section>
    </>
  );
}
