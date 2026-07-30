import { useEffect, useState } from "react";

export type Tema = "dark" | "light";

const CHAVE = "tema";

export function temaInicial(): Tema {
  const salvo = localStorage.getItem(CHAVE);
  if (salvo === "dark" || salvo === "light") return salvo;
  // Escuro é o tema padrão; o claro é opção manual (persistida ao alternar).
  return "dark";
}

export function aplicarTema(t: Tema) {
  document.documentElement.setAttribute("data-theme", t);
  // Mantém a barra do navegador/PWA em sincronia com o fundo.
  const cor = t === "dark" ? "#0a0a0c" : "#f7f7f8";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", cor);
}

export function useTema(): [Tema, () => void] {
  const [tema, setTema] = useState<Tema>(temaInicial);

  useEffect(() => {
    aplicarTema(tema);
    localStorage.setItem(CHAVE, tema);
  }, [tema]);

  return [tema, () => setTema((t) => (t === "dark" ? "light" : "dark"))];
}
