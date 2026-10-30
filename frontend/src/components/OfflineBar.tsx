import { useEffect, useState, useSyncExternalStore } from "react";
import { sincronizar } from "../api";
import { atualizarContadores, estadoOffline, subscreverOffline } from "../offline/estadoOffline";
import { conflitos as listarConflitos, descartarConflito, type ItemFila, reativarSemIfMatch } from "../offline/fila";
import { isDesktopLocal } from "../plataforma";

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** Barra de status offline + resolução de conflitos de edição.
 *
 * Sem resposta da API (sem conexão na web/Capacitor; no desktop, o backend
 * local reiniciando), diz que os dados são de hora X (nunca finge que são
 * atuais) e quantas escritas estão na fila. Com conflito, mostra item a item
 * para o dono escolher: aceitar o que está salvo no backend ou sobrepor a
 * própria edição. Nada é descartado sem essa escolha. */
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

  // Desktop: quem some é o backend deste computador, não a rede.
  const desktop = isDesktopLocal();
  const desde = estado.cacheEm ? ` de ${hora(estado.cacheEm)}` : "";

  return (
    <div className="offline-barra" role="status">
      {estado.offline && (
        <span className="offline-texto">
          {desktop
            ? `O FinControl está reiniciando — mostrando dados salvos${desde}.`
            : `Sem conexão — mostrando dados salvos${desde}.`}
        </span>
      )}
      {estado.pendentes > 0 && (
        <span className="offline-texto">
          {desktop
            ? `${estado.pendentes} alteração(ões) aguardando o FinControl voltar.`
            : `${estado.pendentes} alteração(ões) aguardando conexão.`}
        </span>
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
