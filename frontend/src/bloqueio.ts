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

/** O login por senha termina recarregando a página, e a carga nova não é uma
 *  abertura a frio: quem acabou de digitar a senha não passa pela biometria.
 *  A marca fica na sessionStorage (morre com a janela: app fechado e reaberto
 *  tranca), vale uma carga só e por poucos segundos. */
const CHAVE_LOGIN_POR_SENHA = "fincontrol.login_por_senha";
export const VALIDADE_LOGIN_POR_SENHA_MS = 30 * 1000;

export function marcarLoginPorSenha(agora: number = Date.now()): void {
  try {
    sessionStorage.setItem(CHAVE_LOGIN_POR_SENHA, String(agora));
  } catch {
    // Melhor esforço: sem storage não há marca, e a carga decide como abertura a frio.
  }
}

/** Decide o bloqueio da carga: `protegido` (sessão + biometria) tranca, a não
 *  ser que a carga venha logo de um login por senha. Consome a marca sempre. */
export function bloquearNaCarga(protegido: boolean, agora: number = Date.now()): boolean {
  try {
    const idade = agora - Number(sessionStorage.getItem(CHAVE_LOGIN_POR_SENHA));
    sessionStorage.removeItem(CHAVE_LOGIN_POR_SENHA);
    return protegido && !(idade >= 0 && idade < VALIDADE_LOGIN_POR_SENHA_MS);
  } catch {
    return protegido; // storage indisponível: decide como sem marca
  }
}
