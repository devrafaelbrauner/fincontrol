import { ReactNode, useEffect, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { getToken, logout } from "./api";
import AddTransacaoModal from "./components/AddTransacaoModal";
import {
  IcAnalises, IcCalendario, IcChat, IcConfig, IcEntradas, IcExpandir, IcFechar, IcFixas, IcGrip, IcImportar, IcLua, IcMais, IcMenu,
  IcMetas, IcRecolher, IcSair, IcSino, IcSol, IcVariaveis, IcVisao,
} from "./components/icones";
import { useCompetencia } from "./estado";
import { definirOrdem, useOrdem } from "./ordem";
import { useTema } from "./tema";
import Analises from "./pages/Analises";
import Assistente from "./pages/Assistente";
import Calendario from "./pages/Calendario";
import Config from "./pages/Config";
import ContasFixas from "./pages/ContasFixas";
import Dashboard from "./pages/Dashboard";
import Entradas from "./pages/Entradas";
import Importar from "./pages/Importar";
import Login from "./pages/Login";
import Metas from "./pages/Metas";
import Variaveis from "./pages/Variaveis";

const ABAS: { para: string; rotulo: string; icone: ReactNode }[] = [
  { para: "/", rotulo: "Visão geral", icone: <IcVisao /> },
  { para: "/analises", rotulo: "Análises", icone: <IcAnalises /> },
  { para: "/assistente", rotulo: "Assistente", icone: <IcChat /> },
  { para: "/importar", rotulo: "Importar", icone: <IcImportar /> },
  { para: "/fixas", rotulo: "Contas fixas", icone: <IcFixas /> },
  { para: "/variaveis", rotulo: "Variáveis", icone: <IcVariaveis /> },
  { para: "/entradas", rotulo: "Entradas", icone: <IcEntradas /> },
  { para: "/metas", rotulo: "Metas", icone: <IcMetas /> },
  { para: "/calendario", rotulo: "Calendário", icone: <IcCalendario /> },
  { para: "/config", rotulo: "Configurações", icone: <IcConfig /> },
];

function saudacao(): string {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

const NOME = localStorage.getItem("nome") || "Rafael";

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
  const { competencia, setCompetencia } = useCompetencia();

  const ordem = reconciliar(useOrdem());
  const arrastando = useRef<number | null>(null);
  const [arrastandoIdx, setArrastandoIdx] = useState<number | null>(null);
  const gripsRef = useRef<Record<string, HTMLButtonElement | null>>({});
  const [focoPath, setFocoPath] = useState<string | null>(null);

  // Refoca a alça do item movido por teclado, após o re-render.
  useEffect(() => { if (focoPath) { gripsRef.current[focoPath]?.focus(); setFocoPath(null); } }, [focoPath]);

  function mover(de: number, para: number) {
    if (de === para || para < 0 || para >= ordem.length) return;
    const n = [...ordem];
    const [x] = n.splice(de, 1);
    n.splice(para, 0, x);
    definirOrdem(n);
  }

  const abas = ordem.map((p) => ABAS.find((a) => a.para === p)).filter((a): a is (typeof ABAS)[number] => !!a);

  if (!getToken() && pathname !== "/login") return <Navigate to="/login" replace />;
  if (pathname === "/login") return <Login />;

  const hoje = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className={`app${recolhido ? " recolhido" : ""}`}>
      <aside className="sidebar">
        <button className="btn btn-icone recolher" onClick={() => setRecolhido((r) => !r)}
          aria-label={recolhido ? "Expandir menu" : "Recolher menu"}>
          {recolhido ? <IcExpandir /> : <IcRecolher />}
        </button>
        <div className="marca">
          <span className="logo">R$</span>
          <span className="titulo rotulo">FinControl</span>
        </div>
        <nav>
          {abas.map((a, idx) => (
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
              <button type="button" className="grip" aria-label={`Reordenar ${a.rotulo} (use as setas ↑ ↓)`}
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
        </nav>
        <div className="usuario">
          <span className="avatar">{NOME[0]}</span>
          <div>
            <div className="nome rotulo">{NOME}</div>
            <div className="sub rotulo">Conta pessoal</div>
          </div>
          <button className="btn btn-icone btn-perigo" style={{ marginLeft: "auto" }} onClick={logout} aria-label="Sair"><IcSair /></button>
        </div>
      </aside>

      <div className="conteudo">
        <header className="topo">
          <div>
            <div className="saudacao">{saudacao()}, {NOME}</div>
            <div className="data">{hoje.charAt(0).toUpperCase() + hoje.slice(1)}</div>
          </div>
          <div className="espaco" />
          <div className="acoes">
            <input type="month" className="seletor-comp" value={competencia}
              onChange={(e) => setCompetencia(e.target.value)} aria-label="Competência" style={{ width: "auto" }} />
            <NavLink to="/config" className="btn btn-icone" aria-label="Notificações"><IcSino /></NavLink>
            <button className="btn btn-icone" onClick={alternarTema}
              aria-label={tema === "dark" ? "Tema claro" : "Tema escuro"}>
              {tema === "dark" ? <IcSol /> : <IcLua />}
            </button>
            <button className="btn btn-primario" onClick={() => setAddAberto(true)}>
              <IcMais /><span className="btn-adicionar-texto">Adicionar transação</span>
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
          <div className="glass glass-forte sheet" role="dialog" aria-label="Todas as páginas">
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
    </div>
  );
}
