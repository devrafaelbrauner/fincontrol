// Sem janela de console no release do Windows; o `tauri dev` (debug) mantém o
// console para o log.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Só chama o `run` do lib.rs: janela, cofre e o backend embutido (sidecar
// FastAPI local, ver sidecar.rs). A regra de negócio mora no React (bundle em
// ../dist) e nesse backend, que guarda os dados neste computador.
fn main() {
    fincontrol_lib::run()
}
