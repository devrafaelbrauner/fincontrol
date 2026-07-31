import { FormEvent, useState } from "react";
import { login } from "../api";
import Logo from "../components/Logo";

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
      <form onSubmit={entrar} className="card login-card surgir">
        <div className="marca-login">
          <span className="logo"><Logo tamanho={22} /></span>
          FinControl
        </div>
        <div className="campo">
          <label htmlFor="l-senha">Senha</label>
          <input id="l-senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoFocus required autoComplete="current-password" />
        </div>
        <div className="campo">
          <label htmlFor="l-2fa">Código 2FA <span style={{ color: "var(--content-3)" }}>(se ativado)</span></label>
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
