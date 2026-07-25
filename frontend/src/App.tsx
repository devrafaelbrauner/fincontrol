import { ReactNode, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { getToken, logout } from "./api";
import AddTransacaoModal from "./components/AddTransacaoModal";
import {
  IcCalendario, IcConfig, IcEntradas, IcExpandir, IcFixas, IcLua, IcMais, IcMetas,
  IcRecolher, IcSair, IcSino, IcSol, IcVariaveis, IcVisao,
} from "./components/icones";
import { useCompetencia } from "./estado";
import { useTema } from "./tema";
import Calendario from "./pages/Calendario";
import Config from "./pages/Config";
import ContasFixas from "./pages/ContasFixas";
import Dashboard from "./pages/Dashboard";
import Entradas from "./pages/Entradas";
import Login from "./pages/Login";
import Metas from "./pages/Metas";
import Variaveis from "./pages/Variaveis";

const ABAS: { para: string; rotulo: string; icone: ReactNode }[] = [
  { para: "/", rotulo: "Visão geral", icone: <IcVisao /> },
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

export default function App() {
  const { pathname } = useLocation();
  const [tema, alternarTema] = useTema();
  const [recolhido, setRecolhido] = useState(false);
  const [addAberto, setAddAberto] = useState(false);
  const { competencia, setCompetencia } = useCompetencia();

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
          {ABAS.map((a) => (
            <NavLink key={a.para} to={a.para} end={a.para === "/"} title={a.rotulo}>
              {a.icone}
              <span className="rotulo">{a.rotulo}</span>
            </NavLink>
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
        {ABAS.slice(0, 5).map((a) => (
          <NavLink key={a.para} to={a.para} end={a.para === "/"}>
            {a.icone}
            <span>{a.rotulo.split(" ")[0]}</span>
          </NavLink>
        ))}
      </nav>
      <button className="fab" onClick={() => setAddAberto(true)} aria-label="Adicionar transação"><IcMais /></button>

      <AddTransacaoModal aberto={addAberto} aoFechar={() => setAddAberto(false)} />
    </div>
  );
}
