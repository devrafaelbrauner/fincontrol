import { FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { resetarOrdem } from "../ordem";

type IaConfig = { configurada: boolean; modelo: string };
type PushConfig = { habilitado: boolean; vapid_public: string | null };

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
  const [ordemMsg, setOrdemMsg] = useState<string | null>(null);

  const carregar = useCallback(() => {
    api<IaConfig>("/ia/config")
      .then((c) => {
        setCfg(c);
        setModelo(c.modelo);
      })
      .catch((e) => setErro(e.message));
    api<PushConfig>("/push/config").then(setPush).catch(() => setPush(null));
  }, []);

  useEffect(carregar, [carregar]);

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
      <h2>Configurações</h2>
      <p className="sub">Integração de IA e notificações.</p>

      <section className="glass card surgir" style={{ maxWidth: 560 }}>
        <h3>IA (OpenRouter)</h3>
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

      <section className="glass card surgir secao" style={{ maxWidth: 560 }}>
        <h3>Notificações push</h3>
        {push?.habilitado ? (
          <>
            <p className="sub">Instale o app na tela inicial e ative as notificações para receber lembretes.</p>
            <div className="linha-form">
              <button className="btn btn-primario" onClick={ativarPush}>Ativar notificações</button>
              <button className="btn" onClick={testarPush}>Enviar teste</button>
            </div>
            {pushMsg && <p style={{ marginTop: "0.5rem" }}>{pushMsg}</p>}
          </>
        ) : (
          <p className="sub">Push não está configurado no servidor (chaves VAPID ausentes). O calendário assinado continua sendo o lembrete principal.</p>
        )}
      </section>

      <section className="glass card surgir secao" style={{ maxWidth: 560 }}>
        <h3>Barra lateral</h3>
        <p className="sub">Você pode reordenar os itens do menu arrastando pela alça (ou com ↑/↓ pelo teclado). Para voltar ao layout original:</p>
        <button className="btn" onClick={() => { resetarOrdem(); setOrdemMsg("Ordem padrão restaurada."); }}>
          Restaurar ordem padrão
        </button>
        {ordemMsg && <p className="positivo" style={{ marginTop: "0.5rem" }}>{ordemMsg}</p>}
      </section>
    </>
  );
}
