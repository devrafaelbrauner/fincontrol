import QRCode from "qrcode";
import { FormEvent, useEffect, useState } from "react";
import { api, cadastrar, contaConfigurada, login } from "../api";
import Logo from "../components/Logo";

type Modo = "carregando" | "login" | "cadastro" | "mfa";

/** Regras da senha exibidas e validadas em tempo real (o backend revalida).
 *  Espelha SENHA_MINIMA em backend/app/auth.py — mexeu lá, mexa aqui. */
const REGRAS: { rotulo: string; ok: (s: string) => boolean }[] = [
  { rotulo: "12+ caracteres", ok: (s) => s.length >= 12 },
  { rotulo: "letra", ok: (s) => /[A-Za-z]/.test(s) },
  { rotulo: "número", ok: (s) => /\d/.test(s) },
  { rotulo: "especial (!@#$…)", ok: (s) => /[^A-Za-z0-9]/.test(s) },
];

export default function Login() {
  const [modo, setModo] = useState<Modo>("carregando");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // login
  const [senha, setSenha] = useState("");
  const [codigo, setCodigo] = useState("");

  // cadastro
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");

  // mfa
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [codigoMfa, setCodigoMfa] = useState("");

  useEffect(() => {
    contaConfigurada().then((tem) => setModo(tem ? "login" : "cadastro"));
  }, []);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setOcupado(true);
    try {
      await login(senha, codigo || null);
      window.location.href = "/";
    } catch (err) {
      setErro((err as Error).message);
      setOcupado(false);
    }
  }

  async function criarConta(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (novaSenha !== confirmar) { setErro("As senhas não conferem."); return; }
    if (!REGRAS.every((r) => r.ok(novaSenha))) { setErro("A senha não cumpre as regras abaixo do campo."); return; }
    setOcupado(true);
    try {
      await cadastrar({ nome, telefone, email, senha: novaSenha });
      // Conta criada e sessão aberta — oferece o MFA antes de entrar.
      const dados = await api<{ secret: string; otpauth_uri: string }>("/auth/mfa/iniciar", { method: "POST", body: "{}" });
      setSecret(dados.secret);
      setQr(await QRCode.toDataURL(dados.otpauth_uri, { margin: 1, width: 220 }));
      setModo("mfa");
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function confirmarMfa(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setOcupado(true);
    try {
      await api("/auth/mfa/confirmar", { method: "POST", body: JSON.stringify({ codigo: codigoMfa }) });
      window.location.href = "/";
    } catch (err) {
      setErro((err as Error).message);
      setOcupado(false);
    }
  }

  const marca = (
    <div className="marca-login">
      <span className="logo"><Logo tamanho={22} /></span>
      FinControl
    </div>
  );

  if (modo === "carregando") {
    return <div className="login-wrap"><div className="card login-card"><div className="skeleton" style={{ height: 180 }} /></div></div>;
  }

  if (modo === "mfa") {
    return (
      <div className="login-wrap">
        <form onSubmit={confirmarMfa} className="card login-card surgir">
          {marca}
          <h3 style={{ marginBottom: "0.25rem" }}>Proteja sua conta (MFA)</h3>
          <p className="sub">Escaneie com o Google Authenticator, 1Password ou similar e confirme o código de 6 dígitos.</p>
          {qr && <img src={qr} alt="QR code do autenticador" style={{ alignSelf: "center", borderRadius: 8, background: "#fff", padding: 6 }} />}
          <p className="sub" style={{ fontSize: "0.75rem", wordBreak: "break-all" }}>Sem câmera? Chave manual: <code>{secret}</code></p>
          <div className="campo">
            <label htmlFor="c-mfa">Código do app</label>
            <input id="c-mfa" inputMode="numeric" autoComplete="one-time-code" value={codigoMfa}
              onChange={(e) => setCodigoMfa(e.target.value)} required autoFocus />
          </div>
          {erro && <p className="erro">{erro}</p>}
          <button className="btn btn-primario" type="submit" disabled={ocupado} style={{ padding: "0.65rem" }}>
            {ocupado ? "Confirmando…" : "Ativar MFA e entrar"}
          </button>
          <button className="btn" type="button" onClick={() => { window.location.href = "/"; }}>
            Pular por enquanto
          </button>
        </form>
      </div>
    );
  }

  if (modo === "cadastro") {
    return (
      <div className="login-wrap">
        <form onSubmit={criarConta} className="card login-card surgir">
          {marca}
          <h3 style={{ marginBottom: "0.25rem" }}>Criar sua conta</h3>
          <p className="sub">Primeiro acesso: os dados ficam só no seu servidor.</p>
          <div className="campo">
            <label htmlFor="c-nome">Nome</label>
            <input id="c-nome" value={nome} onChange={(e) => setNome(e.target.value)} required autoFocus autoComplete="name" />
          </div>
          <div className="campo">
            <label htmlFor="c-tel">Telefone <span style={{ color: "var(--content-3)" }}>(opcional)</span></label>
            <input id="c-tel" type="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} autoComplete="tel" />
          </div>
          <div className="campo">
            <label htmlFor="c-email">E-mail</label>
            <input id="c-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </div>
          <div className="campo">
            <label htmlFor="c-senha">Senha</label>
            <input id="c-senha" type="password" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} required autoComplete="new-password" />
            <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginTop: "0.35rem" }}>
              {REGRAS.map((r) => (
                <span key={r.rotulo} className="chip" style={r.ok(novaSenha)
                  ? { borderColor: "var(--positive)", color: "var(--positive)" } : undefined}>
                  {r.ok(novaSenha) ? "✓ " : ""}{r.rotulo}
                </span>
              ))}
            </div>
          </div>
          <div className="campo">
            <label htmlFor="c-conf">Confirmar senha</label>
            <input id="c-conf" type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} required autoComplete="new-password" />
          </div>
          {erro && <p className="erro">{erro}</p>}
          <button className="btn btn-primario" type="submit" disabled={ocupado} style={{ padding: "0.65rem" }}>
            {ocupado ? "Criando…" : "Criar conta"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <form onSubmit={entrar} className="card login-card surgir">
        {marca}
        <div className="campo">
          <label htmlFor="l-senha">Senha</label>
          <input id="l-senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoFocus required autoComplete="current-password" />
        </div>
        <div className="campo">
          <label htmlFor="l-2fa">Código 2FA <span style={{ color: "var(--content-3)" }}>(se ativado)</span></label>
          <input id="l-2fa" inputMode="numeric" value={codigo} onChange={(e) => setCodigo(e.target.value)} autoComplete="one-time-code" />
        </div>
        {erro && <p className="erro">{erro}</p>}
        <button className="btn btn-primario" type="submit" disabled={ocupado} style={{ padding: "0.65rem" }}>
          {ocupado ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
