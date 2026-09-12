import { useEffect, useState } from "react";
import { api } from "../api";
import { isCapacitorNativo } from "../plataforma";

/** Aviso de versão nova no app Capacitor (iOS/Android).
 *
 * Não há live-update: o bundle nativo carrega a versão que instalou. Quando o
 * servidor responde uma `VERSÃO` diferente da empacotada, mostramos o link do
 * release público — é o único caminho de atualizar sem passar pela loja.
 * No desktop quem cuida disso é o updater assinado (aba Config → Atualizações). */

const RELEASES = "https://github.com/devrafaelbrauner/fincontrol-releases/releases/latest";

export default function BannerVersao() {
  const [desatualizado, setDesatualizado] = useState(false);

  useEffect(() => {
    if (!isCapacitorNativo()) return;
    let vivo = true;
    api<{ versao: string }>("/versao")
      .then((r) => { if (vivo && r.versao && r.versao !== __APP_VERSION__) setDesatualizado(true); })
      .catch(() => { /* offline/erro: sem aviso falso */ });
    return () => { vivo = false; };
  }, []);

  if (!desatualizado) return null;

  return (
    <div className="offline-barra" role="status">
      <span className="offline-texto">Há uma versão nova do aplicativo.</span>
      <a className="btn" href={RELEASES} target="_blank" rel="noreferrer">Baixar atualização</a>
    </div>
  );
}
