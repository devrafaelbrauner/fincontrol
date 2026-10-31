import { useEffect, useState } from "react";
import type { EstadoBackend } from "../backendLocal";
import { isAndroidLocal } from "../plataforma";
import Logo from "./Logo";

/** Depois deste tempo em "iniciando" avisa que está lento — e segue esperando:
 *  quem decide a falha é a casca (que já tenta de novo), não um segundo prazo aqui. */
export const LENTO_MS = 8_000;

interface Props {
  estado: EstadoBackend;
  aoTentarDeNovo: () => Promise<void>;
  aoAbrirPasta?: () => Promise<void>;
}

/** Tela de boot do modo local enquanto o backend embutido sobe, ou falhou.
 *
 *  Sem backend não há dado para mostrar, por isso é tela cheia e não banner.
 *  Mesma moldura da tela de login, para parecer parte do app. No Android não há
 *  "Abrir pasta de dados": a pasta mora no armazenamento interno do app, que
 *  nenhum explorador abre sem root. */
export default function TelaBackend({ estado, aoTentarDeNovo, aoAbrirPasta }: Props) {
  const falhou = estado.estado === "falhou";
  const [lento, setLento] = useState(false);
  const [reiniciando, setReiniciando] = useState(false);
  // Quem esconde o botão no Android é o `!isAndroidLocal()` abaixo (`main.tsx`
  // passa `aoAbrirPasta` sempre); no desktop, só a presença do prop decide, e o
  // teste cobre sem `isAndroidLocal()`.
  const mostrarPasta = !isAndroidLocal() && aoAbrirPasta;

  useEffect(() => {
    setLento(false);
    if (falhou) return;
    const t = setTimeout(() => setLento(true), LENTO_MS);
    return () => clearTimeout(t);
  }, [falhou]);

  async function tentarDeNovo() {
    setReiniciando(true);
    try {
      await aoTentarDeNovo();
    } catch {
      // O resultado do reinício chega pelo evento do backend.
    } finally {
      setReiniciando(false);
    }
  }

  function abrirPasta() {
    // Conveniência: se o sistema não abrir, não há o que mostrar aqui.
    aoAbrirPasta?.().catch(() => {});
  }

  return (
    <div className="auth-split">
      <div className="auth-form-side">
        <div className="auth-form">
          <span className="logo"><Logo tamanho={30} /></span>
          {estado.estado === "falhou" ? (
            <div role="alert" className="campo" style={{ gap: "0.35rem" }}>
              <h2 className="tela-backend-titulo">Não foi possível iniciar o FinControl.</h2>
              <p className="sub">Seus dados não foram alterados.</p>
              <p className="tela-backend-motivo">{estado.motivo}</p>
            </div>
          ) : (
            <div role="status" className="tela-backend-status">
              <span className="tela-backend-giro" aria-hidden="true" />
              <div className="campo" style={{ gap: "0.35rem" }}>
                <h2>Abrindo o FinControl…</h2>
                {lento && <p className="sub">Está demorando mais que o normal.</p>}
              </div>
            </div>
          )}
          {falhou && (
            <>
              <button className="auth-entrar" type="button" disabled={reiniciando} onClick={tentarDeNovo}>
                {reiniciando ? "Tentando de novo…" : "Tentar de novo"}
              </button>
              {mostrarPasta && (
                <button className="auth-secundario" type="button" disabled={reiniciando} onClick={abrirPasta}>
                  Abrir pasta de dados
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
