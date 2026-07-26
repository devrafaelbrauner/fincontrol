import { useEffect, useRef, useState } from "react";
import { brl } from "../api";

const reduzido = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Conta de 0 até o valor (em centavos) e formata em BRL. Respeita reduced-motion. */
export default function AnimatedNumber({ cents, duracao = 700 }: { cents: number; duracao?: number }) {
  const [atual, setAtual] = useState(reduzido() ? cents : 0);
  const anterior = useRef(0);

  useEffect(() => {
    if (reduzido()) {
      setAtual(cents);
      return;
    }
    const de = anterior.current;
    anterior.current = cents;
    let raf = 0;
    let inicio = 0;
    const passo = (t: number) => {
      if (!inicio) inicio = t;
      const p = Math.min((t - inicio) / duracao, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setAtual(Math.round(de + (cents - de) * eased));
      if (p < 1) raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, [cents, duracao]);

  return <span className="num">{brl(atual)}</span>;
}
