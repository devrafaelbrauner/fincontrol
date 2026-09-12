import { useEffect, useRef, useState } from "react";
import { autenticarBiometrico } from "../nativo/biometria";
import Logo from "./Logo";

/** Tela de bloqueio: pede a biometria antes de mostrar qualquer dado.
 *
 * A tentativa começa sozinha na montagem — quem abriu o app já espera o prompt.
 * Cancelar ou falhar NÃO é um erro fatal: leva para o login por senha + TOTP,
 * que é o que o plano define como fallback (a passkey é o fallback do web). */
export default function Bloqueio({ aoDesbloquear, aoFalhar }: {
  aoDesbloquear: () => void;
  aoFalhar: () => void;
}) {
  const [tentando, setTentando] = useState(true);
  const montado = useRef(true);

  async function tentar() {
    setTentando(true);
    const ok = await autenticarBiometrico("Desbloqueie o FinControl");
    if (!montado.current) return;
    setTentando(false);
    if (ok) aoDesbloquear();
  }

  useEffect(() => {
    montado.current = true;
    tentar();
    return () => { montado.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="auth-split">
      <div className="auth-form-side">
        <div className="auth-form" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
          <span className="logo"><Logo tamanho={34} /></span>
          <h2>FinControl bloqueado</h2>
          <p className="sub" style={{ textAlign: "center" }}>
            {tentando ? "Confirme sua identidade para continuar." : "Não foi possível desbloquear."}
          </p>
          <button className="auth-entrar" type="button" onClick={tentar} disabled={tentando}>
            {tentando ? "Verificando…" : "Tentar novamente"}
          </button>
          <button className="auth-secundario" type="button" onClick={aoFalhar}>Entrar com senha</button>
        </div>
      </div>
    </div>
  );
}
