// Janela unica do FinControl. Estado LOCAL: os segredos de sessao no cofre do
// sistema (Keychain/Credential Manager) e o backend embutido (sidecar FastAPI,
// ver sidecar.rs), que guarda os dados em app-data.

mod sidecar;

use tauri::{AppHandle, Manager, RunEvent, State};

pub(crate) const SERVICO: &str = "com.rafaelbrauner.fincontrol";

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

/// Estado do backend embutido: `{estado: "iniciando"|"pronto"|"falhou", motivo?}`.
/// Mudanças chegam também pelo evento `backend-estado`.
#[tauri::command]
fn backend_estado(sidecar: State<'_, sidecar::Sidecar>) -> sidecar::Estado {
    sidecar.estado()
}

/// `{base, token}` do backend embutido; fora de `pronto`, erro `nao_pronto`.
/// Porta e token mudam a cada reinício.
#[tauri::command]
fn backend_info(sidecar: State<'_, sidecar::Sidecar>) -> Result<sidecar::Info, String> {
    sidecar.info()
}

/// Reinicia o backend embutido (porta e token novos); volta na hora, o
/// progresso sai pelo evento `backend-estado`.
#[tauri::command]
fn backend_reiniciar(app: AppHandle) {
    sidecar::reiniciar(app);
}

/// Pasta dos service workers no perfil do WebView2:
/// `<dados locais>/EBWebView/Default/Service Worker`.
#[cfg(any(windows, test))]
fn pasta_service_worker(dados_locais: &std::path::Path) -> std::path::PathBuf {
    dados_locais.join("EBWebView").join("Default").join("Service Worker")
}

/// Apaga só a pasta `Service Worker` do perfil (o resto fica). `Ok(true)` se
/// apagou, `Ok(false)` se ela não existia.
#[cfg(any(windows, test))]
fn apagar_pasta_service_worker(dados_locais: &std::path::Path) -> std::io::Result<bool> {
    match std::fs::remove_dir_all(pasta_service_worker(dados_locais)) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e),
    }
}

pub fn run() {
    let app = tauri::Builder::default()
        // Primeiro plugin, como a doc exige: a 2ª instância só foca a janela
        // aberta e sai, sem subir outro sidecar no mesmo banco.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(janela) = app.get_webview_window("main") {
                let _ = janela.unminimize();
                let _ = janela.show();
                let _ = janela.set_focus();
            }
        }))
        // `window.open` (anexos via abrirAnexo) e `mailto:` saem no navegador do
        // sistema, nao numa segunda janela sem chrome.
        .plugin(tauri_plugin_opener::init())
        // Biometria: gate de abertura a frio e de resume (Touch ID/Hello).
        .plugin(tauri_plugin_biometry::init())
        // Atualização assinada (repo público de releases) e reboot pós-install.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Registrado antes do setup: comandos chamados cedo já acham o estado.
        .manage(sidecar::Sidecar::novo())
        .setup(|app| {
            // Thread própria: a janela abre sem esperar o backend.
            sidecar::iniciar(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cofre_ler,
            cofre_gravar,
            cofre_apagar,
            backend_estado,
            backend_info,
            backend_reiniciar
        ])
        .build(tauri::generate_context!())
        .expect("FinControl: falha ao iniciar o runtime Tauri");

    // Builds antigos registraram um sw.js no perfil do WebView2, que serve a
    // interface velha para sempre (a atualização dele falha). Apaga a pasta
    // aqui porque o single-instance já encerrou uma 2ª instância no `build` (não
    // mexe no perfil de um app aberto) e as janelas do config só nascem no
    // `RunEvent::Ready`, dentro do `run` (nenhuma webview usa o perfil ainda).
    // Toda abertura, sem marcador: o desktop não registra SW, então a pasta só
    // tem lixo de build antigo. Melhor esforço: erro não impede o app de abrir.
    #[cfg(windows)]
    if let Ok(dados_locais) = app.path().app_local_data_dir() {
        let _ = apagar_pasta_service_worker(&dados_locais);
    }

    app.run(|app, evento| {
        // Fechar a janela/sair: EOF no stdin, até 3 s, depois kill. Idempotente.
        if matches!(evento, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            app.state::<sidecar::Sidecar>().encerrar();
        }
    });
}

#[cfg(test)]
mod testes {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};

    /// Pasta temporária única por teste; nunca o perfil real.
    fn base_temporaria(nome: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let base = std::env::temp_dir().join(format!(
            "fincontrol-limpeza-sw-{nome}-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&base).unwrap();
        base
    }

    fn criar_arquivo(caminho: &Path) {
        fs::create_dir_all(caminho.parent().unwrap()).unwrap();
        fs::write(caminho, b"x").unwrap();
    }

    #[test]
    fn limpeza_sw_monta_o_caminho_do_perfil() {
        let base = Path::new("dados");
        assert_eq!(
            pasta_service_worker(base),
            base.join("EBWebView").join("Default").join("Service Worker")
        );
    }

    #[test]
    fn limpeza_sw_apaga_so_a_pasta_do_service_worker() {
        let base = base_temporaria("apaga");
        let perfil = base.join("EBWebView").join("Default");
        let sw = perfil.join("Service Worker");
        criar_arquivo(&sw.join("Database").join("CURRENT"));
        criar_arquivo(&sw.join("ScriptCache").join("index"));
        criar_arquivo(&sw.join("arquivo"));
        criar_arquivo(&perfil.join("IndexedDB").join("x"));
        criar_arquivo(&perfil.join("Local Storage").join("y"));

        assert!(apagar_pasta_service_worker(&base).unwrap());

        assert!(!sw.exists());
        assert!(perfil.join("IndexedDB").join("x").is_file());
        assert!(perfil.join("Local Storage").join("y").is_file());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn limpeza_sw_sem_pasta_devolve_false() {
        let base = base_temporaria("ausente");
        assert!(!apagar_pasta_service_worker(&base).unwrap());
        fs::remove_dir_all(&base).unwrap();
    }
}
