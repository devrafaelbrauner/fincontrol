import { useId, useState } from "react";
import { brl } from "../api";

/** Sparkline minimalista (linha) sobre uma série de valores. */
export function Sparkline({ valores, cor = "var(--acento)", altura = 34 }: { valores: number[]; cor?: string; altura?: number }) {
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
    ["Receitas", "var(--verde)", (d) => d.entradas],
    ["Despesas", "var(--vermelho)", (d) => d.despesas],
    ["Saldo", "var(--azul)", (d) => d.saldo],
  ];
  const idFill = useId();

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img"
        aria-label="Gráfico de receitas, despesas e saldo por mês"
        onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={idFill} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--azul)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--azul)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={padX} y1={y(0)} x2={W - padX} y2={y(0)} stroke="var(--vidro-borda)" strokeDasharray="3 4" />
        {modo === "area" && (
          <polygon points={`${x(0)},${y(0)} ${serie((d) => d.saldo)} ${x(dados.length - 1)},${y(0)}`} fill={`url(#${idFill})`} />
        )}
        {linhas.map(([, cor, sel]) => (
          <polyline key={cor} points={serie(sel)} fill="none" stroke={cor} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {dados.map((d, i) => (
          <g key={i}>
            {hover === i && <line x1={x(i)} y1={padY} x2={x(i)} y2={H - padY} stroke="var(--vidro-borda-forte)" />}
            {linhas.map(([, cor, sel]) => hover === i && <circle key={cor} cx={x(i)} cy={y(sel(d))} r="3.2" fill={cor} />)}
            <rect x={x(i) - (W / dados.length) / 2} y="0" width={W / dados.length} height={H} fill="transparent"
              onMouseEnter={() => setHover(i)} />
            <text x={x(i)} y={H - 3} textAnchor="middle" fontSize="10" fill="var(--texto-3)" fontFamily="system-ui">{d.rotulo}</text>
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div className="glass glass-forte" style={{ position: "absolute", top: 6, left: 8, padding: "0.5rem 0.7rem", fontFamily: "system-ui", fontSize: "0.78rem", pointerEvents: "none" }}>
          <strong>{dados[hover].rotulo}</strong>
          <div style={{ color: "var(--verde)" }}>Receitas {brl(dados[hover].entradas)}</div>
          <div style={{ color: "var(--vermelho)" }}>Despesas {brl(dados[hover].despesas)}</div>
          <div style={{ color: "var(--azul)" }}>Saldo {brl(dados[hover].saldo)}</div>
        </div>
      )}
    </div>
  );
}

export type FatiaDonut = { rotulo: string; valor: number; cor: string };

/** Donut de distribuição por categoria + legenda com percentual e valor. */
export function Donut({ fatias }: { fatias: FatiaDonut[] }) {
  const total = fatias.reduce((s, f) => s + f.valor, 0);
  const R = 52, r = 34, C = 60;
  if (total === 0) return <p className="sub">Sem gastos no período.</p>;
  let acc = 0;
  const circ = 2 * Math.PI * ((R + r) / 2);
  const largura = R - r;
  return (
    <div style={{ display: "flex", gap: "1.25rem", alignItems: "center", flexWrap: "wrap" }}>
      <svg width="140" height="140" viewBox="0 0 120 120" role="img" aria-label="Distribuição de despesas por categoria">
        <g transform="rotate(-90 60 60)">
          {fatias.map((f) => {
            const frac = f.valor / total;
            const dash = `${(frac * circ).toFixed(2)} ${circ.toFixed(2)}`;
            const el = (
              <circle key={f.rotulo} cx={C} cy={C} r={(R + r) / 2} fill="none" stroke={f.cor}
                strokeWidth={largura} strokeDasharray={dash} strokeDashoffset={(-acc * circ).toFixed(2)} />
            );
            acc += frac;
            return el;
          })}
        </g>
        <text x="60" y="57" textAnchor="middle" fontSize="9" fill="var(--texto-3)" fontFamily="system-ui">Total</text>
        <text x="60" y="70" textAnchor="middle" fontSize="11" fill="var(--texto)" fontFamily="system-ui" fontWeight="600">{brl(total)}</text>
      </svg>
      <div className="legenda" style={{ flex: 1, minWidth: 160 }}>
        {fatias.map((f) => (
          <div className="item" key={f.rotulo}>
            <span className="ponto" style={{ background: f.cor }} />
            <span>{f.rotulo}</span>
            <span className="pct">{Math.round((f.valor / total) * 100)}% · {brl(f.valor)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Anel de progresso para metas. */
export function ProgressRing({ pct, cor = "var(--verde)", tamanho = 72 }: { pct: number; cor?: string; tamanho?: number }) {
  const r = 30, C = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, pct / 100));
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 72 72" role="img" aria-label={`${Math.round(pct)}% concluído`}>
      <circle cx="36" cy="36" r={r} fill="none" stroke="var(--vidro-forte)" strokeWidth="7" />
      <circle cx="36" cy="36" r={r} fill="none" stroke={cor} strokeWidth="7" strokeLinecap="round"
        strokeDasharray={C} strokeDashoffset={(C * (1 - p)).toFixed(1)} transform="rotate(-90 36 36)"
        style={{ transition: "stroke-dashoffset var(--dur-lento) var(--ease)" }} />
      <text x="36" y="40" textAnchor="middle" fontSize="15" fill="var(--texto)" fontFamily="system-ui" fontWeight="600">{Math.round(pct)}%</text>
    </svg>
  );
}
