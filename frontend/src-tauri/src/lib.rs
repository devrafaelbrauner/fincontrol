// Janela unica do FinControl. Sem estado global alem do handle do Tauri:
// abrir/fechar eh o ciclo de vida inteiro — sessoes e dados vivem no backend.
pub fn run() {
    tauri::Builder::default()
        // `window.open` (anexos via abrirAnexo) e `mailto:` saem no navegador do
        // sistema, nao numa segunda janela sem chrome.
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("FinControl: falha ao iniciar o runtime Tauri");
}
