import { ChangeEvent, useState } from "react";
import { abrirAnexo, apiUpload } from "../api";
import { IcFechar } from "./icones";

type Props = {
  anexoId: number | null;
  onChange: (anexoId: number | null) => void;
};

/** Input de anexo (PDF/foto) — sobe o arquivo assim que selecionado e guarda o anexo_id. */
export default function AnexoCampo({ anexoId, onChange }: Props) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function selecionar(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (!arquivo) return;
    setErro(null);
    setEnviando(true);
    try {
      const r = await apiUpload<{ id: number }>("/anexos", arquivo);
      onChange(r.id);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <span className="anexo-campo">
      {anexoId ? (
        <>
          <button type="button" className="anexo-link" onClick={() => abrirAnexo(anexoId)}>
            📎 ver anexo
          </button>
          <button type="button" className="anexo-remover" onClick={() => onChange(null)} title="Remover anexo" aria-label="Remover anexo">
            <IcFechar width={15} height={15} />
          </button>
        </>
      ) : (
        <label className="anexo-upload">
          {enviando ? "Enviando…" : "📎 anexar"}
          <input
            type="file"
            accept="application/pdf,image/*"
            onChange={selecionar}
            disabled={enviando}
            hidden
          />
        </label>
      )}
      {erro && <span className="erro"> {erro}</span>}
    </span>
  );
}
