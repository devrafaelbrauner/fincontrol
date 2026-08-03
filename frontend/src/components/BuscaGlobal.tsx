import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, brl, paraCents } from "../api";
import { useCompetencia } from "../estado";
import { IcBusca } from "./icones";
import Modal from "./Modal";

type Resultado = {
  tipo: "variavel" | "entrada" | "fixa";
  id: number;
  descricao: string;
  valor_cents: number;
  data: string;
  categoria: string | null;
  pago?: boolean;
};

const GRUPOS: { tipo: Resultado["tipo"]; rotulo: string; destino: string }[] = [
  { tipo: "variavel", rotulo: "Gastos variáveis", destino: "/variaveis" },
  { tipo: "entrada", rotulo: "Entradas", destino: "/entradas" },
  { tipo: "fixa", rotulo: "Contas fixas", destino: "/fixas" },
];

/** Busca global (Ctrl/Cmd+K): texto, período e faixa de valor sobre tudo.
 *  Clicar num resultado leva à página dele já no mês certo. */
export default function BuscaGlobal({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const navigate = useNavigate();
  const { setCompetencia } = useCompetencia();

  const [q, setQ] = useState("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [valorMin, setValorMin] = useState("");
  const [valorMax, setValorMax] = useState("");
  const [itens, setItens] = useState<Resultado[]>([]);
  const [truncado, setTruncado] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const requisicao = useRef(0);

  // NaN (campo vazio/ilegível) vira 0: NaN !== NaN e, como dependência do
  // efeito, dispararia uma busca por render, para sempre.
  const cents = (texto: string) => { const n = paraCents(texto); return Number.isFinite(n) && n > 0 ? n : 0; };
  const min = cents(valorMin);
  const max = cents(valorMax);
  const temCriterio = !!(q.trim() || de || ate || min > 0 || max > 0);

  useEffect(() => {
    if (!aberto) return;
    const id = ++requisicao.current;
    if (!temCriterio) {
      setItens([]); setTruncado(false); setErro(null); setBuscando(false);
      return;
    }
    setBuscando(true);
    // Debounce: espera o usuário parar de digitar antes de ir à rede.
    const timer = setTimeout(async () => {
      const p = new URLSearchParams();
      if (q.trim()) p.set("q", q.trim());
      if (de) p.set("de", de);
      if (ate) p.set("ate", ate);
      if (min > 0) p.set("valor_min", String(min));
      if (max > 0) p.set("valor_max", String(max));
      try {
        const r = await api<{ itens: Resultado[]; truncado: boolean }>(`/busca?${p}`);
        if (id !== requisicao.current) return; // resposta obsoleta
        setItens(r.itens); setTruncado(r.truncado); setErro(null);
      } catch (e) {
        if (id !== requisicao.current) return;
        setErro((e as Error).message);
      } finally {
        if (id === requisicao.current) setBuscando(false);
      }
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, q, de, ate, min, max]);

  function abrir(item: Resultado, destino: string) {
    setCompetencia(item.data.slice(0, 7)); // a página abre já no mês do item
    navigate(destino);
    aoFechar();
  }

  return (
    <Modal titulo="Buscar em tudo" aberto={aberto} aoFechar={aoFechar}>
      <div className="campos">
        <div className="campo">
          <div className="linha-form" style={{ alignItems: "center" }}>
            <IcBusca />
            <input placeholder="Descrição ou nome da conta…" value={q} onChange={(e) => setQ(e.target.value)}
              aria-label="Texto da busca" autoFocus style={{ flex: 1 }} />
          </div>
        </div>
        <div className="linha-form">
          <div className="campo" style={{ flex: 1, minWidth: 130 }}>
            <label htmlFor="busca-de">De</label>
            <input id="busca-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
          </div>
          <div className="campo" style={{ flex: 1, minWidth: 130 }}>
            <label htmlFor="busca-ate">Até</label>
            <input id="busca-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
          </div>
        </div>
        <div className="linha-form">
          <div className="campo" style={{ flex: 1, minWidth: 130 }}>
            <label htmlFor="busca-min">Valor mínimo (R$)</label>
            <input id="busca-min" inputMode="decimal" placeholder="0,00" value={valorMin} onChange={(e) => setValorMin(e.target.value)} />
          </div>
          <div className="campo" style={{ flex: 1, minWidth: 130 }}>
            <label htmlFor="busca-max">Valor máximo (R$)</label>
            <input id="busca-max" inputMode="decimal" placeholder="0,00" value={valorMax} onChange={(e) => setValorMax(e.target.value)} />
          </div>
        </div>

        {erro && <p className="erro">{erro}</p>}
        {!temCriterio ? (
          <p className="sub">Digite um texto, escolha um período ou uma faixa de valor.</p>
        ) : buscando ? (
          <div className="skeleton" style={{ height: 120 }} />
        ) : itens.length === 0 ? (
          <p className="sub">Nada encontrado com esses critérios.</p>
        ) : (
          <div style={{ maxHeight: "45dvh", overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {GRUPOS.map(({ tipo, rotulo, destino }) => {
              const doTipo = itens.filter((i) => i.tipo === tipo);
              if (doTipo.length === 0) return null;
              return (
                <div key={tipo}>
                  <div className="eyebrow" style={{ marginBottom: "0.35rem" }}>{rotulo} ({doTipo.length})</div>
                  <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                    {doTipo.map((i) => (
                      <li key={`${tipo}-${i.id}`}>
                        <button type="button" className="item legenda-item" style={{ width: "100%" }} onClick={() => abrir(i, destino)}>
                          <span className="pct num" style={{ marginLeft: 0, minWidth: 74 }}>
                            {new Date(i.data + "T00:00").toLocaleDateString("pt-BR")}
                          </span>
                          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>
                            {i.descricao}
                            {i.categoria && <span className="pct" style={{ marginLeft: "0.4rem" }}>{i.categoria}</span>}
                            {i.tipo === "fixa" && !i.pago && <span className="pct" style={{ marginLeft: "0.4rem" }}>em aberto</span>}
                          </span>
                          <span className={`num ${i.tipo === "entrada" ? "positivo" : "negativo"}`}>{brl(i.valor_cents)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            {truncado && <p className="sub">Mostrando os 50 mais recentes — refine a busca para ver o resto.</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}
