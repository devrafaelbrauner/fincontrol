import { FormEvent, useState } from "react";
import { login } from "../api";

export default function Login() {
  const [senha, setSenha] = useState("");
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEntrando(true);
    try {
      await login(senha, codigo || null);
      window.location.href = "/";
    } catch (err) {
      setErro((err as Error).message);
      setEntrando(false);
    }
  }

  return (
    <div className="login-wrap">
      <form onSubmit={entrar} className="glass glass-forte card login-card surgir">
        <div className="marca-login">
          <span className="logo" style={{ width: 40, height: 40, borderRadius: 13, display: "grid", placeItems: "center", color: "#fff", background: "linear-gradient(135deg, var(--azul), var(--verde-forte))" }}>R$</span>
          FinControl
        </div>
        <div className="campo">
          <label htmlFor="l-senha">Senha</label>
          <input id="l-senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoFocus required autoComplete="current-password" />
        </div>
        <div className="campo">
          <label htmlFor="l-2fa">Código 2FA <span style={{ color: "var(--texto-3)" }}>(se ativado)</span></label>
          <input id="l-2fa" inputMode="numeric" value={codigo} onChange={(e) => setCodigo(e.target.value)} autoComplete="one-time-code" />
        </div>
        {erro && <p className="erro">{erro}</p>}
        <button className="btn btn-primario" type="submit" disabled={entrando} style={{ padding: "0.65rem" }}>
          {entrando ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
