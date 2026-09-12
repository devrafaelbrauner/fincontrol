import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { getToken, logout } from "./api";
import AddTransacaoModal from "./components/AddTransacaoModal";
import BannerVersao from "./components/BannerVersao";
import BuscaGlobal from "./components/BuscaGlobal";
import Logo from "./components/Logo";
import OfflineBar from "./components/OfflineBar";
import {
  IcBusca, IcExpandir, IcLua, IcMais, IcRecolher, IcSair, IcSol,
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

/** Título por rota: o hub (/) usa o próprio nome; as internas mostram de onde voltar. */
const TITULOS: Record<string, string> = {
  "/": "FinControl",
  "/analises": "Análises",
  "/assistente": "Assistente",
  "/importar": "Importar",
  "/fixas": "Contas fixas",
  "/variaveis": "Variáveis",
  "/entradas": "Entradas",
  "/metas": "Metas",
  "/compromissos": "Compromissos",
  "/calendario": "Calendário",
  "/recursos": "Recursos",
  "/config": "Configurações",
};

function passoCompetencia(c: string, delta: number): string {
  const d = new Date(Number(c.slice(0, 4)), Number(c.slice(5, 7)) - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function App() {
  const { pathname } = useLocation();
  const navegar = useNavigate();
  const [tema, alternarTema] = useTema();
  const [addAberto, setAddAberto] = useState(false);
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

  if (!getToken() && pathname !== "/login") return <Navigate to="/login" replace />;
  if (pathname === "/login") return <Login />;

  const ehHub = pathname === "/";
  // Rota desconhecida cai no hub em vez de tela em branco: as rotas atuais
  // permanecem, e qualquer resto é erro de digitação — não página.
  const tituloTela = TITULOS[pathname] ?? "FinControl";
  const hoje = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="app-hub">
      <header className="topo topo-hub">
        <div className="topo-titulo">
          {!ehHub && (
            <button className="voltar" onClick={() => navegar("/")} aria-label="Voltar ao início">
              <IcRecolher /> Início
            </button>
          )}
          <div className="hub-marca">
            <NavLink to="/" className="hub-logo" aria-label="FinControl — início">
              <span className="logo"><Logo /></span>
              <span className="titulo">FinControl</span>
            </NavLink>
          </div>
          <div className="eyebrow">{ehHub ? hoje.toUpperCase() : tituloTela.toUpperCase()}</div>
          {ehHub && <h1 className="tela-titulo">Visão geral</h1>}
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
          <button className="btn btn-icone" onClick={alternarTema}
            aria-label={tema === "dark" ? "Tema claro" : "Tema escuro"}>
            {tema === "dark" ? <IcSol /> : <IcLua />}
          </button>
          <button className="btn btn-icone btn-perigo" onClick={logout} aria-label="Sair"><IcSair /></button>
          <button className="btn btn-primario" onClick={() => setAddAberto(true)}>
            <IcMais /><span className="btn-adicionar-texto">Transação</span>
          </button>
        </div>
      </header>

      <main className="pagina">
        <BannerVersao />
        <OfflineBar />
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
          <Route path="*" element={<Dashboard />} />
        </Routes>
      </main>

      <button className="fab fab-hub" onClick={() => setAddAberto(true)} aria-label="Adicionar transação"><IcMais /></button>

      <AddTransacaoModal aberto={addAberto} aoFechar={() => setAddAberto(false)} />
      <BuscaGlobal aberto={buscaAberta} aoFechar={() => setBuscaAberta(false)} />
    </div>
  );
}
