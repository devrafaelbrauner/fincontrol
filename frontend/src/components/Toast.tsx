import { createContext, ReactNode, useCallback, useContext, useState } from "react";

type Tipo = "ok" | "erro";
type Item = { id: number; tipo: Tipo; texto: string };

const Ctx = createContext<(texto: string, tipo?: Tipo) => void>(() => {});

let seq = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [itens, setItens] = useState<Item[]>([]);

  const mostrar = useCallback((texto: string, tipo: Tipo = "ok") => {
    const id = seq++;
    setItens((l) => [...l, { id, tipo, texto }]);
    setTimeout(() => setItens((l) => l.filter((t) => t.id !== id)), 3500);
  }, []);

  return (
    <Ctx.Provider value={mostrar}>
      {children}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {itens.map((t) => (
          <div key={t.id} className={`glass glass-forte toast ${t.tipo}`} role="status">
            <span>{t.tipo === "ok" ? "✓" : "⚠"}</span>
            <span>{t.texto}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}
