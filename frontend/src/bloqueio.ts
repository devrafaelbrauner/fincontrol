/** Gate de desbloqueio: abertura a frio e resume depois de 5 minutos.
 *
 * O relógio é de INATIVIDADE — não basta o app voltar ao primeiro plano; se ele
 * ficou escondido menos que o limite, não se pede biometria de novo (o que
 * tornaria o uso normal insuportável). O web não passa por aqui: lá o caminho
 * sem senha é a passkey. */

export const LIMITE_RESUME_MS = 5 * 60 * 1000;

let ultimaAtividade = Date.now();

export function marcarAtividade(agora: number = Date.now()): void {
  ultimaAtividade = agora;
}

export function decorridos(agora: number = Date.now()): number {
  return agora - ultimaAtividade;
}

export function precisaDesbloquear(agora: number = Date.now()): boolean {
  return decorridos(agora) >= LIMITE_RESUME_MS;
}
