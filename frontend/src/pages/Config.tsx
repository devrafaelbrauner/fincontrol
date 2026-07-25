import { FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "../api";

type IaConfig = { configurada: boolean; modelo: string };

export default function Config() {
  const [cfg, setCfg] = useState<IaConfig | null>(null);
  const [chave, setChave] = useState("");
  const [modelo, setModelo] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    api<IaConfig>("/ia/config")
      .then((c) => {
        setCfg(c);
        setModelo(c.modelo);
      })
      .catch((e) => setErro(e.message));
  }, []);

  useEffect(carregar, [carregar]);

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
      <h2>IA (OpenRouter)</h2>
      <p>
        A chave é criptografada no servidor e nunca volta ao navegador. Ela permite ler boletos e
        comprovantes por foto/PDF e sugerir categorias automaticamente.
      </p>
      {cfg && (
        <p>
          Status:{" "}
          {cfg.configurada ? (
            <strong className="positivo">chave configurada ••••</strong>
          ) : (
            <strong className="negativo">nenhuma chave configurada</strong>
          )}
        </p>
      )}

      <form onSubmit={salvar} className="login-card">
        <input
          type="password"
          placeholder={cfg?.configurada ? "Nova chave (deixe em branco para manter)" : "Chave do OpenRouter (sk-or-…)"}
          value={chave}
          onChange={(e) => setChave(e.target.value)}
          autoComplete="off"
        />
        <input placeholder="Modelo (ex: anthropic/claude-sonnet-4.5)" value={modelo} onChange={(e) => setModelo(e.target.value)} />
        <button type="submit">Salvar</button>
      </form>
      {cfg?.configurada && (
        <p><button className="botao-perigo" onClick={removerChave}>Remover chave</button></p>
      )}
      {msg && <p className="positivo">{msg}</p>}
      {erro && <p className="erro">{erro}</p>}
    </>
  );
}
