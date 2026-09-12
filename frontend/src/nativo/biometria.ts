import { isCapacitorNativo, isTauri } from "../plataforma";

/** Biometria do aparelho (Face ID / Touch ID / Windows Hello / digital).
 *
 * Só existe no nativo — no web a passkey já é o caminho sem senha, e o PWA não
 * tem como pedir biometria de sistema. Tudo aqui degrada para `false` em vez de
 * lançar: a ausência de biometria não pode impedir o login por senha. */

export async function biometriaDisponivel(): Promise<boolean> {
  try {
    if (isTauri()) {
      const { checkStatus } = await import("@choochmeque/tauri-plugin-biometry-api");
      return Boolean((await checkStatus()).isAvailable);
    }
    if (isCapacitorNativo()) {
      const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
      return Boolean((await BiometricAuth.checkBiometry()).isAvailable);
    }
  } catch {
    // Plugin ausente, aparelho sem sensor, ou ponte indisponível: seguir sem.
  }
  return false;
}

/** Pede a biometria. `true` só quando o dono autenticou de fato. */
export async function autenticarBiometrico(motivo: string): Promise<boolean> {
  try {
    if (isTauri()) {
      const { authenticate } = await import("@choochmeque/tauri-plugin-biometry-api");
      await authenticate(motivo, { allowDeviceCredential: false });
      return true;
    }
    if (isCapacitorNativo()) {
      const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
      await BiometricAuth.authenticate({
        reason: motivo,
        cancelTitle: "Cancelar",
        // Sem credencial do aparelho: o fallback do app é a senha + TOTP, não o
        // PIN do telefone (que abriria o app sem passar pelo backend).
        allowDeviceCredential: false,
      });
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
