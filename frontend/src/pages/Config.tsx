import { Capacitor } from "@capacitor/core";
import QRCode from "qrcode";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { cadastrarPasskey } from "../passkeys";

type IaConfig = { configurada: boolean; modelo: string };
type PushConfig = { habilitado: boolean; vapid_public: string | null; inscritos: number; hora_lembrete: number };
type Notificacao = { titulo: string; corpo: string };

/** base64url (chave VAPID) → Uint8Array para o applicationServerKey. */
function base64urlParaBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export default function Config() {
  const [cfg, setCfg] = useState<IaConfig | null>(null);
  const [chave, setChave] = useState("");
  const [modelo, setModelo] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [push, setPush] = useState<PushConfig | null>(null);
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  const [previa, setPrevia] = useState<Notificacao[] | null>(null);
  const [pushOcupado, setPushOcupado] = useState(false);

  const [mfaAtivo, setMfaAtivo] = useState<boolean | null>(null);
  const [mfaQr, setMfaQr] = useState<string | null>(null);
  const [mfaSecret, setMfaSecret] = useState("");
  const [mfaCodigo, setMfaCodigo] = useState("");
  const [mfaMsg, setMfaMsg] = useState<string | null>(null);

  type Passkey = { id: string; nome: string | null; criado_em: string; ultimo_uso_em: string | null };
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const [passkeyMsg, setPasskeyMsg] = useState<string | null>(null);
  const [passkeyNome, setPasskeyNome] = useState("");

  const carregarPasskeys = useCallback(() => {
    api<Passkey[]>("/auth/webauthn/credenciais").then(setPasskeys).catch(() => setPasskeys(null));
  }, []);

  const carregar = useCallback(() => {
    api<IaConfig>("/ia/config")
      .then((c) => {
        setCfg(c);
        setModelo(c.modelo);
      })
      .catch((e) => setErro(e.message));
    api<PushConfig>("/push/config").then(setPush).catch(() => setPush(null));
    api<{ ativo: boolean }>("/auth/mfa").then((m) => setMfaAtivo(m.ativo)).catch(() => setMfaAtivo(null));
  }, []);

  async function iniciarMfa() {
    setMfaMsg(null);
    try {
      const d = await api<{ secret: string; otpauth_uri: string }>("/auth/mfa/iniciar", { method: "POST", body: "{}" });
      setMfaSecret(d.secret);
      setMfaQr(await QRCode.toDataURL(d.otpauth_uri, { margin: 1, width: 200 }));
    } catch (e) { setMfaMsg((e as Error).message); }
  }

  async function confirmarMfa(e: FormEvent) {
    e.preventDefault();
    setMfaMsg(null);
    try {
      await api("/auth/mfa/confirmar", { method: "POST", body: JSON.stringify({ codigo: mfaCodigo }) });
      setMfaAtivo(true); setMfaQr(null); setMfaCodigo(""); setMfaMsg("MFA ativado. O código será exigido no próximo login.");
    } catch (e) { setMfaMsg((e as Error).message); }
  }

  async function desativarMfa(e: FormEvent) {
    e.preventDefault();
    setMfaMsg(null);
    try {
      await api("/auth/mfa/desativar", { method: "POST", body: JSON.stringify({ codigo: mfaCodigo }) });
      setMfaAtivo(false); setMfaCodigo(""); setMfaMsg("MFA desativado.");
    } catch (e) { setMfaMsg((e as Error).message); }
  }

  useEffect(carregar, [carregar]);
  useEffect(carregarPasskeys, [carregarPasskeys]);

  async function adicionarPasskey(e: FormEvent) {
    e.preventDefault();
    setPasskeyMsg(null);
    try {
      await cadastrarPasskey(passkeyNome.trim() || undefined);
      setPasskeyNome("");
      setPasskeyMsg("Passkey cadastrada neste aparelho.");
      carregarPasskeys();
    } catch (err) { setPasskeyMsg((err as Error).message); }
  }

  async function removerPasskey(id: string) {
    if (!confirm("Remover esta passkey? O aparelho perde o acesso sem senha.")) return;
    await api(`/auth/webauthn/credenciais/${id}`, { method: "DELETE" });
    carregarPasskeys();
  }

  async function ativarPush() {
    setPushMsg(null);
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        throw new Error("Este navegador não suporta notificações push.");
      }
      if (!push?.vapid_public) throw new Error("Push não está configurado no servidor.");
      const permissao = await Notification.requestPermission();
      if (permissao !== "granted") throw new Error("Permissão de notificação negada.");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64urlParaBytes(push.vapid_public),
      });
      await api("/push/subscribe", { method: "POST", body: JSON.stringify(sub.toJSON()) });
      setPushMsg("Notificações ativadas neste aparelho.");
    } catch (e) {
      setPushMsg((e as Error).message);
    }
  }

  async function testarPush() {
    setPushMsg(null);
    try {
      const r = await api<{ enviados: number }>("/push/testar", { method: "POST", body: "{}" });
      setPushMsg(`Enviado para ${r.enviados} aparelho(s).`);
    } catch (e) {
      setPushMsg((e as Error).message);
    }
  }

  /** Mostra o que o job do dia notificaria, sem enviar nem consumir o aviso. */
  async function verPrevia() {
    setPushMsg(null);
    setPushOcupado(true);
    try {
      const r = await api<{ notificacoes: Notificacao[] }>("/push/lembretes");
      setPrevia(r.notificacoes);
    } catch (e) {
      setPushMsg((e as Error).message);
    } finally {
      setPushOcupado(false);
    }
  }

  /** Roda o job agora e reenvia mesmo o que já saiu hoje — é o teste de verdade. */
  async function rodarLembretes() {
    setPushMsg(null);
    setPushOcupado(true);
    try {
      const r = await api<{ notificacoes: (Notificacao & { dispositivos: number })[]; motivo?: string }>(
        "/push/lembretes?forcar=true", { method: "POST", body: "{}" },
      );
      setPrevia(r.notificacoes);
      // "Enviada" tem que significar entregue a alguém: com zero aparelhos
      // inscritos, dizer "1 notificação enviada" esconde exatamente o problema
      // que este botão existe para diagnosticar.
      const aparelhos = r.notificacoes.reduce((s, n) => s + n.dispositivos, 0);
      setPushMsg(
        r.motivo ? `Nada enviado: ${r.motivo}. Ative as notificações neste aparelho primeiro.`
          : r.notificacoes.length === 0 ? "Nada a lembrar hoje — nenhum vencimento na janela."
          : aparelhos === 0 ? `${r.notificacoes.length} notificação(ões) preparada(s), mas nenhum aparelho recebeu — as inscrições podem ter expirado.`
          : `${r.notificacoes.length} notificação(ões) enviada(s) para ${aparelhos} aparelho(s).`,
      );
    } catch (e) {
      setPushMsg((e as Error).message);
    } finally {
      setPushOcupado(false);
    }
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setMsg(null);
    try {
      const body: { api_key?: string; modelo?: string } = { modelo };
      if (chave.trim()) body.api_key = chave.trim();
      await api("/ia/config", { method: "PUT", body: JSON.stringify(body) });
      setChave("");
      setMsg("Configuração salva.");
      carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  async function removerChave() {
    if (!confirm("Remover a chave do OpenRouter?")) return;
    await api("/ia/config", { method: "DELETE" });
    carregar();
  }

  return (
    <>
      <p className="sub">Integração de IA e notificações.</p>

      <section className="ficha surgir" style={{ maxWidth: 560 }}>
        <h3 className="secao-titulo">IA (OpenRouter)</h3>
        <p className="sub">
          A chave é criptografada no servidor e nunca volta ao navegador. Permite ler boletos/comprovantes por foto ou PDF, categorizar e gerar insights.
        </p>
        {cfg && (
          <p>Status:{" "}
            {cfg.configurada
              ? <strong className="positivo">chave configurada ••••</strong>
              : <strong className="negativo">nenhuma chave configurada</strong>}
          </p>
        )}
        <form onSubmit={salvar} className="campos">
          <div className="campo">
            <label htmlFor="c-chave">Chave OpenRouter</label>
            <input id="c-chave" type="password" autoComplete="off"
              placeholder={cfg?.configurada ? "Nova chave (em branco = manter)" : "sk-or-…"}
              value={chave} onChange={(e) => setChave(e.target.value)} />
          </div>
          <div className="campo">
            <label htmlFor="c-modelo">Modelo</label>
            <input id="c-modelo" placeholder="anthropic/claude-sonnet-4.5" value={modelo} onChange={(e) => setModelo(e.target.value)} />
          </div>
          <div className="acoes-modal">
            <button className="btn btn-primario" type="submit">Salvar</button>
            {cfg?.configurada && <button type="button" className="btn btn-perigo" onClick={removerChave}>Remover chave</button>}
          </div>
        </form>
        {msg && <p className="positivo">{msg}</p>}
        {erro && <p className="erro">{erro}</p>}
      </section>

      <section className="surgir secao" style={{ maxWidth: 560 }}>
        <h3 className="secao-titulo">Segurança (MFA)</h3>
        {mfaAtivo === null && <p className="sub">Carregando…</p>}
        {mfaAtivo === false && !mfaQr && (
          <>
            <p className="sub">Adicione um segundo fator (app autenticador) — mesmo com a senha vazada, ninguém entra sem o código.</p>
            <button className="btn btn-primario" onClick={iniciarMfa}>Ativar MFA</button>
          </>
        )}
        {mfaAtivo === false && mfaQr && (
          <form onSubmit={confirmarMfa} className="campos">
            <p className="sub">Escaneie com o Google Authenticator, 1Password ou similar e confirme o código.</p>
            <img src={mfaQr} alt="QR code do autenticador" style={{ alignSelf: "flex-start", borderRadius: 8, background: "#fff", padding: 6 }} />
            <p className="sub" style={{ fontSize: "0.75rem", wordBreak: "break-all" }}>Chave manual: <code>{mfaSecret}</code></p>
            <div className="campo"><label htmlFor="cfg-mfa">Código do app</label>
              <input id="cfg-mfa" inputMode="numeric" autoComplete="one-time-code" value={mfaCodigo} onChange={(e) => setMfaCodigo(e.target.value)} required /></div>
            <div className="acoes-modal">
              <button className="btn btn-primario" type="submit">Confirmar e ativar</button>
              <button className="btn" type="button" onClick={() => { setMfaQr(null); setMfaCodigo(""); }}>Cancelar</button>
            </div>
          </form>
        )}
        {mfaAtivo === true && (
          <form onSubmit={desativarMfa} className="campos">
            <p className="sub">MFA <strong style={{ color: "var(--positive)" }}>ativo</strong> — o login exige o código do autenticador.</p>
            <div className="campo"><label htmlFor="cfg-mfa-off">Código atual (para desativar)</label>
              <input id="cfg-mfa-off" inputMode="numeric" autoComplete="one-time-code" value={mfaCodigo} onChange={(e) => setMfaCodigo(e.target.value)} required /></div>
            <button className="btn btn-perigo" type="submit" style={{ alignSelf: "flex-start" }}>Desativar MFA</button>
          </form>
        )}
        {mfaMsg && <p style={{ marginTop: "0.5rem" }}>{mfaMsg}</p>}
      </section>

      <section className="surgir secao" style={{ maxWidth: 560 }}>
        <h3 className="secao-titulo">Passkeys</h3>
        <p className="sub">Um toque para entrar, sem senha — por aparelho. O TOTP continua valendo como segundo fator da senha.</p>
        {passkeys === null && <p className="sub">Carregando…</p>}
        {passkeys !== null && passkeys.length === 0 && (
          <p className="sub">Nenhuma passkey cadastrada. Cadastre a deste aparelho abaixo.</p>
        )}
        {passkeys !== null && passkeys.length > 0 && (
          <ul className="sub" style={{ paddingLeft: "1.1rem" }}>
            {passkeys.map((p) => (
              <li key={p.id}>
                <strong>{p.nome || "Sem nome"}</strong>
                {p.ultimo_uso_em ? ` — último uso ${p.ultimo_uso_em}` : " — nunca usada"}{" "}
                <button className="auth-secundario" type="button" style={{ height: "auto" }} onClick={() => removerPasskey(p.id)}>
                  remover
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={adicionarPasskey} className="linha-form" style={{ marginTop: "0.5rem" }}>
          <input placeholder="Nome deste aparelho (ex.: iPhone)" value={passkeyNome}
            onChange={(e) => setPasskeyNome(e.target.value)} style={{ maxWidth: 240 }} />
          <button className="btn btn-primario" type="submit">Cadastrar passkey aqui</button>
        </form>
        {passkeyMsg && <p style={{ marginTop: "0.5rem" }}>{passkeyMsg}</p>}
      </section>

      {/* WebView de app nativo não tem Web Push — no iPhone, o push exige a PWA
          instalada pela tela de início (iOS ≥ 16.4). */}
      {!Capacitor.isNativePlatform() && <section className="surgir secao" style={{ maxWidth: 560 }}>
        <h3 className="secao-titulo">Notificações push</h3>        {push?.habilitado ? (
          <>
            <p className="sub">Instale o app na tela inicial e ative as notificações para receber lembretes.</p>
            <p className="sub">
              Todo dia às {String(push.hora_lembrete).padStart(2, "0")}h o servidor avisa sobre contas a vencer
              (com a antecedência de cada conta), as que vencem no dia e as que ficaram em atraso.
              No dia 1, manda o resumo do mês fechado com os insights de IA.
              {push.inscritos > 0
                ? ` ${push.inscritos} aparelho(s) inscrito(s).`
                : " Nenhum aparelho inscrito ainda."}
            </p>
            <div className="linha-form">
              <button className="btn btn-primario" onClick={ativarPush}>Ativar notificações</button>
              <button className="btn" onClick={testarPush}>Enviar teste</button>
              <button className="btn" onClick={verPrevia} disabled={pushOcupado}>Ver lembretes de hoje</button>
              <button className="btn" onClick={rodarLembretes} disabled={pushOcupado}>Enviar agora</button>
            </div>
            {previa && (
              <ul className="sub" style={{ marginTop: "0.5rem", paddingLeft: "1.1rem" }}>
                {previa.length === 0 && <li>Nenhum lembrete devido hoje.</li>}
                {previa.map((n, i) => <li key={i}><strong>{n.titulo}</strong> — {n.corpo}</li>)}
              </ul>
            )}
            {pushMsg && <p style={{ marginTop: "0.5rem" }}>{pushMsg}</p>}
          </>
        ) : (
          <p className="sub">Push não está configurado no servidor (chaves VAPID ausentes). O calendário assinado continua sendo o lembrete principal.</p>
        )}
      </section>}
    </>
  );
}
