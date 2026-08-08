import { useId, useState } from "react";
import { brl } from "../api";

/** Paleta categórica — os valores moram nos tokens --chart-* do app.css, que é
 *  onde estão os comentários sobre o que ela precisa cumprir. Ao mexer nas
 *  cores, revalidar com o validador do dataviz nos DOIS temas; a paleta
 *  anterior trazia um comentário dizendo-se validada e reprovava em três das
 *  cinco checagens. */
export const PALETA_SERIES = [
  "var(--chart-1)", "var(--chart-2)", "var(--chart-3)",
  "var(--chart-4)", "var(--chart-5)", "var(--chart-6)",
];
export const COR_SEM_CATEGORIA = "var(--chart-neutral)";
export const ROTULO_SEM_CATEGORIA = "Sem categoria";

/** Rótulo dentro do SVG. O cabeçalho do app.css manda "JetBrains Mono em todo
 *  número, rótulo e título de seção", e os gráficos eram o único lugar do app
 *  que ainda desenhava texto em sans. */
const TEXTO_EIXO = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" } as const;

/** Cor de uma categoria. Depende só da identidade dela — nunca da posição na
 *  lista, nem do período em tela.
 *
 *  Cada tela sorteava por um índice próprio, e o índice significava coisas
 *  diferentes em cada uma: em Análises ele andava por LANÇAMENTO (a cor saía de
 *  quantas transações vieram antes), no Dashboard pela POSIÇÃO no ranking do
 *  mês. Dava para ver a mesma categoria em duas cores na mesma tela, e trocar
 *  de mês repintava todas — desfazendo o "Mercado é o azul" que o leitor tinha
 *  acabado de aprender. */
export function corDaCategoria(cat: { id: number; cor?: string | null } | null | undefined): string {
  if (cat == null) return COR_SEM_CATEGORIA;
  if (cat.cor) return cat.cor;
  // ids são sequenciais, então o resto já distribui bem pelas seis vagas.
  return PALETA_SERIES[Math.abs(cat.id) % PALETA_SERIES.length];
}

/** Dobra a cauda em "Outros" para nunca reciclar matiz: repetir uma cor na
 *  sétima categoria é dizer que ela é a mesma coisa que a primeira.
 *
 *  Também substitui o `slice(0, 5)` que o Dashboard fazia, e que era pior que
 *  isto: ele escondia a cauda sem somá-la em lugar nenhum, então as
 *  porcentagens exibidas não fechavam com o total ao lado. */
export function dobrarEmOutros(fatias: FatiaDonut[], limite = PALETA_SERIES.length): FatiaDonut[] {
  const ordenadas = [...fatias].sort((a, b) => b.valor - a.valor);
  if (ordenadas.length <= limite) return ordenadas;
  // "Sem categoria" desce junto com a cauda: ele e "Outros" já significam ambos
  // "aqui não há identidade", e manter os dois poria dois cinzas na legenda.
  const nomeadas = ordenadas.filter((f) => f.rotulo !== ROTULO_SEM_CATEGORIA);
  const anonimas = ordenadas.filter((f) => f.rotulo === ROTULO_SEM_CATEGORIA);
  const topo = nomeadas.slice(0, limite - 1);
  const resto = [...nomeadas.slice(limite - 1), ...anonimas].reduce((s, f) => s + f.valor, 0);
  return resto > 0 ? [...topo, { rotulo: "Outros", valor: resto, cor: COR_SEM_CATEGORIA }] : topo;
}

/** Sparkline minimalista (linha) sobre uma série de valores. */
export function Sparkline({ valores, cor = "var(--accent)", altura = 34 }: { valores: number[]; cor?: string; altura?: number }) {
  const larg = 100;
  if (valores.length < 2) return <svg width="100%" height={altura} aria-hidden="true" />;
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const span = max - min || 1;
  const pts = valores.map((v, i) => {
    const x = (i / (valores.length - 1)) * larg;
    const y = altura - ((v - min) / span) * (altura - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const id = useId();
  return (
    <svg width="100%" height={altura} viewBox={`0 0 ${larg} ${altura}`} preserveAspectRatio="none" aria-hidden="true" className="spark">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={cor} stopOpacity="0.28" />
          <stop offset="100%" stopColor={cor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={`0,${altura} ${pts.join(" ")} ${larg},${altura}`} fill={`url(#${id})`} stroke="none" />
      <polyline points={pts.join(" ")} fill="none" stroke={cor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export type SerieMes = { rotulo: string; entradas: number; despesas: number; saldo: number };

/** Gráfico de fluxo (área/linha) com receitas, despesas e saldo acumulado. */
export function AreaChart({ dados, modo = "area" }: { dados: SerieMes[]; modo?: "area" | "linha" }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 240, padY = 18, padX = 8;
  if (dados.length < 2) return <p className="sub">Poucos dados para o gráfico.</p>;

  const todos = dados.flatMap((d) => [d.entradas, d.despesas, d.saldo]);
  const min = Math.min(0, ...todos);
  const max = Math.max(...todos, 1);
  const span = max - min || 1;
  const x = (i: number) => padX + (i / (dados.length - 1)) * (W - padX * 2);
  const y = (v: number) => H - padY - ((v - min) / span) * (H - padY * 2);

  const serie = (sel: (d: SerieMes) => number) => dados.map((d, i) => `${x(i).toFixed(1)},${y(sel(d)).toFixed(1)}`).join(" ");
  const linhas: [string, string, (d: SerieMes) => number][] = [
    ["Receitas", "var(--positive)", (d) => d.entradas],
    ["Despesas", "var(--negative)", (d) => d.despesas],
    ["Saldo", "var(--accent)", (d) => d.saldo],
  ];
  const idFill = useId();

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img"
        aria-label="Gráfico de receitas, despesas e saldo por mês"
        onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={idFill} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.14" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Sólida: tracejado lê como "projeção" ou "limiar", e isto é só o zero. */}
        <line x1={padX} y1={y(0)} x2={W - padX} y2={y(0)} stroke="var(--edge)" />
        {modo === "area" && (
          <polygon points={`${x(0)},${y(0)} ${serie((d) => d.saldo)} ${x(dados.length - 1)},${y(0)}`} fill={`url(#${idFill})`} />
        )}
        {linhas.map(([, cor, sel]) => (
          <polyline key={cor} points={serie(sel)} fill="none" stroke={cor} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {dados.map((d, i) => (
          <g key={i}>
            {hover === i && <line x1={x(i)} y1={padY} x2={x(i)} y2={H - padY} stroke="var(--edge-strong)" />}
            {linhas.map(([, cor, sel]) => hover === i && <circle key={cor} cx={x(i)} cy={y(sel(d))} r="3.2" fill={cor} />)}
            <rect x={x(i) - (W / dados.length) / 2} y="0" width={W / dados.length} height={H} fill="transparent"
              onMouseEnter={() => setHover(i)} />
            <text x={x(i)} y={H - 3} textAnchor="middle" fontSize="10" fill="var(--content-3)" style={TEXTO_EIXO}>{d.rotulo}</text>
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div className="pop" style={{ position: "absolute", top: 6, left: 8, padding: "0.5rem 0.7rem", fontSize: "0.78rem", pointerEvents: "none" }}>
          <strong>{dados[hover].rotulo}</strong>
          <div style={{ color: "var(--positive)" }}>Receitas {brl(dados[hover].entradas)}</div>
          <div style={{ color: "var(--negative)" }}>Despesas {brl(dados[hover].despesas)}</div>
          <div style={{ color: "var(--accent)" }}>Saldo {brl(dados[hover].saldo)}</div>
        </div>
      )}
    </div>
  );
}

export type BarraMes = { rotulo: string; entradas: number; gastos: number };

/** Barras agrupadas: entradas (verde) × gastos (vermelho) por mês. */
export function BarChart({ dados }: { dados: BarraMes[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 240, padY = 22, padX = 12;
  if (dados.length === 0) return <p className="sub">Sem dados no período.</p>;
  const max = Math.max(...dados.flatMap((d) => [d.entradas, d.gastos]), 1);
  const y = (v: number) => H - padY - (v / max) * (H - padY * 2);
  const grupoW = (W - padX * 2) / dados.length;
  const barW = Math.min(22, grupoW / 3);

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Entradas e gastos por mês" onMouseLeave={() => setHover(null)}>
        <line x1={padX} y1={y(0)} x2={W - padX} y2={y(0)} stroke="var(--edge)" />
        {dados.map((d, i) => {
          const cx = padX + grupoW * i + grupoW / 2;
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={cx - barW - 2} y={y(d.entradas)} width={barW} height={y(0) - y(d.entradas)} rx="4" fill="var(--positive)" opacity={hover === null || hover === i ? 1 : 0.5} />
              <rect x={cx + 2} y={y(d.gastos)} width={barW} height={y(0) - y(d.gastos)} rx="4" fill="var(--negative)" opacity={hover === null || hover === i ? 1 : 0.5} />
              {/* Série longa: rótulo mês sim, mês não — ancorado no último, que
                  é o mês selecionado e não pode ficar sem nome. */}
              {(dados.length <= 12 || (dados.length - 1 - i) % 2 === 0) && (
                <text x={cx} y={H - 5} textAnchor="middle" fontSize="10" fill="var(--content-3)" style={TEXTO_EIXO}>{d.rotulo}</text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="pop" style={{ position: "absolute", top: 6, left: 8, padding: "0.5rem 0.7rem", fontSize: "0.78rem", pointerEvents: "none" }}>
          <strong>{dados[hover].rotulo}</strong>
          <div style={{ color: "var(--positive)" }}>Entradas {brl(dados[hover].entradas)}</div>
          <div style={{ color: "var(--negative)" }}>Gastos {brl(dados[hover].gastos)}</div>
        </div>
      )}
    </div>
  );
}

export type FatiaDonut = { rotulo: string; valor: number; cor: string };

/** Lista de barras horizontais ranqueadas (ex.: gastos por categoria). */
/** Ranking horizontal por valor. Com `total`, mostra também a fatia em % —
 *  é o que o redesign pede em "onde foi o variável". */
export function BarrasRank({ fatias, total }: { fatias: FatiaDonut[]; total?: number }) {
  const max = Math.max(...fatias.map((f) => f.valor), 1);
  if (fatias.length === 0) return <p className="sub">Sem dados.</p>;
  return (
    <div className="legenda" style={{ gap: "0.7rem" }}>
      {fatias.map((f) => (
        <div key={f.rotulo}>
          {/* min-width:0 no nome: categoria é texto do usuário, e sem isto um
              nome longo empurra o valor para fora do card em vez de encolher. */}
          <div className="item" style={{ marginBottom: "0.25rem", minWidth: 0 }}>
            <span className="ponto" style={{ background: f.cor }} />
            <span className="rank-nome">{f.rotulo}</span>
            <span className="pct num">
              {brl(f.valor)}
              {total ? <span className="rank-pct"> · {Math.round((f.valor / Math.max(total, 1)) * 100)}%</span> : null}
            </span>
          </div>
          <div className="progresso"><i style={{ width: `${(f.valor / max) * 100}%`, background: f.cor }} /></div>
        </div>
      ))}
    </div>
  );
}

/** Donut de distribuição por categoria: fatias com folga + cantos arredondados,
 *  hover interativo (fatia ↔ legenda) e centro dinâmico. */
export function Donut({ fatias }: { fatias: FatiaDonut[] }) {
  const [ativo, setAtivo] = useState<number | null>(null);
  const total = fatias.reduce((s, f) => s + f.valor, 0);
  if (total === 0) return <p className="sub">Sem gastos no período.</p>;

  const CX = 60, rMid = 46, W = 15, Whover = 19;
  const C = 2 * Math.PI * rMid;
  const gap = 2.5;                    // folga (px de arco) entre fatias
  let acc = 0;
  const segs = fatias.map((f, i) => {
    const frac = f.valor / total;
    const arco = frac * C;
    const visivel = Math.max(arco - gap, arco > gap ? arco - gap : arco * 0.6);
    const seg = { f, i, frac, offset: -acc * C, dash: `${visivel.toFixed(2)} ${(C - visivel).toFixed(2)}` };
    acc += frac;
    return seg;
  });

  const foco = ativo != null ? fatias[ativo] : null;
  const pct = (v: number) => Math.round((v / total) * 100);

  return (
    <div style={{ display: "flex", gap: "1.25rem", alignItems: "center", flexWrap: "wrap" }}>
      <svg width="150" height="150" viewBox="0 0 120 120" role="img"
        aria-label={`Distribuição de despesas por categoria, total ${brl(total)}`}
        onMouseLeave={() => setAtivo(null)}>
        <title>Distribuição de despesas por categoria</title>
        <g transform="rotate(-90 60 60)">
          {segs.map((s) => (
            <circle key={s.f.rotulo} cx={CX} cy={CX} r={rMid} fill="none"
              stroke={s.f.cor} strokeLinecap="round"
              strokeWidth={ativo === s.i ? Whover : W}
              strokeDasharray={s.dash} strokeDashoffset={s.offset.toFixed(2)}
              opacity={ativo == null || ativo === s.i ? 1 : 0.38}
              style={{ transition: "stroke-width var(--dur) var(--ease), opacity var(--dur) var(--ease)", cursor: "pointer" }}
              onMouseEnter={() => setAtivo(s.i)}>
              <title>{s.f.rotulo}: {brl(s.f.valor)} ({pct(s.f.valor)}%)</title>
            </circle>
          ))}
        </g>
        <text x="60" y="55" textAnchor="middle" fontSize="8.5" fill="var(--content-3)" style={TEXTO_EIXO}>
          {foco ? foco.rotulo : "Total"}
        </text>
        <text x="60" y="68" textAnchor="middle" fontSize="12" fill="var(--content)" style={TEXTO_EIXO} fontWeight="700">
          {brl(foco ? foco.valor : total)}
        </text>
        {foco && (
          <text x="60" y="79" textAnchor="middle" fontSize="8.5" fill="var(--content-3)" style={TEXTO_EIXO}>
            {pct(foco.valor)}% do total
          </text>
        )}
      </svg>
      <ul className="legenda" style={{ flex: 1, minWidth: 170, listStyle: "none", margin: 0, padding: 0 }}>
        {fatias.map((f, i) => (
          <li key={f.rotulo}>
            <button type="button" className="item legenda-item" aria-pressed={ativo === i}
              onMouseEnter={() => setAtivo(i)} onFocus={() => setAtivo(i)} onBlur={() => setAtivo(null)}
              style={{ opacity: ativo == null || ativo === i ? 1 : 0.5 }}>
              <span className="ponto" style={{ background: f.cor }} />
              <span>{f.rotulo}</span>
              <span className="pct">{pct(f.valor)}% · {brl(f.valor)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Anel de progresso para metas. */
export function ProgressRing({ pct, cor = "var(--positive)", tamanho = 72 }: { pct: number; cor?: string; tamanho?: number }) {
  const r = 30, C = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, pct / 100));
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 72 72" role="img" aria-label={`${Math.round(pct)}% concluído`}>
      <circle cx="36" cy="36" r={r} fill="none" stroke="var(--surface-hover)" strokeWidth="7" />
      <circle cx="36" cy="36" r={r} fill="none" stroke={cor} strokeWidth="7" strokeLinecap="round"
        strokeDasharray={C} strokeDashoffset={(C * (1 - p)).toFixed(1)} transform="rotate(-90 36 36)"
        style={{ transition: "stroke-dashoffset 400ms var(--ease)" }} />
      <text x="36" y="40" textAnchor="middle" fontSize="15" fill="var(--content)" style={TEXTO_EIXO} fontWeight="600">{Math.round(pct)}%</text>
    </svg>
  );
}
