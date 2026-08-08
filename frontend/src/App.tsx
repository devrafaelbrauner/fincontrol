import { ReactNode, useEffect, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { getToken, logout } from "./api";
import AddTransacaoModal from "./components/AddTransacaoModal";
import BuscaGlobal from "./components/BuscaGlobal";
import Logo from "./components/Logo";
import {
  IcAnalises, IcBusca, IcCalendario, IcChat, IcCompromissos, IcConfig, IcEntradas, IcExpandir, IcFechar, IcFixas, IcGrip, IcImportar, IcLua, IcMais, IcMenu,
  IcMetas, IcRecolher, IcRecursos, IcSair, IcSol, IcVariaveis, IcVisao,
} from "./components/icones";
import { useCompetencia } from "./estado";

/** Rótulo do atalho da busca, decidido pela plataforma.
 *
 *  O chip mostrava `⌘K` em todo lugar enquanto o `title` dizia "Ctrl+K" — os
 *  dois não podiam estar certos ao mesmo tempo, e fora do Mac o errado era o que
 *  aparecia na tela. O handler sempre aceitou as duas teclas (`metaKey ||
 *  ctrlKey`); o que faltava era o rótulo acompanhar.
 *
 *  Isso também resolve a fonte: U+2318 não está em subset nenhum que o app
 *  carrega, então dependia do fallback do aparelho. Onde ele agora aparece — as
 *  plataformas Apple — o símbolo vem da fonte do sistema e é exatamente o que a
 *  pessoa espera ver; nas demais ele some junto com o engano. */
const TECLA_BUSCA =
  typeof navigator !== "undefined" && /mac|iphone|ipad|ipod/i.test(navigator.userAgent) ? "⌘K" : "Ctrl+K";
import { definirOrdem, useOrdem } from "./ordem";
import { useTema } from "./tema";
import Analises from "./pages/Analises";
import Assistente from "./pages/Assistente";
import Calendario from "./pages/Calendario";
import Compromissos from "./pages/Compromissos";
import Config from "./pages/Config";
import ContasFixas from "./pages/ContasFixas";
import Dashboard from "./pages/Dashboard";
import Entradas from "./pages/Entradas";
import Importar from "./pages/Importar";
import Login from "./pages/Login";
import Metas from "./pages/Metas";
import Recursos from "./pages/Recursos";
import Variaveis from "./pages/Variaveis";

/** Os três grupos da barra lateral, na ordem em que aparecem. */
const GRUPOS = [
  { id: "mes", rotulo: "Mês" },
  { id: "lancamentos", rotulo: "Lançamentos" },
  { id: "agenda", rotulo: "Agenda" },
] as const;

type Grupo = (typeof GRUPOS)[number]["id"];

// O grupo é fixo por aba: a ordem é livre DENTRO do grupo, nunca entre grupos —
// senão o primeiro arrasto desfaria o agrupamento que dá sentido à barra.
const ABAS: { para: string; rotulo: string; icone: ReactNode; grupo: Grupo }[] = [
  { para: "/", rotulo: "Visão geral", icone: <IcVisao />, grupo: "mes" },
  { para: "/analises", rotulo: "Análises", icone: <IcAnalises />, grupo: "mes" },
  { para: "/assistente", rotulo: "Assistente", icone: <IcChat />, grupo: "mes" },
  { para: "/importar", rotulo: "Importar", icone: <IcImportar />, grupo: "mes" },
  { para: "/fixas", rotulo: "Contas fixas", icone: <IcFixas />, grupo: "lancamentos" },
  { para: "/variaveis", rotulo: "Variáveis", icone: <IcVariaveis />, grupo: "lancamentos" },
  { para: "/entradas", rotulo: "Entradas", icone: <IcEntradas />, grupo: "lancamentos" },
  { para: "/metas", rotulo: "Metas", icone: <IcMetas />, grupo: "lancamentos" },
  { para: "/compromissos", rotulo: "Compromissos", icone: <IcCompromissos />, grupo: "agenda" },
  { para: "/calendario", rotulo: "Calendário", icone: <IcCalendario />, grupo: "agenda" },
  { para: "/recursos", rotulo: "Recursos", icone: <IcRecursos />, grupo: "agenda" },
  { para: "/config", rotulo: "Configurações", icone: <IcConfig />, grupo: "agenda" },
];

const NOME = localStorage.getItem("nome") || "Rafael";

function passoCompetencia(c: string, delta: number): string {
  const d = new Date(Number(c.slice(0, 4)), Number(c.slice(5, 7)) - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Ordem salva reconciliada com as abas atuais (novas/desconhecidas ao fim). */
function reconciliar(salvo: string[]): string[] {
  const padrao = ABAS.map((a) => a.para);
  const validos = salvo.filter((p) => padrao.includes(p));
  return [...validos, ...padrao.filter((p) => !validos.includes(p))];
}

export default function App() {
  const { pathname } = useLocation();
  const [tema, alternarTema] = useTema();
  const [recolhido, setRecolhido] = useState(false);
  const [addAberto, setAddAberto] = useState(false);
  const [maisAberto, setMaisAberto] = useState(false);
  const [buscaAberta, setBuscaAberta] = useState(false);

  // Ctrl/Cmd+K abre a busca global de qualquer tela — exceto no login, onde o
  // modal nem é renderizado: lá o atalho só armaria um estado invisível que
  // escancararia a busca assim que o login completasse.
  useEffect(() => {
    if (pathname === "/login") return;
    const atalho = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setBuscaAberta(true);
      }
    };
    window.addEventListener("keydown", atalho);
    return () => window.removeEventListener("keydown", atalho);
  }, [pathname]);
  const { competencia, setCompetencia } = useCompetencia();

  const ordem = reconciliar(useOrdem());
  const arrastando = useRef<number | null>(null);
  const [arrastandoIdx, setArrastandoIdx] = useState<number | null>(null);
  const gripsRef = useRef<Record<string, HTMLButtonElement | null>>({});
  const [focoPath, setFocoPath] = useState<string | null>(null);

  // Refoca a alça do item movido por teclado, após o re-render.
  useEffect(() => { if (focoPath) { gripsRef.current[focoPath]?.focus(); setFocoPath(null); } }, [focoPath]);

  const abas = ordem.map((p) => ABAS.find((a) => a.para === p)).filter((a): a is (typeof ABAS)[number] => !!a);

  function mover(de: number, para: number) {
    if (de === para || para < 0 || para >= abas.length) return;
    // Recusa mudança de grupo. Sem isto o arrasto atravessaria as seções e o
    // item reapareceria sob outro título, que é justamente o que os grupos
    // existem para impedir.
    if (abas[de].grupo !== abas[para].grupo) return;
    const n = [...ordem];
    const [x] = n.splice(de, 1);
    n.splice(para, 0, x);
    definirOrdem(n);
  }

  if (!getToken() && pathname !== "/login") return <Navigate to="/login" replace />;
  if (pathname === "/login") return <Login />;

  const hoje = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  // O título do topo é o rótulo da aba atual — uma fonte só, então renomear uma
  // aba renomeia o cabeçalho junto.
  const tituloTela = ABAS.find((a) => a.para === pathname)?.rotulo ?? "Visão geral";

  return (
    <div className={`app${recolhido ? " recolhido" : ""}`}>
      <aside className="sidebar">
        <button className="btn btn-icone recolher" onClick={() => setRecolhido((r) => !r)}
          aria-label={recolhido ? "Expandir menu" : "Recolher menu"}>
          {recolhido ? <IcExpandir /> : <IcRecolher />}
        </button>
        <div className="marca">
          <span className="logo"><Logo /></span>
          <span className="titulo rotulo">FinControl</span>
        </div>
        <nav>
          {GRUPOS.map((g) => {
            // Índice na lista completa: o arrasto e a ordem falam em posição
            // global, mas a renderização é por grupo.
            const doGrupo = abas.map((a, idx) => ({ a, idx })).filter(({ a }) => a.grupo === g.id);
            if (!doGrupo.length) return null;
            return (
              <div key={g.id} className="nav-grupo">
                <div className="eyebrow nav-grupo-rotulo rotulo">{g.rotulo}</div>
                {doGrupo.map(({ a, idx }) => (
                  <div key={a.para} className={`nav-item${arrastandoIdx === idx ? " arrastando" : ""}`}
                    draggable
                    onDragStart={(e) => { arrastando.current = idx; setArrastandoIdx(idx); e.dataTransfer.effectAllowed = "move"; }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (arrastando.current != null && arrastando.current !== idx) {
                        mover(arrastando.current, idx);
                        arrastando.current = idx;
                        setArrastandoIdx(idx);
                      }
                    }}
                    onDragEnd={() => { arrastando.current = null; setArrastandoIdx(null); }}
                  >
                    <button type="button" className="grip" aria-label={`Reordenar ${a.rotulo} dentro de ${g.rotulo} (use as setas ↑ ↓)`}
                      ref={(el) => { gripsRef.current[a.para] = el; }}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowUp") { e.preventDefault(); mover(idx, idx - 1); setFocoPath(a.para); }
                        else if (e.key === "ArrowDown") { e.preventDefault(); mover(idx, idx + 1); setFocoPath(a.para); }
                      }}>
                      <IcGrip />
                    </button>
                    <NavLink to={a.para} end={a.para === "/"} title={a.rotulo} draggable={false}>
                      {a.icone}
                      <span className="rotulo">{a.rotulo}</span>
                    </NavLink>
                  </div>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="usuario">
          <span className="avatar">{NOME[0]}</span>
          <div className="rotulo">
            <div className="nome">{NOME}</div>
            <div className="sub">Conta pessoal</div>
          </div>
          <div className="usuario-acoes">
            <button className="btn btn-icone" onClick={alternarTema}
              aria-label={tema === "dark" ? "Tema claro" : "Tema escuro"}>
              {tema === "dark" ? <IcSol /> : <IcLua />}
            </button>
            <button className="btn btn-icone btn-perigo" onClick={logout} aria-label="Sair"><IcSair /></button>
          </div>
        </div>
      </aside>

      <div className="conteudo">
        <header className="topo">
          <div className="topo-titulo">
            <div className="eyebrow">{hoje.toUpperCase()}</div>
            <h1 className="tela-titulo">{tituloTela}</h1>
          </div>
          <div className="espaco" />
          <div className="acoes">
            <div className="competencia-seletor" role="group" aria-label="Competência">
              <button className="btn btn-icone" onClick={() => setCompetencia(passoCompetencia(competencia, -1))} aria-label="Mês anterior"><IcRecolher /></button>
              <span className="competencia-rotulo num">{competencia.slice(5, 7)}/{competencia.slice(0, 4)}</span>
              <button className="btn btn-icone" onClick={() => setCompetencia(passoCompetencia(competencia, 1))} aria-label="Próximo mês"><IcExpandir /></button>
            </div>
            {/* Chip em vez de lupa: o atalho é o caminho principal, e mostrá-lo
                escrito é o que ensina que ele existe. */}
            <button className="chip-atalho" onClick={() => setBuscaAberta(true)}
              aria-label="Buscar em tudo" title={`Buscar em tudo (${TECLA_BUSCA})`}>
              <IcBusca /><span className="chip-atalho-tecla num">{TECLA_BUSCA}</span>
            </button>
            <button className="btn btn-primario" onClick={() => setAddAberto(true)}>
              <IcMais /><span className="btn-adicionar-texto">Transação</span>
            </button>
          </div>
        </header>

        <main className="pagina">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/analises" element={<Analises />} />
            <Route path="/assistente" element={<Assistente />} />
            <Route path="/importar" element={<Importar />} />
            <Route path="/fixas" element={<ContasFixas />} />
            <Route path="/variaveis" element={<Variaveis />} />
            <Route path="/entradas" element={<Entradas />} />
            <Route path="/metas" element={<Metas />} />
            <Route path="/compromissos" element={<Compromissos />} />
            <Route path="/recursos" element={<Recursos />} />
            <Route path="/calendario" element={<Calendario />} />
            <Route path="/config" element={<Config />} />
          </Routes>
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Navegação principal">
        {abas.slice(0, 4).map((a) => (
          <NavLink key={a.para} to={a.para} end={a.para === "/"}>
            {a.icone}
            <span>{a.rotulo.split(" ")[0]}</span>
          </NavLink>
        ))}
        {abas.length > 4 && (
          <button type="button" onClick={() => setMaisAberto(true)} aria-label="Mais páginas">
            <IcMenu /><span>Mais</span>
          </button>
        )}
      </nav>

      {maisAberto && (
        <div className="overlay sheet-overlay" onMouseDown={(e) => e.target === e.currentTarget && setMaisAberto(false)}>
          <div className="sheet" role="dialog" aria-label="Todas as páginas">
            <div className="sheet-topo">
              <strong>Navegar</strong>
              <button className="btn btn-icone" onClick={() => setMaisAberto(false)} aria-label="Fechar"><IcFechar /></button>
            </div>
            <div className="sheet-grade">
              {abas.map((a) => (
                <NavLink key={a.para} to={a.para} end={a.para === "/"} onClick={() => setMaisAberto(false)} className="sheet-item">
                  {a.icone}<span>{a.rotulo}</span>
                </NavLink>
              ))}
              <button className="sheet-item" onClick={() => { setMaisAberto(false); logout(); }}><IcSair /><span>Sair</span></button>
            </div>
          </div>
        </div>
      )}

      <button className="fab" onClick={() => setAddAberto(true)} aria-label="Adicionar transação"><IcMais /></button>

      <AddTransacaoModal aberto={addAberto} aoFechar={() => setAddAberto(false)} />
      <BuscaGlobal aberto={buscaAberta} aoFechar={() => setBuscaAberta(false)} />
    </div>
  );
}
