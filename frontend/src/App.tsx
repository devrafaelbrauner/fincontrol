import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { getToken } from "./api";
import Calendario from "./pages/Calendario";
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
        </Routes>
      </main>
    </div>
  );
}
