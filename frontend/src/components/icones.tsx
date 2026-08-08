/** Ícones SVG inline (traço), sem dependência. `aria-hidden` por padrão. */
import { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { titulo?: string };

function base(d: React.ReactNode) {
  return function Icone({ titulo, ...props }: P) {
    return (
      <svg
        width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
        aria-hidden={titulo ? undefined : true} role={titulo ? "img" : undefined}
        {...props}
      >
        {titulo && <title>{titulo}</title>}
        {d}
      </svg>
    );
  };
}

export const IcVisao = base(<><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>);
export const IcFixas = base(<><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></>);
export const IcVariaveis = base(<><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></>);
export const IcEntradas = base(<><path d="M12 20V6M6 12l6-6 6 6" /></>);
export const IcMetas = base(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>);
export const IcCompromissos = base(<><path d="M9 3h6a1 1 0 0 1 1 1v2H8V4a1 1 0 0 1 1-1z" /><rect x="4" y="6" width="16" height="15" rx="2" /><path d="M9 13h6M9 17h4" /></>);
export const IcRecursos = base(<><path d="M3 9l9-5 9 5" /><path d="M5 9v9M9.5 9v9M14.5 9v9M19 9v9" /><path d="M3 21h18" /></>);
export const IcCalendario = base(<><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /><path d="M8 14h.01M12 14h.01M16 14h.01" /></>);
export const IcConfig = base(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H4a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></>);
export const IcSino = base(<><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>);
export const IcMais = base(<><path d="M12 5v14M5 12h14" /></>);
export const IcSol = base(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>);
export const IcLua = base(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />);
export const IcSair = base(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></>);
export const IcBusca = base(<><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></>);
export const IcRecolher = base(<path d="M15 6l-6 6 6 6" />);
export const IcExpandir = base(<path d="M9 6l6 6-6 6" />);
export const IcFechar = base(<path d="M6 6l12 12M18 6L6 18" />);
export const IcSaldo = base(<><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /><circle cx="17" cy="14" r="1.5" /></>);
export const IcEconomia = base(<><path d="M19 5c-1.5 0-2.8 1.2-3 2.5-1 0-4 .5-4 4.5 0 2 1 3 1 3v2h2l1-1h2l1 1h2v-4c1-.5 2-2 2-3.5 0-1-.5-2-1-2.5 0-1.5-.5-2.5-2-2.5z" /><path d="M9 7H4M6 11H3" /></>);
export const IcExtrair = base(<><path d="M9 3l1.5 3.5L14 8l-3.5 1.5L9 13l-1.5-3.5L4 8l3.5-1.5z" /><path d="M17 12l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" /></>);
export const IcAnexo = base(<path d="M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 6" />);
export const IcAnalises = base(<><path d="M3 3v18h18" /><rect x="7" y="11" width="3" height="6" rx="1" /><rect x="12" y="7" width="3" height="10" rx="1" /><rect x="17" y="13" width="3" height="4" rx="1" /></>);
export const IcGrip = base(<><circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" /></>);
export const IcChat = base(<><path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" /><path d="M8 9h8M8 13h5" /></>);
export const IcMenu = base(<><path d="M4 6h16M4 12h16M4 18h16" /></>);
export const IcExportar = base(<><path d="M12 3v12M8 11l4 4 4-4" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></>);
export const IcImportar = base(<><path d="M12 15V3M8 7l4-4 4 4" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></>);
export const IcTag = base(<><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0l-7-7A2 2 0 0 1 3 12.2V5a2 2 0 0 1 2-2h7.2a2 2 0 0 1 1.4.6l7 7a2 2 0 0 1 0 2.8z" /><circle cx="7.5" cy="7.5" r="1.5" /></>);
// Estes três vinham como caractere solto no meio do JSX: `✎` (U+270E), `⌷`
// (U+2337, um símbolo de APL) e `↺` (U+21BA). Nenhum deles está em subset algum
// que o app carrega — dá para conferir nos `unicode-range` do
// `@fontsource-variable/ibm-plex-sans/index.css`, que param na pontuação geral
// (U+2000–206F) e listam só U+2191/U+2193 de setas. Quem os desenha é a fonte de
// fallback do aparelho: outro tipo, outro peso, outra métrica ao lado de ícones
// SVG — e quadrado vazio onde o fallback de símbolos é magro. Como SVG, o traço
// é o mesmo em todo lugar e não depende de qual fonte o app usa hoje (já mudou
// três vezes). O `×` de excluir era a exceção legítima: U+00D7 é Latin-1 e vem
// na fonte — trocado junto só pela consistência de traço com os vizinhos.
export const IcArquivar = base(<><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" /><path d="M10 12h4" /></>);
export const IcReativar = base(<><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></>);
export const IcEditar = base(<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>);
// "Excluir a compra parcelada inteira", que era `⨯⨯` (U+2A2F duplicado, produto
// vetorial) — mesmo problema dos de cima, e ainda por cima ilegível: dois sinais
// iguais não dizem "todas as parcelas". Aqui as três linhas empilhadas são as
// parcelas e o × ao lado é o que acontece com elas.
export const IcExcluirSerie = base(<><rect x="3" y="4" width="9" height="3" rx="1" /><rect x="3" y="10.5" width="9" height="3" rx="1" /><rect x="3" y="17" width="9" height="3" rx="1" /><path d="M16 9.5l5.5 5.5M21.5 9.5L16 15" /></>);

export const IcOk = base(<path d="M4.5 12.5l5 5L19.5 7" />);
export const IcAlerta = base(<><path d="M12 3.5L2 20.5h20z" /><path d="M12 10v4.5" /><path d="M12 17.6h.01" /></>);

/** Marcas de variação: massa cheia, não contorno, e num viewBox próprio.
 *
 *  Estas aparecem coladas a um número de 11–12px, e nesse tamanho o traço de
 *  1.5 do `base()` vira um borrão — o que se lê aqui é a direção, que se
 *  reconhece melhor pela silhueta sólida. O `vertical-align` embutido é o que
 *  faz a marca centrar na linha do número sem exigir CSS em cada lugar que a
 *  usa: SVG inline assenta na linha de base como se fosse letra. */
function marca(d: React.ReactNode) {
  return function Marca({ titulo, ...props }: P) {
    return (
      <svg
        width="9" height="9" viewBox="0 0 12 12" fill="currentColor"
        style={{ verticalAlign: "0.02em", flexShrink: 0 }}
        aria-hidden={titulo ? undefined : true} role={titulo ? "img" : undefined}
        {...props}
      >
        {titulo && <title>{titulo}</title>}
        {d}
      </svg>
    );
  };
}

// Eram `▲` (U+25B2) e `▼` (U+25BC), com `•` (U+2022) no caso sem variação. Os
// dois triângulos caem fora de todo subset carregado — e como vivem dentro de
// `.num`/`.chip-var`, que pedem JetBrains Mono, o fallback os desenhava com
// outro peso ao lado do próprio número que eles qualificam. O `•` renderizava
// (U+2022 está em U+2000–206F), mas virou traço junto: os três são o mesmo
// controle, e um deles fora do conjunto destoaria.
export const IcSubiu = marca(<path d="M6 2L11 9.5H1z" />);
export const IcDesceu = marca(<path d="M6 10L1 2.5h10z" />);
export const IcEstavel = marca(<rect x="1" y="5" width="10" height="2" rx="1" />);
