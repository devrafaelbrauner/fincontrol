// Janela unica do FinControl. O estado global se resume ao proprio handle do
// Tauri: sessoes e dados vivem no backend. O unico estado LOCAL sao os segredos
// de sessao, guardados no cofre do sistema (Keychain/Credential Manager).

const SERVICO: &str = "com.rafaelbrauner.fincontrol";

/// Le um segredo do cofre. Ausente = `None` (reautenticar), nunca erro fatal.
#[tauri::command]
fn cofre_ler(chave: String) -> Result<Option<String>, String> {
    let entrada = keyring::Entry::new(SERVICO, &chave).map_err(|e| e.to_string())?;
    match entrada.get_password() {
        Ok(valor) => Ok(Some(valor)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Grava um segredo no cofre do aparelho.
#[tauri::command]
fn cofre_gravar(chave: String, valor: String) -> Result<(), String> {
    keyring::Entry::new(SERVICO, &chave)
        .map_err(|e| e.to_string())?
        .set_password(&valor)
        .map_err(|e| e.to_string())
}

/// Apaga um segredo. Já ausente não é erro: o logout é idempotente.
#[tauri::command]
fn cofre_apagar(chave: String) -> Result<(), String> {
    let entrada = keyring::Entry::new(SERVICO, &chave).map_err(|e| e.to_string())?;
    match entrada.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn run() {
    tauri::Builder::default()
        // `window.open` (anexos via abrirAnexo) e `mailto:` saem no navegador do
        // sistema, nao numa segunda janela sem chrome.
        .plugin(tauri_plugin_opener::init())
        // Biometria: gate de abertura a frio e de resume (Touch ID/Hello).
        .plugin(tauri_plugin_biometry::init())
        // Atualização assinada (repo público de releases) e reboot pós-install.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![cofre_ler, cofre_gravar, cofre_apagar])
        .run(tauri::generate_context!())
        .expect("FinControl: falha ao iniciar o runtime Tauri");
}
