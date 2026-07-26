import { ReactNode } from "react";
import AnimatedNumber from "./AnimatedNumber";
import { Sparkline } from "./graficos";

type Props = {
  rotulo: string;
  cents: number;
  icone: ReactNode;
  cor?: string;
  /** variação percentual vs mês anterior (ex: 12.5 ou -8) */
  variacao?: number | null;
  /** "menos é melhor" (despesas) inverte a cor da variação */
  menosMelhor?: boolean;
  serie?: number[];
  atraso?: 1 | 2 | 3 | 4;
};

export default function StatCard({ rotulo, cents, icone, cor = "var(--acento)", variacao, menosMelhor, serie, atraso }: Props) {
  const bom = variacao == null ? null : menosMelhor ? variacao <= 0 : variacao >= 0;
  const corVar = bom == null ? "var(--texto-3)" : bom ? "var(--verde)" : "var(--vermelho)";
  return (
    <article className={`glass card stat surgir${atraso ? " surgir-" + atraso : ""}`}>
      <div className="topo-stat">
        <span className="icone" style={{ color: cor }}>{icone}</span>
        {variacao != null && (
          <span className="variacao" style={{ color: corVar }}>
            {variacao >= 0 ? "▲" : "▼"} {Math.abs(variacao).toFixed(1)}%
          </span>
        )}
      </div>
      <span className="rotulo">{rotulo}</span>
      <span className="valor" style={{ color: cor }}><AnimatedNumber cents={cents} /></span>
      {variacao != null && <span className="rotulo" style={{ fontSize: "0.72rem", color: "var(--texto-3)" }}>vs. mês anterior</span>}
      {serie && serie.length > 1 && <div className="spark"><Sparkline valores={serie} cor={cor} /></div>}
    </article>
  );
}
