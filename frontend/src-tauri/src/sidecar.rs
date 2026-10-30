// Backend embutido: o FastAPI empacotado pelo PyInstaller (onedir em
// `bundle.resources` -> `<resource_dir>/fincontrol-backend/`) roda como processo
// filho, preso a 127.0.0.1 numa porta livre escolhida aqui.
//
// Segredos (SECRET_KEY, FERNET_KEY, token da sessão) vão numa linha JSON no
// stdin, nunca em argv, env, arquivo ou log: o env de um processo é legível por
// outros do mesmo usuário. O stdin fica aberto; EOF = o sidecar sai sozinho, que
// é o encerramento no macOS/Linux mesmo se o app for morto. No Windows o filho
// ainda fica num Job Object com KILL_ON_JOB_CLOSE.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use base64::Engine as _;
use hmac::{Hmac, Mac};
use serde::Serialize;
use sha2::Sha256;
use tauri::{AppHandle, Emitter, Manager};

use crate::SERVICO;

const EVENTO: &str = "backend-estado";
/// Reinícios automáticos por sessão do app (depois do 1º spawn).
const MAX_REINICIOS: u32 = 3;
const PRONTIDAO_LIMITE: Duration = Duration::from_secs(20);
const PRONTIDAO_INTERVALO: Duration = Duration::from_millis(100);
const VIGIA_INTERVALO: Duration = Duration::from_millis(250);
/// Tempo que o sidecar tem para sair sozinho depois do EOF antes do kill.
const ENCERRAR_LIMITE: Duration = Duration::from_secs(3);
/// Quanto uma tentativa nova espera o processo anterior ser recolhido.
const TROCA_LIMITE: Duration = Duration::from_secs(ENCERRAR_LIMITE.as_secs() + 2);
const LOG_LIMITE: u64 = 5 * 1024 * 1024;
const CHAVE_SECRET: &str = "backend_secret_key";
const CHAVE_FERNET: &str = "backend_fernet_key";

/// Payload de `backend_estado()` e do evento `backend-estado`:
/// `{estado: "iniciando"|"pronto"|"falhou", motivo?}`.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "estado", rename_all = "lowercase")]
pub enum Estado {
    Iniciando,
    Pronto,
    Falhou { motivo: String },
}

/// Payload de `backend_info()`.
#[derive(Clone, Serialize)]
pub struct Info {
    pub base: String,
    pub token: String,
}

struct Filho {
    processo: Child,
    /// Mantido aberto enquanto o sidecar deve viver: soltar = EOF = ele sai.
    stdin: Option<ChildStdin>,
}

struct Interno {
    estado: Estado,
    /// Porta/token da tentativa atual; só é exposto em `pronto`.
    sessao: Option<Info>,
    filho: Option<Filho>,
    /// Cada ciclo (início, `backend_reiniciar`) ganha uma geração nova; threads
    /// de gerações antigas param na primeira checagem.
    geracao: u64,
    reinicios: u32,
    encerrando: bool,
    /// Um filho foi iniciado e ainda não foi recolhido (vivo ou sendo parado).
    processo_ativo: bool,
    /// Lidos do cofre uma vez por execução do app (só em memória).
    segredos: Option<(String, String)>,
}

pub struct Sidecar {
    interno: Mutex<Interno>,
    /// Avisa quem espera a vaga de `processo_ativo` (par de `interno`).
    livre: Condvar,
    #[cfg(windows)]
    job: Option<job::Job>,
}

/// Fim de uma tentativa: `Fatal` não adianta reiniciar (cofre, sidecar ausente).
enum Falha {
    Fatal(String),
    Tentativa(String),
    /// Outra geração assumiu (reinício manual ou saída do app).
    Obsoleta,
}

impl Sidecar {
    pub fn novo() -> Self {
        Sidecar {
            interno: Mutex::new(Interno {
                estado: Estado::Iniciando,
                sessao: None,
                filho: None,
                geracao: 0,
                reinicios: 0,
                encerrando: false,
                processo_ativo: false,
                segredos: None,
            }),
            livre: Condvar::new(),
            #[cfg(windows)]
            job: job::Job::novo().ok(),
        }
    }

    fn travar(&self) -> MutexGuard<'_, Interno> {
        // Um pânico com o lock não pode derrubar o encerramento do sidecar.
        self.interno.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn estado(&self) -> Estado {
        self.travar().estado.clone()
    }

    pub fn info(&self) -> Result<Info, String> {
        let g = self.travar();
        match (&g.estado, &g.sessao) {
            (Estado::Pronto, Some(info)) => Ok(info.clone()),
            _ => Err("nao_pronto".into()),
        }
    }

    /// Para o sidecar (EOF, até 3 s, kill) e impede novos reinícios.
    pub fn encerrar(&self) {
        let filho = {
            let mut g = self.travar();
            g.encerrando = true;
            g.geracao += 1;
            g.sessao = None;
            g.filho.take()
        };
        self.livre.notify_all();
        if let Some(f) = filho {
            parar(self, f);
        }
    }

    /// Troca a geração e devolve a nova (com o filho antigo para parar).
    fn nova_geracao(&self, zerar_reinicios: bool) -> Option<(u64, Option<Filho>)> {
        let mut g = self.travar();
        if g.encerrando {
            return None;
        }
        g.geracao += 1;
        if zerar_reinicios {
            g.reinicios = 0;
        }
        g.sessao = None;
        g.estado = Estado::Iniciando;
        self.livre.notify_all();
        Some((g.geracao, g.filho.take()))
    }

    /// Muda o estado só se `geracao` ainda for a atual; devolve se mudou.
    fn definir(&self, geracao: u64, estado: Estado, sessao: Option<Info>) -> bool {
        let mut g = self.travar();
        if g.geracao != geracao || g.encerrando {
            return false;
        }
        g.estado = estado;
        g.sessao = sessao;
        true
    }

    /// Reserva a vaga do único processo do backend para `geracao`, esperando até
    /// `limite` o anterior ser recolhido. Geração obsoleta nunca reserva.
    fn reservar(&self, geracao: u64, limite: Duration) -> Result<(), Falha> {
        let prazo = Instant::now() + limite;
        let mut g = self.travar();
        loop {
            if g.geracao != geracao || g.encerrando {
                return Err(Falha::Obsoleta);
            }
            if !g.processo_ativo {
                g.processo_ativo = true;
                return Ok(());
            }
            let agora = Instant::now();
            if agora >= prazo {
                return Err(Falha::Tentativa(format!(
                    "o backend anterior não encerrou em {} s",
                    limite.as_secs()
                )));
            }
            g = self
                .livre
                .wait_timeout(g, prazo - agora)
                .unwrap_or_else(|e| e.into_inner())
                .0;
        }
    }

    /// Solta a vaga (processo recolhido ou que nem subiu) e acorda quem espera.
    fn liberar(&self) {
        self.travar().processo_ativo = false;
        self.livre.notify_all();
    }
}

/// Sobe o sidecar numa thread própria (a janela abre sem esperar).
pub fn iniciar(app: AppHandle) {
    disparar(app, false);
}

/// `backend_reiniciar`: para o atual e começa um ciclo novo, com a cota de
/// reinícios automáticos zerada. Não bloqueia o comando (a parada leva até 3 s);
/// o processo novo só sobe depois de o anterior ser recolhido.
pub fn reiniciar(app: AppHandle) {
    disparar(app, true);
}

fn disparar(app: AppHandle, zerar_reinicios: bool) {
    let Some((geracao, antigo)) = app.state::<Sidecar>().nova_geracao(zerar_reinicios) else {
        return;
    };
    emitir(&app, &Estado::Iniciando);
    thread::spawn(move || {
        if let Some(f) = antigo {
            parar(&app.state::<Sidecar>(), f);
        }
        ciclo(&app, geracao);
    });
}

fn emitir(app: &AppHandle, estado: &Estado) {
    let _ = app.emit(EVENTO, estado);
}

/// Tentativas da geração: spawn -> prontidão -> vigia; morreu = porta e token
/// novos, até `MAX_REINICIOS` por sessão; depois `falhou`.
fn ciclo(app: &AppHandle, geracao: u64) {
    let sidecar = app.state::<Sidecar>();
    loop {
        let motivo = match tentativa(app, &sidecar, geracao) {
            Falha::Obsoleta => return,
            Falha::Fatal(motivo) => {
                falhar(app, &sidecar, geracao, motivo);
                return;
            }
            Falha::Tentativa(motivo) => motivo,
        };
        // Tira o filho morto (ou sem resposta) antes de decidir.
        let (filho, esgotou) = {
            let mut g = sidecar.travar();
            if g.geracao != geracao || g.encerrando {
                return;
            }
            g.sessao = None;
            let esgotou = g.reinicios >= MAX_REINICIOS;
            if !esgotou {
                g.reinicios += 1;
            }
            (g.filho.take(), esgotou)
        };
        if let Some(f) = filho {
            parar(&sidecar, f);
        }
        registrar(app, &format!("tentativa falhou: {motivo}"));
        if esgotou {
            falhar(app, &sidecar, geracao, motivo);
            return;
        }
        if sidecar.definir(geracao, Estado::Iniciando, None) {
            emitir(app, &Estado::Iniciando);
        }
    }
}

fn falhar(app: &AppHandle, sidecar: &Sidecar, geracao: u64, motivo: String) {
    let estado = Estado::Falhou { motivo };
    if sidecar.definir(geracao, estado.clone(), None) {
        emitir(app, &estado);
    }
}

/// Uma vida do sidecar. Só retorna quando ele falha (ou a geração muda).
fn tentativa(app: &AppHandle, sidecar: &Sidecar, geracao: u64) -> Falha {
    let (secret_key, fernet_key) = match segredos(sidecar) {
        Ok(s) => s,
        Err(e) => return Falha::Fatal(e),
    };
    let caminhos = match Caminhos::resolver(app) {
        Ok(c) => c,
        Err(e) => return Falha::Fatal(e),
    };
    if !caminhos.executavel.is_file() {
        return Falha::Fatal(format!(
            "sidecar não encontrado: {}",
            caminhos.executavel.display()
        ));
    }
    let porta = match porta_livre() {
        Ok(p) => p,
        Err(e) => return Falha::Tentativa(format!("sem porta livre: {e}")),
    };
    let token = match aleatorio_hex() {
        Ok(t) => t,
        Err(e) => return Falha::Fatal(e),
    };

    // Um processo por vez: espera o anterior ser recolhido (e desiste se obsoleta).
    if let Err(falha) = sidecar.reservar(geracao, TROCA_LIMITE) {
        return falha;
    }
    let mut processo = match spawn(&caminhos, porta) {
        Ok(p) => p,
        Err(e) => {
            sidecar.liberar();
            return Falha::Tentativa(format!("falha ao iniciar o backend: {e}"));
        }
    };
    #[cfg(windows)]
    if let Some(job) = &sidecar.job {
        if let Err(e) = job.atribuir(&processo) {
            registrar(app, &format!("aviso: Job Object indisponível ({e})"));
        }
    } else {
        registrar(app, "aviso: Job Object indisponível na criação");
    }

    // Entrega dos segredos: uma linha JSON; o pipe continua aberto.
    let mut stdin = processo.stdin.take();
    let linha = serde_json::json!({
        "secret_key": secret_key,
        "fernet_key": fernet_key,
        "token": token,
    })
    .to_string()
        + "\n";
    let entregue = stdin
        .as_mut()
        .map(|s| s.write_all(linha.as_bytes()).and_then(|()| s.flush()));
    drop(linha);

    // Guarda o filho antes de qualquer retorno, para a parada achar o processo.
    {
        let mut g = sidecar.travar();
        if g.geracao != geracao || g.encerrando {
            drop(g);
            parar(sidecar, Filho { processo, stdin });
            return Falha::Obsoleta;
        }
        g.filho = Some(Filho { processo, stdin });
    }
    match entregue {
        Some(Ok(())) => {}
        Some(Err(e)) => return Falha::Tentativa(format!("stdin do backend: {e}")),
        None => return Falha::Tentativa("stdin do backend indisponível".into()),
    }

    // Prontidão: /api/health a cada 100 ms, até 20 s.
    let limite = Instant::now() + PRONTIDAO_LIMITE;
    loop {
        match saiu(sidecar, geracao) {
            Vigia::Obsoleta => return Falha::Obsoleta,
            Vigia::Saiu(motivo) => return Falha::Tentativa(motivo),
            Vigia::Vivo => {}
        }
        if saudavel(porta, &token) {
            break;
        }
        if Instant::now() >= limite {
            return Falha::Tentativa(format!(
                "o backend não respondeu /api/health em {} s",
                PRONTIDAO_LIMITE.as_secs()
            ));
        }
        thread::sleep(PRONTIDAO_INTERVALO);
    }

    let info = Info {
        base: format!("http://127.0.0.1:{porta}"),
        token,
    };
    if !sidecar.definir(geracao, Estado::Pronto, Some(info)) {
        return Falha::Obsoleta;
    }
    emitir(app, &Estado::Pronto);
    registrar(app, &format!("pronto em 127.0.0.1:{porta}"));

    // Vigia: se o processo morrer, a tentativa acaba e o ciclo reinicia.
    loop {
        thread::sleep(VIGIA_INTERVALO);
        match saiu(sidecar, geracao) {
            Vigia::Obsoleta => return Falha::Obsoleta,
            Vigia::Saiu(motivo) => return Falha::Tentativa(motivo),
            Vigia::Vivo => {}
        }
    }
}

enum Vigia {
    Vivo,
    Saiu(String),
    Obsoleta,
}

fn saiu(sidecar: &Sidecar, geracao: u64) -> Vigia {
    let mut g = sidecar.travar();
    if g.geracao != geracao || g.encerrando {
        return Vigia::Obsoleta;
    }
    let Some(filho) = g.filho.as_mut() else {
        return Vigia::Saiu("o backend não está em execução".into());
    };
    match filho.processo.try_wait() {
        Ok(None) => Vigia::Vivo,
        Ok(Some(status)) => Vigia::Saiu(format!("o backend encerrou ({status})")),
        Err(e) => Vigia::Saiu(format!("falha ao acompanhar o backend: {e}")),
    }
}

/// EOF no stdin, até `ENCERRAR_LIMITE` para sair sozinho, depois kill; recolhido
/// o processo, libera a vaga para o próximo.
fn parar(sidecar: &Sidecar, mut filho: Filho) {
    drop(filho.stdin.take());
    let limite = Instant::now() + ENCERRAR_LIMITE;
    loop {
        match filho.processo.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < limite => thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = filho.processo.kill();
                let _ = filho.processo.wait();
                break;
            }
        }
    }
    sidecar.liberar();
}

struct Caminhos {
    executavel: PathBuf,
    dados: PathBuf,
    log: Option<PathBuf>,
}

impl Caminhos {
    fn resolver(app: &AppHandle) -> Result<Self, String> {
        let caminhos = app.path();
        let nome = if cfg!(windows) {
            "fincontrol-backend.exe"
        } else {
            "fincontrol-backend"
        };
        let executavel = caminhos
            .resource_dir()
            .map_err(|e| format!("resource_dir: {e}"))?
            .join("fincontrol-backend")
            .join(nome);
        let dados = caminhos
            .app_data_dir()
            .map_err(|e| format!("app_data_dir: {e}"))?;
        fs::create_dir_all(&dados)
            .map_err(|e| format!("pasta de dados {}: {e}", dados.display()))?;
        let log = log_do_backend(&dados);
        Ok(Caminhos {
            executavel,
            dados,
            log,
        })
    }
}

/// `<pasta de dados>/logs/backend.log` (a rotação fica ao lado), criando a
/// pasta; `None` se não der para criar: o backend sobe sem log.
fn log_do_backend(dados: &Path) -> Option<PathBuf> {
    let pasta = dados.join("logs");
    fs::create_dir_all(&pasta).ok()?;
    Some(pasta.join("backend.log"))
}

fn spawn(caminhos: &Caminhos, porta: u16) -> std::io::Result<Child> {
    let mut cmd = Command::new(&caminhos.executavel);
    // Env herdado menos qualquer FINCONTROL_* (o Windows não diferencia caixa).
    for (chave, _) in std::env::vars_os() {
        if chave
            .to_str()
            .is_some_and(|c| c.to_ascii_uppercase().starts_with("FINCONTROL_"))
        {
            cmd.env_remove(&chave);
        }
    }
    cmd.env("FINCONTROL_DATA", &caminhos.dados)
        .env("FINCONTROL_PORTA", porta.to_string())
        .env("FINCONTROL_AGENDADOR", "0")
        .env("FINCONTROL_MODO", "desktop")
        .current_dir(&caminhos.dados)
        .stdin(Stdio::piped());
    // Build de debug: o webview vem do Vite (`http://localhost:1420`), origem
    // que o guard do backend só aceita com esta flag.
    if cfg!(debug_assertions) {
        cmd.env("FINCONTROL_DESKTOP_DEV", "1");
    }

    match caminhos.log.as_deref().and_then(|p| abrir_log(p, porta).ok()) {
        Some(saida) => {
            let erro = saida.try_clone()?;
            cmd.stdout(saida).stderr(erro);
        }
        None => {
            cmd.stdout(Stdio::null()).stderr(Stdio::null());
        }
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
    }
    cmd.spawn()
}

/// `backend.log` com uma rotação simples: passou de 5 MB no spawn, vira
/// `backend.log.1` (substitui a anterior). Só saída do processo e marcos da
/// casca; env e stdin nunca chegam aqui.
fn abrir_log(caminho: &Path, porta: u16) -> std::io::Result<File> {
    if fs::metadata(caminho).is_ok_and(|m| m.len() > LOG_LIMITE) {
        let _ = fs::rename(caminho, caminho.with_extension("log.1"));
    }
    let mut arquivo = OpenOptions::new().create(true).append(true).open(caminho)?;
    writeln!(arquivo, "--- casca: iniciando fincontrol-backend em 127.0.0.1:{porta} ---")?;
    Ok(arquivo)
}

fn registrar(app: &AppHandle, linha: &str) {
    let Some(log) = app.path().app_data_dir().ok().and_then(|d| log_do_backend(&d)) else {
        return;
    };
    if let Ok(mut arquivo) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log)
    {
        let _ = writeln!(arquivo, "--- casca: {linha} ---");
    }
}

/// Porta livre do SO em 127.0.0.1 (o listener é solto antes do spawn).
fn porta_livre() -> std::io::Result<u16> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    Ok(listener.local_addr()?.port())
}

/// `GET /api/health` com um nonce novo: pronto só com 200, `ok == true` e
/// `prova` == HMAC-SHA256(token, nonce). O token nunca vai no pedido: quem
/// ocupasse a porta não o aprende, e sem ele não forja a prova.
fn saudavel(porta: u16, token: &str) -> bool {
    let mut aleatorio = [0u8; 16];
    if getrandom::fill(&mut aleatorio).is_err() {
        return false;
    }
    let nonce = hex(&aleatorio);
    let endereco = SocketAddr::from((Ipv4Addr::LOCALHOST, porta));
    // Porta fechada no Windows demora ~1 s para recusar: timeout curto.
    let Ok(mut conexao) = TcpStream::connect_timeout(&endereco, Duration::from_millis(150)) else {
        return false;
    };
    let _ = conexao.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = conexao.set_write_timeout(Some(Duration::from_secs(2)));
    let pedido = format!(
        "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{porta}\r\nX-FinControl-Nonce: {nonce}\r\nConnection: close\r\n\r\n"
    );
    if conexao.write_all(pedido.as_bytes()).is_err() {
        return false;
    }
    let mut resposta = Vec::new();
    if conexao.take(64 * 1024).read_to_end(&mut resposta).is_err() {
        return false;
    }
    let texto = String::from_utf8_lossy(&resposta);
    let Some((cabecalho, corpo)) = texto.split_once("\r\n\r\n") else {
        return false;
    };
    let status_ok = cabecalho
        .lines()
        .next()
        .is_some_and(|l| l.split_whitespace().nth(1) == Some("200"));
    status_ok && resposta_valida(corpo, token, &nonce)
}

/// Corpo `{"ok": true, "prova": "<hex>"}` com a prova certa para `nonce`.
fn resposta_valida(corpo: &str, token: &str, nonce: &str) -> bool {
    let Ok(json) = serde_json::from_str::<serde_json::Value>(corpo.trim()) else {
        return false;
    };
    json.get("ok") == Some(&serde_json::Value::Bool(true))
        && json
            .get("prova")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|prova| prova_valida(token, nonce, prova))
}

/// SECRET_KEY e FERNET_KEY do cofre. Gera e grava só quando a entrada não existe
/// (`NoEntry`); qualquer outro erro vira `falhou`: uma Fernet nova perderia os
/// dados cifrados (chave OpenRouter) do banco.
fn segredos(sidecar: &Sidecar) -> Result<(String, String), String> {
    if let Some(s) = sidecar.travar().segredos.clone() {
        return Ok(s);
    }
    let secret = segredo_do_cofre(CHAVE_SECRET, aleatorio_hex)?;
    let fernet = segredo_do_cofre(CHAVE_FERNET, || {
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes).map_err(|e| format!("gerador aleatório: {e}"))?;
        Ok(base64::engine::general_purpose::URL_SAFE.encode(bytes))
    })?;
    let par = (secret, fernet);
    sidecar.travar().segredos = Some(par.clone());
    Ok(par)
}

fn segredo_do_cofre(
    chave: &str,
    gerar: impl FnOnce() -> Result<String, String>,
) -> Result<String, String> {
    let entrada =
        keyring::Entry::new(SERVICO, chave).map_err(|e| format!("cofre ({chave}): {e}"))?;
    match entrada.get_password() {
        Ok(valor) => Ok(valor),
        Err(keyring::Error::NoEntry) => {
            let valor = gerar()?;
            entrada
                .set_password(&valor)
                .map_err(|e| format!("cofre ({chave}): {e}"))?;
            Ok(valor)
        }
        Err(e) => Err(format!("cofre ({chave}): {e}")),
    }
}

/// 32 bytes aleatórios em hex minúsculo (64 caracteres).
fn aleatorio_hex() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| format!("gerador aleatório: {e}"))?;
    Ok(hex(&bytes))
}

fn hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .fold(String::with_capacity(bytes.len() * 2), |mut s, b| {
            use std::fmt::Write as _;
            let _ = write!(s, "{b:02x}");
            s
        })
}

/// Hex minúsculo -> bytes; `None` para tamanho ímpar ou caractere fora de `[0-9a-f]`.
fn de_hex(texto: &str) -> Option<Vec<u8>> {
    fn nibble(c: u8) -> Option<u8> {
        match c {
            b'0'..=b'9' => Some(c - b'0'),
            b'a'..=b'f' => Some(c - b'a' + 10),
            _ => None,
        }
    }
    let (pares, resto) = texto.as_bytes().as_chunks::<2>();
    if !resto.is_empty() {
        return None;
    }
    pares
        .iter()
        .map(|[alto, baixo]| Some(nibble(*alto)? << 4 | nibble(*baixo)?))
        .collect()
}

/// `prova` == HMAC-SHA256(chave = token, msg = nonce) em hex minúsculo,
/// comparada em tempo constante (`verify_slice`).
fn prova_valida(token: &str, nonce: &str, prova: &str) -> bool {
    let Some(recebida) = de_hex(prova) else {
        return false;
    };
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(token.as_bytes()) else {
        return false;
    };
    mac.update(nonce.as_bytes());
    mac.verify_slice(&recebida).is_ok()
}

#[cfg(windows)]
mod job {
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    /// Job Object com KILL_ON_JOB_CLOSE. O handle vive com o estado do app; quando
    /// o processo do app termina (normal ou `taskkill /F`), o Windows fecha o
    /// handle e mata todo processo do job.
    pub struct Job(HANDLE);

    // O HANDLE de um Job Object pode ser usado de qualquer thread.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    impl Job {
        pub fn novo() -> std::io::Result<Self> {
            // SAFETY: chamadas Win32 com ponteiros nulos válidos (sem nome, sem
            // atributos de segurança) e uma struct inicializada do tamanho declarado.
            unsafe {
                let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if handle.is_null() {
                    return Err(std::io::Error::last_os_error());
                }
                let job = Job(handle);
                let mut limites: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                limites.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let ok = SetInformationJobObject(
                    job.0,
                    JobObjectExtendedLimitInformation,
                    std::ptr::from_ref(&limites).cast(),
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                if ok == 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(job)
            }
        }

        pub fn atribuir(&self, filho: &Child) -> std::io::Result<()> {
            // SAFETY: os dois handles são válidos enquanto `self` e `filho` vivem.
            let ok = unsafe { AssignProcessToJobObject(self.0, filho.as_raw_handle() as HANDLE) };
            if ok == 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            // SAFETY: handle próprio, fechado uma única vez.
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

#[cfg(test)]
mod testes {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};

    const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const NONCE: &str = "00112233445566778899aabbccddeeff";
    // hmac.new(TOKEN.encode(), NONCE.encode(), "sha256").hexdigest() no Python.
    const PROVA: &str = "030ffc11ec49be148af4e692ad06ac01633f5fcae141bab99873e78ab06db975";

    #[test]
    fn prova_confere_com_hmac_do_python() {
        assert!(prova_valida(TOKEN, NONCE, PROVA));
        let corpo = format!(r#"{{"ok": true, "prova": "{PROVA}"}}"#);
        assert!(resposta_valida(&corpo, TOKEN, NONCE));
    }

    #[test]
    fn prova_errada_e_recusada() {
        let trocada = format!("{}0", &PROVA[..63]);
        assert!(!prova_valida(TOKEN, NONCE, &trocada));
        assert!(!prova_valida(TOKEN, NONCE, &PROVA.to_uppercase()));
        assert!(!prova_valida(TOKEN, NONCE, &PROVA[..62]));
        assert!(!prova_valida(TOKEN, NONCE, ""));
        assert!(!prova_valida(TOKEN, "ffeeddccbbaa99887766554433221100", PROVA));
        assert!(!prova_valida(&TOKEN.replace('0', "1"), NONCE, PROVA));
        let sem_ok = format!(r#"{{"ok": false, "prova": "{PROVA}"}}"#);
        assert!(!resposta_valida(&sem_ok, TOKEN, NONCE));
        assert!(!resposta_valida(r#"{"ok": true}"#, TOKEN, NONCE));
    }

    #[test]
    fn processo_unico_espera_o_processo_anterior() {
        let sidecar = Sidecar::novo();
        let (g1, _) = sidecar.nova_geracao(false).unwrap();
        assert!(sidecar.reservar(g1, Duration::ZERO).is_ok());
        let (g2, _) = sidecar.nova_geracao(true).unwrap();
        let liberado = AtomicBool::new(false);
        thread::scope(|t| {
            let espera = t.spawn(|| {
                let reservou = matches!(sidecar.reservar(g2, Duration::from_secs(5)), Ok(()));
                reservou && liberado.load(Ordering::SeqCst)
            });
            thread::sleep(Duration::from_millis(200));
            liberado.store(true, Ordering::SeqCst);
            sidecar.liberar();
            // Só vale se reservou depois de o processo anterior ser recolhido.
            assert!(espera.join().unwrap());
        });
    }

    #[test]
    fn processo_unico_geracao_obsoleta_nao_reserva() {
        let sidecar = Sidecar::novo();
        let (g1, _) = sidecar.nova_geracao(false).unwrap();
        let (g2, _) = sidecar.nova_geracao(true).unwrap();
        // Vaga livre, mas a geração já é outra: não sobe processo.
        assert!(matches!(
            sidecar.reservar(g1, Duration::from_secs(5)),
            Err(Falha::Obsoleta)
        ));
        assert!(sidecar.reservar(g2, Duration::ZERO).is_ok());

        // Quem espera a vaga desiste na hora com a troca de geração e com `encerrar`.
        for trocar in [
            (|s: &Sidecar| {
                let _ = s.nova_geracao(true);
            }) as fn(&Sidecar),
            |s: &Sidecar| s.encerrar(),
        ] {
            let (g, _) = sidecar.nova_geracao(true).unwrap();
            thread::scope(|t| {
                let espera = t.spawn(|| {
                    let inicio = Instant::now();
                    let obsoleta = matches!(
                        sidecar.reservar(g, Duration::from_secs(5)),
                        Err(Falha::Obsoleta)
                    );
                    (obsoleta, inicio.elapsed())
                });
                thread::sleep(Duration::from_millis(100));
                trocar(&sidecar);
                let (obsoleta, tempo) = espera.join().unwrap();
                assert!(obsoleta);
                assert!(tempo < Duration::from_secs(2), "esperou {tempo:?}");
            });
        }
    }

    #[test]
    fn processo_unico_espera_tem_limite() {
        let sidecar = Sidecar::novo();
        let (g, _) = sidecar.nova_geracao(false).unwrap();
        assert!(sidecar.reservar(g, Duration::ZERO).is_ok());
        let inicio = Instant::now();
        assert!(matches!(
            sidecar.reservar(g, Duration::from_millis(150)),
            Err(Falha::Tentativa(_))
        ));
        assert!(inicio.elapsed() >= Duration::from_millis(150));
    }

    #[test]
    fn log_do_backend_fica_em_logs_na_pasta_de_dados() {
        let dados = std::env::temp_dir().join(format!("fincontrol-logs-{}", std::process::id()));
        // Sobra de uma execução que panicou faria o `is_file()` passar sem rotação.
        let _ = fs::remove_dir_all(&dados);
        let log = log_do_backend(&dados).unwrap();
        assert_eq!(log, dados.join("logs").join("backend.log"));
        // A rotação de `abrir_log` cai na mesma pasta.
        fs::write(&log, vec![0u8; LOG_LIMITE as usize + 1]).unwrap();
        abrir_log(&log, 1).unwrap();
        assert!(dados.join("logs").join("backend.log.1").is_file());
        fs::remove_dir_all(&dados).unwrap();
    }
}
