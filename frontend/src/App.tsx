import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { getToken, logout } from "./api";
import Calendario from "./pages/Calendario";
import Config from "./pages/Config";
import ContasFixas from "./pages/ContasFixas";
import Dashboard from "./pages/Dashboard";
import Entradas from "./pages/Entradas";
import Login from "./pages/Login";
import Metas from "./pages/Metas";
import Variaveis from "./pages/Variaveis";

const ABAS = [
  { para: "/", rotulo: "Início" },
  { para: "/fixas", rotulo: "Fixas" },
  { para: "/variaveis", rotulo: "Variáveis" },
  { para: "/entradas", rotulo: "Entradas" },
  { para: "/metas", rotulo: "Metas" },
  { para: "/calendario", rotulo: "Calendário" },
  { para: "/config", rotulo: "IA" },
];

export default function App() {
  const { pathname } = useLocation();
  if (!getToken() && pathname !== "/login") return <Navigate to="/login" replace />;
  if (pathname === "/login") return <Login />;

  return (
    <div className="layout">
      <header>
        <h1>FinControl</h1>
        <nav>
          {ABAS.map((a) => (
            <NavLink key={a.para} to={a.para} end={a.para === "/"}>
              {a.rotulo}
            </NavLink>
          ))}
          <button type="button" className="sair" onClick={logout}>Sair</button>
        </nav>
      </header>
      <main>
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
  );
}
