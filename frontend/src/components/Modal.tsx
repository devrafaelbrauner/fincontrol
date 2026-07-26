import { ReactNode, useEffect, useRef } from "react";
import { IcFechar } from "./icones";

type Props = { titulo: string; aberto: boolean; aoFechar: () => void; children: ReactNode };

/** Modal de vidro (tela cheia no mobile) com Esc, clique fora e trap de foco. */
export default function Modal({ titulo, aberto, aoFechar, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const anterior = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") aoFechar();
      if (e.key === "Tab" && ref.current) {
        const foca = ref.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (foca.length === 0) return;
        const primeiro = foca[0];
        const ultimo = foca[foca.length - 1];
        if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
        else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
      }
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      anterior?.focus();
    };
  }, [aberto, aoFechar]);

  if (!aberto) return null;

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && aoFechar()}>
      <div className="glass glass-forte modal" ref={ref} role="dialog" aria-modal="true" aria-label={titulo}>
        <button className="btn btn-icone modal-fechar" onClick={aoFechar} aria-label="Fechar"><IcFechar /></button>
        <h3>{titulo}</h3>
        {children}
      </div>
    </div>
  );
}
