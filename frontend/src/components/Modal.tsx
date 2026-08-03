import { ReactNode, useEffect, useRef } from "react";
import { IcFechar } from "./icones";

type Props = { titulo: string; aberto: boolean; aoFechar: () => void; children: ReactNode };

// Pilha dos modais abertos: com dois empilhados (ex.: busca por cima de
// "Adicionar transação"), Esc e o trap de Tab só podem agir no de cima —
// sem isto um Esc fechava os dois e descartava o formulário meio-preenchido.
const pilha: symbol[] = [];

/** Modal (tela cheia no mobile) com Esc, clique fora e trap de foco. */
export default function Modal({ titulo, aberto, aoFechar, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const instancia = useRef(Symbol("modal"));
  // aoFechar costuma ser recriada a cada render; via ref ela não invalida o
  // efeito de foco (que refocaria o modal a cada tecla digitada)
  const fecharRef = useRef(aoFechar);
  useEffect(() => { fecharRef.current = aoFechar; }, [aoFechar]);

  useEffect(() => {
    if (!aberto) return;
    const eu = instancia.current;
    pilha.push(eu);
    const anterior = document.activeElement as HTMLElement | null;
    const alvo = ref.current?.querySelector<HTMLElement>("input, select, textarea")
      ?? ref.current?.querySelector<HTMLElement>("button");
    alvo?.focus();

    function onKey(e: KeyboardEvent) {
      if (pilha[pilha.length - 1] !== eu) return; // só o modal do topo reage
      if (e.key === "Escape") fecharRef.current();
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
      const i = pilha.indexOf(eu);
      if (i >= 0) pilha.splice(i, 1);
      document.removeEventListener("keydown", onKey);
      // O overflow só volta quando o ÚLTIMO modal fecha — senão fechar o de
      // cima devolveria o scroll com o de baixo ainda aberto.
      if (pilha.length === 0) document.body.style.overflow = "";
      anterior?.focus();
    };
  }, [aberto]);

  if (!aberto) return null;

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && aoFechar()}>
      <div className="modal" ref={ref} role="dialog" aria-modal="true" aria-label={titulo}>
        <button className="btn btn-icone modal-fechar" onClick={aoFechar} aria-label="Fechar"><IcFechar /></button>
        <h3>{titulo}</h3>
        {children}
      </div>
    </div>
  );
}
