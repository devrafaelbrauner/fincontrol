import { brl } from "../api";

/** Valor dominante de uma tela, com os centavos menores e apagados.
 *
 *  É o que deixa o número legível de longe sem a vírgula roubar atenção — e
 *  vale para as três telas que têm um número dominante (Visão geral, Variáveis,
 *  Entradas), por isso mora aqui e não dentro de uma delas.
 *
 *  O `white-space: nowrap` que o acompanha (em `.hero-valor`) não é enfeite: a
 *  JetBrains Mono quebra o "R$" numa linha e o valor na seguinte sem ele.
 */
export default function ValorHero({ cents }: { cents: number }) {
  const texto = brl(cents);
  const i = texto.lastIndexOf(",");
  if (i === -1) return <>{texto}</>;
  return <>{texto.slice(0, i)}<span className="hero-cents">{texto.slice(i)}</span></>;
}
