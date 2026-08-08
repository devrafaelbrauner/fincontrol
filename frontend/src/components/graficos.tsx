import { ReactNode, useEffect, useId, useRef, useState } from "react";
import { abreviarBRL, brl } from "../api";

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

/** Rótulo da linha que resume a cauda.
 *
 *  NÃO é "Outros": a migration 004 semeia uma categoria de verdade com esse
 *  nome exato (variável e entrada). Como as somas são chaveadas por nome, um
 *  mês com sete categorias incluindo a "Outros" real produziria duas linhas
 *  homônimas, com cores e valores diferentes, na mesma legenda. */
export const ROTULO_DEMAIS = "Demais categorias";

export type CategoriaCor = { id: number | null; cor?: string | null };

/** Resolve as cores de uma tela inteira de uma vez.
 *
 *  Chame UMA vez por página, com as categorias na ordem de importância (as que
 *  o leitor vai ver primeiro), e distribua o resultado para todas as seções.
 *
 *  É essa chamada única que faz as duas coisas ao mesmo tempo:
 *    · a mesma categoria tem a mesma cor em todas as seções, porque todas leem
 *      do mesmo mapa;
 *    · as primeiras seis ficam com cores distintas, porque a atribuição
 *      enxerga o conjunto todo antes de decidir.
 *
 *  Desempatar dentro de cada componente já foi tentado e produziu o pior dos
 *  dois mundos: como só a seção que dobrava passava pelo desempate, "Casa"
 *  saía âmbar em "Tendência por categoria" e azul em "Gastos por categoria",
 *  logo abaixo, na mesma tela.
 *
 *  `id % 6` sozinho também não bastava: com ids sequenciais, duas das seis
 *  linhas visíveis colidiam quase sempre (Casa=9 e Transporte=3 caem na mesma
 *  vaga). Aqui a paleta é distribuída entre quem de fato aparece. */
export function resolverCores(cats: CategoriaCor[]): Map<number, string> {
  const mapa = new Map<number, string>();
  const usadas = new Set<string>();
  // Quem tem cor escolhida na cartela vem primeiro: escolha do usuário não se
  // mexe, e as vagas que ela ocupa saem da disputa.
  for (const c of cats) {
    if (c.id != null && c.cor && !mapa.has(c.id)) { mapa.set(c.id, c.cor); usadas.add(c.cor); }
  }
  for (const c of cats) {
    if (c.id == null || mapa.has(c.id)) continue;
    // Sem vaga livre (mais de seis categorias em tela), cai no slot
    // determinístico: repete uma cor, mas de forma estável e previsível.
    const livre = PALETA_SERIES.find((p) => !usadas.has(p)) ?? corDaCategoria(c as { id: number });
    usadas.add(livre);
    mapa.set(c.id, livre);
  }
  return mapa;
}

/** SOBRE COLISÃO DE COR — por que não há desempate dentro dos componentes.
 *
 *  Houve uma versão que desempatava dentro de `dobrarEmOutros`. Ela foi
 *  removida depois de ser vista rodando: o desempate só acontecia onde a lista
 *  passa por lá, e Análises pinta as MESMAS categorias em dois lugares —
 *  "Gastos por categoria" (que dobra) e "Tendência por categoria" (que não).
 *  Na tela, "Casa" saía âmbar em cima e azul logo abaixo, e "Lazer" verde em
 *  cima e laranja abaixo.
 *
 *  Quem desempata agora é `resolverCores`, uma vez por página. Os componentes
 *  daqui recebem a cor pronta e nunca a alteram — é o que garante que a
 *  mesma categoria saia igual em todas as seções. Quem quiser fixar uma cor
 *  específica usa a cartela, e aí ela vale em toda parte porque vem do banco. */

/** Dobra a cauda para nunca reciclar matiz: repetir uma cor na sétima
 *  categoria é dizer que ela é a mesma coisa que a primeira.
 *
 *  Também substitui o `slice(0, 5)` que o Dashboard fazia, e que era pior que
 *  isto: ele escondia a cauda sem somá-la em lugar nenhum, então as
 *  porcentagens exibidas não fechavam com o total ao lado. */
export function dobrarEmOutros(fatias: FatiaDonut[], limite = PALETA_SERIES.length): FatiaDonut[] {
  const ordenadas = [...fatias].sort((a, b) => b.valor - a.valor);
  if (ordenadas.length <= limite) return ordenadas;
  // "Sem categoria" desce junto com a cauda: ele e a linha de resumo já
  // significam ambos "aqui não há identidade", e manter os dois poria dois
  // cinzas na legenda.
  const nomeadas = ordenadas.filter((f) => f.rotulo !== ROTULO_SEM_CATEGORIA);
  const anonimas = ordenadas.filter((f) => f.rotulo === ROTULO_SEM_CATEGORIA);
  const topo = nomeadas.slice(0, limite - 1);
  const resto = [...nomeadas.slice(limite - 1), ...anonimas].reduce((s, f) => s + f.valor, 0);
  // A linha sai mesmo somando zero. `valor_cents` aceita 0 (CHECK >= 0 na
  // migration 001), então uma cauda inteira de lançamentos zerados faria
  // categorias reais sumirem da lista sem nada explicando a ausência.
  return [...topo, { rotulo: ROTULO_DEMAIS, valor: resto, cor: COR_SEM_CATEGORIA }];
}

/** Largura real do contêiner, para o viewBox ter 1 unidade = 1 pixel.
 *
 *  O viewBox era fixo em 640 e o SVG escalava para caber. Num celular de 390px
 *  isso encolhia tudo junto: o rótulo do eixo, declarado com 10px, era
 *  desenhado a ~5,5px reais. Foi assim que apareceu na captura do Android —
 *  ilegível. Medindo, o texto tem o tamanho que diz ter em qualquer tela. */
function useLargura() {
  const ref = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setLargura(e.contentRect.width));
    ro.observe(el);
    setLargura(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return { ref, largura };
}

/** Marcas de eixo em passos redondos (1, 2, 2,5 ou 5 × 10ⁿ).
 *
 *  Dividir o intervalo em partes iguais poria "R$ 3.847" no eixo, que não
 *  ajuda a estimar nada; número redondo é o que se lê de relance. */
export function ticksBonitos(min: number, max: number, alvo = 3): number[] {
  if (!(max > min)) return [min];
  const bruto = (max - min) / alvo;
  const mag = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => p >= bruto) ?? 10 * mag;
  const marcas: number[] = [];
  for (let v = Math.ceil(min / passo) * passo; v <= max + passo * 1e-9; v += passo) marcas.push(Math.round(v));
  return marcas;
}

/** Barra com as pontas de cima arredondadas e a base reta.
 *  O `rx` do <rect> arredondava os quatro cantos, e canto redondo embaixo
 *  descola a barra da linha do zero, que é justamente de onde ela se mede. */
function caminhoBarra(x: number, y: number, w: number, h: number, r = 3) {
  if (h <= 0.5) return "";
  const raio = Math.min(r, w / 2, h);
  return `M${x},${y + h} L${x},${y + raio} Q${x},${y} ${x + raio},${y} `
    + `L${x + w - raio},${y} Q${x + w},${y} ${x + w},${y + raio} L${x + w},${y + h} Z`;
}

/** A linha de leitura: rótulo do ponto em foco e os valores dele.
 *
 *  Substitui o balão que ficava preso em `top: 6, left: 8` — com o ponteiro no
 *  penúltimo mês, o valor aparecia do outro lado do gráfico. E, por depender de
 *  `onMouseEnter`, ele simplesmente não existia no Android.
 *
 *  Aqui a leitura mora fora do desenho, não cobre nada, e mostra o último mês
 *  quando não há ponteiro nenhum — então há sempre um valor para ler, mesmo
 *  sem mouse. Também dispensa a legenda separada: o ponto colorido ao lado do
 *  nome já faz esse trabalho. */
function LeituraGrafico({ rotulo, itens }: { rotulo: ReactNode; itens: [string, string, number][] }) {
  return (
    <div className="leitura-grafico" aria-live="polite">
      <span className="eyebrow">{rotulo}</span>
      {itens.map(([nome, cor, valor]) => (
        <span key={nome} className="leitura-item">
          <i style={{ background: cor }} />{nome} <b className="num">{brl(valor)}</b>
        </span>
      ))}
    </div>
  );
}

/** Sparkline minimalista (linha) sobre uma série de valores. */
export function Sparkline({ valores, cor = "var(--accent)", altura = 34 }: { valores: number[]; cor?: string; altura?: number }) {
  const larg = 100;
  if (valores.length < 2) return <svg width="100%" height={altura} aria-hidden="true" />;
  // O zero entra no domínio. Com min–max puro, a escala se ajustava ao ruído:
  // uma categoria oscilando 2% em torno da média desenhava a mesma montanha
  // que uma que dobrou no período. Ao lado de um valor absoluto, isso é
  // enganoso — a amplitude do traço passa a significar alguma coisa.
  const min = Math.min(0, ...valores);
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

// Medidas comuns aos dois gráficos. A esquerda é larga porque é onde mora o
// rótulo do eixo Y; a base, porque é onde ficam os meses.
const H = 240, PAD_TOPO = 14, PAD_BASE = 26, PAD_DIR = 10;

/** Largura da calha do eixo Y, a partir do rótulo mais largo que vai nela.
 *
 *  Foi fixa em 58 e depois em 46, e cortou nas duas: "R$ 7,5 mil" estourava a
 *  primeira, e "7,5 mil" ainda estourava a segunda num celular. Adivinhar o
 *  número não funciona porque o texto muda com a escala — "-12,5 mil" é quase
 *  o dobro de "0". A JetBrains Mono tem avanço fixo de 0.6em, então a largura
 *  é contável: 6px por caractere a 10px, mais folga dos dois lados. */
function calhaY(marcas: number[]): number {
  const maior = Math.max(...marcas.map((v) => abreviarBRL(v, false).length));
  return Math.ceil(maior * 6.2) + 14;
}

/** Gráfico de fluxo (área/linha) com receitas, despesas e saldo acumulado. */
export function AreaChart({ dados, modo = "area" }: { dados: SerieMes[]; modo?: "area" | "linha" }) {
  const [hover, setHover] = useState<number | null>(null);
  const { ref, largura } = useLargura();
  // Todos os hooks antes de qualquer return: o `useId` ficava DEPOIS da saída
  // por "poucos dados", então uma série que cruzasse esse limiar mudava a
  // ordem dos hooks entre renders — erro do React esperando para acontecer.
  const idFill = useId();

  const linhas: [string, string, (d: SerieMes) => number][] = [
    ["Receitas", "var(--positive)", (d) => d.entradas],
    ["Despesas", "var(--negative)", (d) => d.despesas],
    ["Saldo", "var(--accent)", (d) => d.saldo],
  ];
  const foco = dados.length ? dados[hover ?? dados.length - 1] : null;

  const conteudo = () => {
    if (dados.length < 2) return <p className="sub">Poucos dados para o gráfico.</p>;
    if (largura === 0) return <div style={{ height: H }} />;   // antes da medição

    const W = largura;
    const todos = dados.flatMap((d) => [d.entradas, d.despesas, d.saldo]);
    const min = Math.min(0, ...todos);
    const max = Math.max(...todos, 1);
    const span = max - min || 1;
    const marcas = ticksBonitos(min, max, 4);
    const PAD_ESQ = calhaY(marcas);
    const x = (i: number) => PAD_ESQ + (i / (dados.length - 1)) * (W - PAD_ESQ - PAD_DIR);
    const y = (v: number) => H - PAD_BASE - ((v - min) / span) * (H - PAD_BASE - PAD_TOPO);
    const serie = (sel: (d: SerieMes) => number) => dados.map((d, i) => `${x(i).toFixed(1)},${y(sel(d)).toFixed(1)}`).join(" ");
    const passo = Math.max(1, Math.ceil(dados.length / Math.floor((W - PAD_ESQ - PAD_DIR) / 52)));

    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img"
        aria-label="Gráfico de receitas, despesas e saldo por mês"
        onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={idFill} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.10" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Grade recessiva: um tom acima da superfície, sólida. A do zero é a
            régua forte, porque é a única que significa alguma coisa. */}
        {marcas.map((v) => (
          <g key={v}>
            <line x1={PAD_ESQ} y1={y(v)} x2={W - PAD_DIR} y2={y(v)} stroke={v === 0 ? "var(--edge)" : "var(--rule-soft)"} />
            <text x={PAD_ESQ - 8} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill="var(--content-3)" style={TEXTO_EIXO}>
              {abreviarBRL(v, false)}
            </text>
          </g>
        ))}
        {modo === "area" && (
          <polygon points={`${x(0)},${y(0)} ${serie((d) => d.saldo)} ${x(dados.length - 1)},${y(0)}`} fill={`url(#${idFill})`} />
        )}
        {linhas.map(([, cor, sel]) => (
          <polyline key={cor} points={serie(sel)} fill="none" stroke={cor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {dados.map((d, i) => (
          <g key={i}>
            {hover === i && <line x1={x(i)} y1={PAD_TOPO} x2={x(i)} y2={H - PAD_BASE} stroke="var(--edge-strong)" />}
            {linhas.map(([, cor, sel]) => hover === i && (
              // Anel da cor da superfície: separa os pontos quando duas séries
              // se cruzam, sem desenhar borda em volta da marca.
              <circle key={cor} cx={x(i)} cy={y(sel(d))} r="3.5" fill={cor} stroke="var(--page)" strokeWidth="2" />
            ))}
            <rect x={x(i) - (W - PAD_ESQ - PAD_DIR) / dados.length / 2} y="0"
              width={(W - PAD_ESQ - PAD_DIR) / dados.length} height={H} fill="transparent"
              onMouseEnter={() => setHover(i)} onPointerDown={() => setHover(i)} />
            {(dados.length - 1 - i) % passo === 0 && (
              <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--content-3)" style={TEXTO_EIXO}>{d.rotulo}</text>
            )}
          </g>
        ))}
      </svg>
    );
  };

  return (
    <div ref={ref}>
      {foco && dados.length >= 2 && (
        <LeituraGrafico rotulo={foco.rotulo} itens={linhas.map(([nome, cor, sel]) => [nome, cor, sel(foco)])} />
      )}
      {conteudo()}
    </div>
  );
}

export type BarraMes = { rotulo: string; entradas: number; gastos: number };

/** Barras agrupadas: entradas (verde) × gastos (vermelho) por mês. */
export function BarChart({ dados }: { dados: BarraMes[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const { ref, largura } = useLargura();
  const foco = dados.length ? dados[hover ?? dados.length - 1] : null;

  const conteudo = () => {
    if (dados.length === 0) return <p className="sub">Sem dados no período.</p>;
    if (largura === 0) return <div style={{ height: H }} />;

    const W = largura;
    const max = Math.max(...dados.flatMap((d) => [d.entradas, d.gastos]), 1);
    const marcas = ticksBonitos(0, max, 4);
    const PAD_ESQ = calhaY(marcas);
    const y = (v: number) => H - PAD_BASE - (v / max) * (H - PAD_BASE - PAD_TOPO);
    const grupoW = (W - PAD_ESQ - PAD_DIR) / dados.length;
    // 2px de folga da cor da superfície entre as barras do par, em vez de
    // borda: as duas se separam sem ganhar contorno.
    const barW = Math.max(2, Math.min(22, grupoW / 2 - 3));
    // Quantos rótulos cabem de fato, pela largura medida — a régua de 12 era
    // fixa e não sabia se estava num monitor ou num celular.
    const passo = Math.max(1, Math.ceil(dados.length / Math.max(2, Math.floor((W - PAD_ESQ - PAD_DIR) / 52))));

    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Entradas e gastos por mês" onMouseLeave={() => setHover(null)}>
        {marcas.map((v) => (
          <g key={v}>
            <line x1={PAD_ESQ} y1={y(v)} x2={W - PAD_DIR} y2={y(v)} stroke={v === 0 ? "var(--edge)" : "var(--rule-soft)"} />
            <text x={PAD_ESQ - 8} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill="var(--content-3)" style={TEXTO_EIXO}>
              {abreviarBRL(v, false)}
            </text>
          </g>
        ))}
        {dados.map((d, i) => {
          const cx = PAD_ESQ + grupoW * i + grupoW / 2;
          const opacidade = hover === null || hover === i ? 1 : 0.45;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onPointerDown={() => setHover(i)}>
              <rect x={PAD_ESQ + grupoW * i} y={PAD_TOPO} width={grupoW} height={H - PAD_TOPO - PAD_BASE} fill="transparent" />
              <path d={caminhoBarra(cx - barW - 1, y(d.entradas), barW, y(0) - y(d.entradas))} fill="var(--positive)" opacity={opacidade} />
              <path d={caminhoBarra(cx + 1, y(d.gastos), barW, y(0) - y(d.gastos))} fill="var(--negative)" opacity={opacidade} />
              {(dados.length - 1 - i) % passo === 0 && (
                <text x={cx} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--content-3)" style={TEXTO_EIXO}>{d.rotulo}</text>
              )}
            </g>
          );
        })}
      </svg>
    );
  };

  return (
    <div ref={ref}>
      {foco && (
        <LeituraGrafico rotulo={foco.rotulo} itens={[
          ["Entradas", "var(--positive)", foco.entradas],
          ["Gastos", "var(--negative)", foco.gastos],
        ]} />
      )}
      {conteudo()}
    </div>
  );
}

export type FatiaDonut = { rotulo: string; valor: number; cor: string };

/** Lista de barras horizontais ranqueadas (ex.: gastos por categoria). */
/** Ranking horizontal por valor. Com `total`, mostra também a fatia em % —
 *  é o que o redesign pede em "onde foi o variável". */
export function BarrasRank({ fatias, total }: { fatias: FatiaDonut[]; total?: number }) {
  const max = Math.max(...fatias.map((f) => f.valor), 1);
  // UM denominador. Com `total`, a barra mede a fatia e bate com o "· NN%" ao
  // lado; sem ele, mede contra a maior e a leitura é de ranking.
  // Antes a largura vinha sempre de `max` enquanto o rótulo dizia "% do total":
  // a primeira barra era 100% da linha e o texto ao lado dizia 41%.
  const base = total != null ? Math.max(total, max) : max;
  if (fatias.length === 0) return <p className="sub">Sem dados.</p>;
  return (
    <div className="legenda" style={{ gap: "0.7rem" }}>
      {fatias.map((f, i) => (
        <div key={i}>
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
          <div className="progresso"><i style={{ width: `${(f.valor / base) * 100}%`, background: f.cor }} /></div>
        </div>
      ))}
    </div>
  );
}

/* O Donut foi removido aqui. Ele desenhava, em Análises, exatamente os mesmos
   números que o ranking logo ao lado — e a própria Visão geral já argumentava
   em comentário que "comparar arcos é mais difícil que comparar comprimentos".
   Quem responde parte-todo agora é o `Fio` (components/Fio.tsx), que era uma
   invenção deste app presa dentro do Dashboard. */

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
