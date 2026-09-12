import { useEffect, useState, useSyncExternalStore } from "react";
import { sincronizar } from "../api";
import { atualizarContadores, estadoOffline, subscreverOffline } from "../offline/estadoOffline";
import { conflitos as listarConflitos, descartarConflito, type ItemFila, reativarSemIfMatch } from "../offline/fila";

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** Barra de status offline + resolução de conflitos de edição.
 *
 * Sem conexão, diz que os dados são de hora X (nunca finge que são atuais) e
 * quantas escritas estão na fila. Com conflito, mostra item a item para o dono
 * escolher: aceitar o que está no servidor ou sobrepor a própria edição. Nada é
 * descartado sem essa escolha. */
export default function OfflineBar() {
  const estado = useSyncExternalStore(subscreverOffline, estadoOffline);
  const [itens, setItens] = useState<ItemFila[]>([]);

  useEffect(() => {
    if (estado.conflitos === 0) { setItens([]); return; }
    listarConflitos().then(setItens);
  }, [estado.conflitos]);

  async function aceitarServidor(id: number) {
    await descartarConflito(id);
    await atualizarContadores();
    if (typeof window !== "undefined") window.dispatchEvent(new Event("fincontrol:atualizar"));
  }

  async function manterMinha(id: number) {
    await reativarSemIfMatch(id);
    await atualizarContadores();
    await sincronizar();
  }

  if (!estado.offline && estado.pendentes === 0 && estado.conflitos === 0) return null;

  return (
    <div className="offline-barra" role="status">
      {estado.offline && (
        <span className="offline-texto">
          Sem conexão — mostrando dados salvos{estado.cacheEm ? ` de ${hora(estado.cacheEm)}` : ""}.
        </span>
      )}
      {estado.pendentes > 0 && (
        <span className="offline-texto">{estado.pendentes} alteração(ões) aguardando conexão.</span>
      )}
      {estado.conflitos > 0 && (
        <div className="offline-conflitos">
          <strong>{estado.conflitos} edição(ões) em conflito</strong>
          <ul>
            {itens.map((i) => (
              <li key={i.id}>
                <span>{i.method} {i.path}</span>
                <button className="btn" onClick={() => aceitarServidor(i.id)}>Atualizar dados</button>
                <button className="btn btn-perigo" onClick={() => manterMinha(i.id)}>Manter minha edição</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
