import { brl } from "../api";

export type FatiaFio = { rotulo: string; valor: number; cor: string };

/** O fio: barra segmentada de parte-todo.
 *
 *  É a gramática que este app já tinha inventado para "quanto do que entrou
 *  virou o quê", na Visão geral, e que vivia presa lá dentro. Aqui ela sai de
 *  `Dashboard.tsx` e vira o jeito do app inteiro responder parte-todo — em
 *  Análises, no lugar do donut.
 *
 *  A troca não é de gosto: o comentário da própria Visão geral já dizia que
 *  "comparar arcos é mais difícil que comparar comprimentos", e mesmo assim
 *  Análises desenhava um donut E um ranking dos MESMOS números, lado a lado.
 *
 *  `base` normaliza por algo maior que a soma das fatias — é como a Visão geral
 *  mostra que as despesas não consumiram tudo que entrou. Sem ela, as fatias
 *  são o todo.
 *
 *  Uma fatia de valor negativo aparece na legenda mas não na barra: é o caso do
 *  mês que fechou no vermelho, onde não há o que desenhar como pedaço. */
export function Fio({ fatias, base, rotuloAria, pct = false }: {
  fatias: FatiaFio[];
  base?: number;
  rotuloAria: string;
  pct?: boolean;
}) {
  const soma = fatias.reduce((s, f) => s + Math.max(f.valor, 0), 0);
  const total = Math.max(base ?? soma, 1);
  const largura = (v: number) => `${((v / total) * 100).toFixed(2)}%`;
  const parte = (v: number) => Math.round((v / Math.max(soma, 1)) * 100);

  return (
    <div className="fio">
      <div className="fio-barra" role="img" aria-label={rotuloAria}>
        {fatias.filter((f) => f.valor > 0).map((f) => (
          <span key={f.rotulo} className="fio-seg" style={{ width: largura(f.valor), background: f.cor }} />
        ))}
      </div>
      <div className="fio-legenda">
        {fatias.map((f) => (
          <span key={f.rotulo}>
            <i style={{ background: f.cor }} />
            {/* Módulo: o rótulo já diz o sinal ("Excedente"), e "Excedente
                -R$ 500,00" seria a mesma informação dita duas vezes, uma
                delas de cabeça para baixo. */}
            {f.rotulo} <b className="num">{pct ? `${parte(f.valor)}%` : brl(Math.abs(f.valor))}</b>
          </span>
        ))}
      </div>
    </div>
  );
}
