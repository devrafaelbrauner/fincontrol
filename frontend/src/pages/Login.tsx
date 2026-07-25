import { FormEvent, useState } from "react";
import { api, setToken } from "../api";

export default function Login() {
  const [senha, setSenha] = useState("");
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    try {
      const { token } = await api<{ token: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ senha, codigo_totp: codigo || null }),
      });
      setToken(token);
      window.location.href = "/";
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  return (
    <div className="login-wrap">
      <form onSubmit={entrar} className="card login-card">
        <h1>FinControl</h1>
        <input
          type="password"
          placeholder="Senha"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          autoFocus
          required
        />
        <input
          inputMode="numeric"
          placeholder="Código 2FA (se ativado)"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
        />
        {erro && <p className="erro">{erro}</p>}
        <button type="submit">Entrar</button>
      </form>
    </div>
  );
}
