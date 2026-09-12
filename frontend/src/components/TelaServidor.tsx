import { FormEvent, useState } from "react";
import { definirServidor } from "../servidor";
import { limparSessao } from "../sessao";
import Logo from "./Logo";

/** Primeiro aviso (build nativo sem servidor configurado).
 *
 * Sem `VITE_API_BASE` bakeado e sem cofre, o app não tem para onde falar. Em vez
 * de estourar no import e deixar uma tela branca, pede o endereço uma vez; o
 * valor vai para o cofre e vale nas próximas aberturas. Trocar de servidor
 * encerra a sessão (as credenciais de um ambiente não valem no outro). */
export default function TelaServidor() {
  const [url, setUrl] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const limpa = url.trim().replace(/\/+$/, "");
    if (!/^https?:\/\/.+/i.test(limpa)) {
      setErro("Informe a URL completa do servidor, começando com https:// (ou http:// no teste local).");
      return;
    }
    setSalvando(true);
    await limparSessao();
    await definirServidor(limpa);
    window.location.reload();
  }

  return (
    <div className="auth-split">
      <div className="auth-form-side">
        <form className="auth-form" onSubmit={salvar} style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
          <span className="logo"><Logo tamanho={30} /></span>
          <h2>Servidor do FinControl</h2>
          <p className="sub">Este aplicativo ainda não sabe onde está o seu servidor. Informe o endereço uma vez.</p>
          <div className="campo">
            <label htmlFor="s-url">URL do servidor</label>
            <input id="s-url" type="url" inputMode="url" placeholder="https://fincontrol.exemplo.com"
              value={url} onChange={(e) => setUrl(e.target.value)} autoFocus autoComplete="url" required />
          </div>
          {erro && <div className="auth-erro">{erro}</div>}
          <button className="auth-entrar" type="submit" disabled={salvando}>
            {salvando ? "Salvando…" : "Salvar e continuar"}
          </button>
        </form>
      </div>
    </div>
  );
}
