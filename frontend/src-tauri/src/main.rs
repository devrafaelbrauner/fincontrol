// O cliente Tauri eh so janela: sem comandos custom, sem sidecar, sem Python.
// A regra de negocio mora no React (bundle em ../dist) e no backend remoto
// (VITE_API_BASE, checado em build pelo scripts/checar-api-base.mjs).
fn main() {
    fincontrol_lib::run()
}
