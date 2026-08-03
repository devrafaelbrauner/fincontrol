import QRCode from "qrcode";
import { FormEvent, ReactNode, useEffect, useState } from "react";
import { api, cadastrar, contaConfigurada, login } from "../api";
import Logo from "../components/Logo";

type Modo = "carregando" | "login" | "login-mfa" | "cadastro" | "mfa-qr";

/** Regras da senha exibidas e validadas em tempo real (o backend revalida).
 *  Espelha SENHA_MINIMA em backend/app/auth.py — mexeu lá, mexa aqui. */
const REGRAS: { rotulo: string; ok: (s: string) => boolean }[] = [
  { rotulo: "6+ caracteres", ok: (s) => s.length >= 6 },
  { rotulo: "letra", ok: (s) => /[A-Za-z]/.test(s) },
  { rotulo: "número", ok: (s) => /\d/.test(s) },
  { rotulo: "especial (!@#$…)", ok: (s) => /[^A-Za-z0-9]/.test(s) },
];

/** Painel esquerdo: marca, manchete e cards ilustrativos de vidro. */
function Hero() {
  return (
    <div className="auth-hero">
      <div className="marca">
        <span className="logo"><Logo tamanho={30} /></span>
        <span className="nome">FinControl</span>
      </div>
      <div className="auth-hero-meio">
        <h1>Suas finanças,<br />sob controle.</h1>
        <p className="frase">Acompanhe gastos, metas e investimentos em um só lugar — com segurança de ponta a ponta.</p>
        <div className="auth-mockups" aria-hidden="true">
          <div className="auth-vidro esq">
            <span className="titulo">Saldo total</span>
            <div className="valor">R$ 12.480</div>
            <div className="auth-barras">
              <span style={{ height: "38%" }} /><span style={{ height: "56%" }} /><span style={{ height: "44%" }} />
              <span style={{ height: "72%" }} /><span style={{ height: "100%" }} />
            </div>
          </div>
          <div className="auth-vidro centro">
            <div className="auth-linha-mini" style={{ marginBottom: "0.7rem" }}>
              <span className="titulo">Gastos do mês</span>
              <span style={{ fontWeight: 700, color: "#2ecc71" }}>−8%</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
              <svg width="72" height="72" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="14" fill="none" stroke="rgba(255,255,255,.14)" strokeWidth="5" />
                <circle cx="18" cy="18" r="14" fill="none" stroke="#3b82f6" strokeWidth="5" strokeDasharray="52 88" strokeLinecap="round" transform="rotate(-90 18 18)" />
                <circle cx="18" cy="18" r="14" fill="none" stroke="#2ecc71" strokeWidth="5" strokeDasharray="24 88" strokeDashoffset="-52" strokeLinecap="round" transform="rotate(-90 18 18)" />
              </svg>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                <span className="auth-legenda"><i style={{ background: "#3b82f6" }} />Casa</span>
                <span className="auth-legenda"><i style={{ background: "#2ecc71" }} />Lazer</span>
                <span className="auth-legenda"><i style={{ background: "rgba(255,255,255,.3)" }} />Outros</span>
              </div>
            </div>
            <div className="valor" style={{ fontSize: "1.1rem", marginTop: "0.7rem" }}>R$ 3.214</div>
          </div>
          <div className="auth-vidro dir">
            <span className="titulo">Meta · Viagem</span>
            <div className="valor" style={{ fontSize: "1.1rem" }}>R$ 4.100 <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#8b9ab5" }}>/ 6.000</span></div>
            <div className="auth-progresso"><span /></div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="auth-linha-mini"><span>Este mês</span><span style={{ fontWeight: 700, color: "#2ecc71" }}>+R$ 520</span></div>
              <div className="auth-linha-mini"><span>Faltam</span><span style={{ fontWeight: 700, color: "#fff" }}>R$ 1.900</span></div>
            </div>
          </div>
        </div>
      </div>
      <span className="rodape">© 2026 FinControl</span>
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="auth-split">
      <Hero />
      <div className="auth-form-side">
        <div className="auth-form">{children}</div>
      </div>
    </div>
  );
}

export default function Login() {
  const [modo, setModo] = useState<Modo>("carregando");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // App single-user: com conta criada, o cadastro só pode dar 409. Guardar o
  // estado é o que evita oferecer um caminho que nunca vai dar certo.
  const [jaTemConta, setJaTemConta] = useState(false);

  // login
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [verSenha, setVerSenha] = useState(false);
  const [lembrar, setLembrar] = useState(true);
  const [codigo, setCodigo] = useState("");
  const [dicaSenha, setDicaSenha] = useState(false);

  // cadastro
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");

  // mfa (adesão pós-cadastro)
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState("");

  useEffect(() => {
    contaConfigurada().then((tem) => {
      setJaTemConta(tem);
      setModo(tem ? "login" : "cadastro");
    });
  }, []);

  function falha(err: unknown) {
    const msg = (err as Error).message;
    if (msg === "codigo_totp_necessario") { setErro(null); setModo("login-mfa"); return; }
    setErro(msg);
  }

  async function entrar(e: FormEvent, codigo_totp: string | null = null) {
    e.preventDefault();
    setErro(null);
    setOcupado(true);
    try {
      await login({ email, senha, codigo_totp, lembrar });
      window.location.href = "/";
    } catch (err) {
      falha(err);
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
      setQr(await QRCode.toDataURL(dados.otpauth_uri, { margin: 1, width: 200 }));
      setModo("mfa-qr");
    } catch (err) {
      // 409: alguém já criou a conta (outra aba, ou o /status respondeu antes de
      // existir). Insistir no formulário é beco sem saída — leva para o login.
      const msg = (err as Error).message;
      if (msg.includes("Conta já configurada")) {
        setJaTemConta(true);
        setModo("login");
        setErro("Esta instância já tem uma conta. Entre com a sua senha.");
      } else {
        setErro(msg);
      }
    } finally {
      setOcupado(false);
    }
  }

  async function confirmarAdesaoMfa(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setOcupado(true);
    try {
      await api("/auth/mfa/confirmar", { method: "POST", body: JSON.stringify({ codigo }) });
      window.location.href = "/";
    } catch (err) {
      setErro((err as Error).message);
      setOcupado(false);
    }
  }

  if (modo === "carregando") {
    return <Shell><div className="skeleton" style={{ height: 260 }} /></Shell>;
  }

  if (modo === "login-mfa") {
    return (
      <Shell>
        <form onSubmit={(e) => entrar(e, codigo)} style={{ display: "contents" }}>
          <div className="campo" style={{ gap: "0.35rem" }}>
            <h2>Verificação em duas etapas</h2>
            <p className="sub">Digite o código de 6 dígitos do seu app autenticador</p>
          </div>
          <input className="codigo-mfa" inputMode="numeric" placeholder="000000" maxLength={6} autoFocus
            autoComplete="one-time-code" aria-label="Código de verificação"
            value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))} />
          {erro && <div className="auth-erro">{erro}</div>}
          <button className="auth-entrar" type="submit" disabled={ocupado || codigo.length !== 6}>
            {ocupado ? "Verificando…" : "Verificar"}
          </button>
          <button className="auth-secundario" type="button" onClick={() => { setModo("login"); setCodigo(""); setErro(null); }}>
            Voltar
          </button>
        </form>
      </Shell>
    );
  }

  if (modo === "mfa-qr") {
    return (
      <Shell>
        <form onSubmit={confirmarAdesaoMfa} style={{ display: "contents" }}>
          <div className="campo" style={{ gap: "0.35rem" }}>
            <h2>Proteja sua conta (MFA)</h2>
            <p className="sub">Escaneie com o Google Authenticator, 1Password ou similar e confirme o código de 6 dígitos.</p>
          </div>
          {qr && <img className="auth-qr" src={qr} alt="QR code do autenticador" />}
          <p className="sub" style={{ fontSize: "0.75rem", wordBreak: "break-all" }}>Sem câmera? Chave manual: <code>{secret}</code></p>
          <input className="codigo-mfa" inputMode="numeric" placeholder="000000" maxLength={6} required
            autoComplete="one-time-code" aria-label="Código do app autenticador"
            value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))} />
          {erro && <div className="auth-erro">{erro}</div>}
          <button className="auth-entrar" type="submit" disabled={ocupado || codigo.length !== 6}>
            {ocupado ? "Confirmando…" : "Ativar MFA e entrar"}
          </button>
          <button className="auth-secundario" type="button" onClick={() => { window.location.href = "/"; }}>
            Pular por enquanto
          </button>
        </form>
      </Shell>
    );
  }

  if (modo === "cadastro") {
    return (
      <Shell>
        <form onSubmit={criarConta} style={{ display: "contents" }}>
          <div className="campo" style={{ gap: "0.35rem" }}>
            <h2>Criar sua conta</h2>
            <p className="sub">Primeiro acesso: os dados ficam só no seu servidor.</p>
          </div>
          <div className="campo">
            <label htmlFor="c-nome">Nome</label>
            <input id="c-nome" value={nome} onChange={(e) => setNome(e.target.value)} required autoFocus autoComplete="name" />
          </div>
          <div className="campo">
            <label htmlFor="c-tel">Telefone <span style={{ color: "#9aa3b2", fontWeight: 500 }}>(opcional)</span></label>
            <input id="c-tel" type="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} autoComplete="tel" />
          </div>
          <div className="campo">
            <label htmlFor="c-email">E-mail</label>
            <input id="c-email" type="email" placeholder="voce@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </div>
          <div className="campo">
            <label htmlFor="c-senha">Senha</label>
            <div className="auth-senha-wrap">
              <input id="c-senha" type={verSenha ? "text" : "password"} value={novaSenha}
                onChange={(e) => setNovaSenha(e.target.value)} required autoComplete="new-password" />
              <button className="auth-ver" type="button" onClick={() => setVerSenha((v) => !v)}>{verSenha ? "ocultar" : "ver"}</button>
            </div>
            <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginTop: "0.2rem" }}>
              {REGRAS.map((r) => (
                <span key={r.rotulo} className={`chip${r.ok(novaSenha) ? " ok" : ""}`}>
                  {r.ok(novaSenha) ? "✓ " : ""}{r.rotulo}
                </span>
              ))}
            </div>
          </div>
          <div className="campo">
            <label htmlFor="c-conf">Confirmar senha</label>
            <input id="c-conf" type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} required autoComplete="new-password" />
          </div>
          {erro && <div className="auth-erro">{erro}</div>}
          <button className="auth-entrar" type="submit" disabled={ocupado}>
            {ocupado ? "Criando…" : "Criar conta"}
          </button>
          <p className="auth-troca">Já tem conta? <a href="#" onClick={(e) => { e.preventDefault(); setErro(null); setModo("login"); }}>Entrar</a></p>
        </form>
      </Shell>
    );
  }

  return (
    <Shell>
      <form onSubmit={entrar} style={{ display: "contents" }}>
        <div className="campo" style={{ gap: "0.35rem", marginBottom: "0.3rem" }}>
          <h2>Bem-vindo de volta</h2>
          <p className="sub">Entre na sua conta para continuar</p>
        </div>
        <div className="campo">
          <label htmlFor="l-email">E-mail</label>
          <input id="l-email" type="email" inputMode="email" placeholder="voce@email.com"
            value={email} onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete="email" />
        </div>
        <div className="campo">
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <label htmlFor="l-senha">Senha</label>
            <a href="#" onClick={(e) => { e.preventDefault(); setDicaSenha((v) => !v); }}>Esqueci a senha</a>
          </div>
          <div className="auth-senha-wrap">
            <input id="l-senha" type={verSenha ? "text" : "password"} placeholder="Sua senha"
              value={senha} onChange={(e) => setSenha(e.target.value)} required autoComplete="current-password" />
            <button className="auth-ver" type="button" onClick={() => setVerSenha((v) => !v)}>{verSenha ? "ocultar" : "ver"}</button>
          </div>
          {dicaSenha && (
            <p className="sub" style={{ fontSize: "0.78rem" }}>
              App pessoal, sem recuperação por e-mail: redefina no servidor com <code>python -m app.setup_user</code>.
            </p>
          )}
        </div>
        {erro && <div className="auth-erro">{erro}</div>}
        <label className="auth-lembrar">
          <input type="checkbox" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} />
          Manter conectado
        </label>
        <button className="auth-entrar" type="submit" disabled={ocupado}>
          {ocupado ? "Entrando…" : "Entrar"}
        </button>
        {/* Sem conta ainda, o app já abre no cadastro; o link cobre o caso de o
            /status ter falhado e caído no login por precaução. Com conta criada
            ele some — levava a um formulário que só sabia responder 409. */}
        {!jaTemConta && (
          <p className="auth-troca">Não tem conta? <a href="#" onClick={(e) => { e.preventDefault(); setErro(null); setModo("cadastro"); }}>Criar conta</a></p>
        )}
      </form>
    </Shell>
  );
}
