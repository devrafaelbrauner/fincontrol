import Cocoa
import WebKit

/// Wrapper nativo mínimo: uma janela com WKWebView apontando para o backend
/// local, que serve o frontend buildado (frontend/dist) na porta 8000.
let porta = 8000
/// `FINCONTROL_URL` aponta o wrapper para outro servidor (ex.: a VPS por HTTPS).
/// Quem aponta um servidor assume o controle dele: só gerenciamos o uvicorn no
/// caminho padrão — inclusive se a URL for local, pode ser um servidor de outro dono.
let urlEnv = ProcessInfo.processInfo.environment["FINCONTROL_URL"].flatMap { URL(string: $0) }
let urlApp = urlEnv ?? URL(string: "http://127.0.0.1:\(porta)")!
let servidorLocal = urlEnv == nil

/// Diretório `backend/` do repositório, com venv pronto. `FINCONTROL_HOME` permite
/// apontar para um checkout fora do caminho padrão.
func acharBackend() -> URL? {
    let fm = FileManager.default
    var candidatos: [URL] = []
    if let home = ProcessInfo.processInfo.environment["FINCONTROL_HOME"], !home.isEmpty {
        candidatos.append(URL(fileURLWithPath: (home as NSString).expandingTildeInPath))
    }
    candidatos.append(fm.homeDirectoryForCurrentUser.appendingPathComponent("Projects/fincontrol"))
    candidatos.append(fm.homeDirectoryForCurrentUser.appendingPathComponent("projects/fincontrol"))
    return candidatos
        .map { $0.appendingPathComponent("backend") }
        .first { fm.isExecutableFile(atPath: $0.appendingPathComponent(".venv/bin/uvicorn").path) }
}

class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate,
                   WKDownloadDelegate, NSWindowDelegate {
    var janela: NSWindow!
    var webView: WKWebView!
    var janelasExtras: [NSWindow] = []  // janelas de window.open (ex.: visualizar anexo)
    /// uvicorn iniciado por nós (nil quando o backend já estava no ar por fora).
    var backend: Process?
    /// Destino escolhido para cada download em andamento (para revelar no Finder ao fim).
    var destinos: [ObjectIdentifier: URL] = [:]

    func applicationDidFinishLaunching(_ notification: Notification) {
        criarMenu()

        let config = WKWebViewConfiguration()
        // Dentro do wrapper o backend é local — service worker só serve conteúdo
        // defasado do cache. Roda ANTES dos scripts da página: impede novos registros
        // e remove registro/caches existentes. localStorage (login) é preservado.
        let semSW = WKUserScript(
            source: """
            if (navigator.serviceWorker) {
                navigator.serviceWorker.register = function () {
                    return Promise.reject(new Error("service worker desativado no app nativo"));
                };
                navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
            }
            if (window.caches) caches.keys().then(ks => ks.forEach(k => caches.delete(k)));
            """,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(semSW)
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self  // sem isto, <input type=file> não abre nada no WKWebView

        janela = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1100, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        janela.title = "FinControl"
        janela.minSize = NSSize(width: 480, height: 480)
        janela.contentView = webView
        janela.center()
        janela.setFrameAutosaveName("FinControlJanela")
        janela.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        // Antes de carregar, remove service workers e caches de sessões anteriores
        // (o cinto e o suspensório do script acima) — localStorage fica intacto.
        let tipos: Set<String> = [
            WKWebsiteDataTypeServiceWorkerRegistrations,
            WKWebsiteDataTypeFetchCache,
            WKWebsiteDataTypeDiskCache,
            WKWebsiteDataTypeMemoryCache,
        ]
        WKWebsiteDataStore.default().removeData(ofTypes: tipos, modifiedSince: .distantPast) { [weak self] in
            self?.prepararBackend()
        }
    }

    /// Encerra o uvicorn que subimos (o backend externo, se houver, fica de pé).
    func applicationWillTerminate(_ notification: Notification) {
        backend?.terminate()
    }

    // MARK: - Backend local

    /// Usa o backend que já estiver no ar; senão sobe o uvicorn do venv e espera responder.
    private func prepararBackend() {
        // Servidor remoto (FINCONTROL_URL): não há o que subir, é só carregar.
        guard servidorLocal else { carregarApp(); return }
        mostrarAviso(titulo: "Iniciando…", corpo: "Conectando ao backend do FinControl.", instrucoes: nil)
        responde { [weak self] noAr in
            guard let self else { return }
            if noAr { self.carregarApp(); return }
            guard let dir = acharBackend() else {
                self.mostrarAviso(
                    titulo: "Backend não encontrado",
                    corpo: "Não achei um checkout do FinControl com o ambiente Python pronto.",
                    instrucoes: "Esperado em <code>~/Projects/fincontrol/backend/.venv</code>. "
                        + "Se o projeto está em outro lugar, defina <code>FINCONTROL_HOME</code>."
                )
                return
            }
            self.iniciarUvicorn(em: dir)
            self.esperarBackend(tentativasRestantes: 40)
        }
    }

    private func iniciarUvicorn(em dir: URL) {
        let processo = Process()
        processo.executableURL = dir.appendingPathComponent(".venv/bin/uvicorn")
        processo.arguments = ["app.main:app", "--host", "127.0.0.1", "--port", String(porta)]
        processo.currentDirectoryURL = dir
        // Mesma origem extra do script de terminal: permite que o app do iPhone use este backend.
        var ambiente = ProcessInfo.processInfo.environment
        ambiente["FINCONTROL_CORS_ORIGINS"] = "capacitor://localhost"
        processo.environment = ambiente
        do {
            try processo.run()
            backend = processo
        } catch {
            mostrarAviso(
                titulo: "Falha ao iniciar o backend",
                corpo: error.localizedDescription,
                instrucoes: "Rode <code>.venv/bin/uvicorn app.main:app</code> em <code>backend/</code> e reabra o app."
            )
        }
    }

    /// Poll a cada 0,5 s até o backend responder (uvicorn leva ~1–2 s para subir).
    private func esperarBackend(tentativasRestantes: Int) {
        guard backend != nil else { return }  // falhou ao iniciar: aviso já está na tela
        responde { [weak self] noAr in
            guard let self else { return }
            if noAr { self.carregarApp(); return }
            guard tentativasRestantes > 0 else {
                // uvicorn já morreu: quase sempre é a porta 8000 tomada por outro serviço.
                let morreu = self.backend?.isRunning == false
                self.mostrarAviso(
                    titulo: "O backend não respondeu",
                    corpo: morreu
                        ? "O servidor local encerrou logo após iniciar — a porta \(porta) pode estar em uso por outro app."
                        : "Iniciei o servidor local, mas ele não atendeu em \(urlApp.absoluteString).",
                    instrucoes: "Rode <code>.venv/bin/uvicorn app.main:app</code> em <code>backend/</code> "
                        + "para ver o erro, e use ⌘R para tentar de novo."
                )
                return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                self.esperarBackend(tentativasRestantes: tentativasRestantes - 1)
            }
        }
    }

    /// `/api/health` em vez da raiz: qualquer servidor na porta 8000 responde 200 em `/`,
    /// e carregar o app errado seria pior que avisar que o backend não subiu.
    private func responde(_ pronto: @escaping (Bool) -> Void) {
        let req = URLRequest(
            url: urlApp.appendingPathComponent("api/health"),
            cachePolicy: .reloadIgnoringLocalCacheData,
            timeoutInterval: 1.5
        )
        URLSession.shared.dataTask(with: req) { dados, resposta, _ in
            let http = (resposta as? HTTPURLResponse)?.statusCode == 200
            let nosso = dados.map { String(decoding: $0, as: UTF8.self).contains("\"ok\"") } ?? false
            DispatchQueue.main.async { pronto(http && nosso) }
        }.resume()
    }

    private func carregarApp() {
        // Shell sempre buscado no servidor; os bundles com hash continuam cacheáveis.
        webView.load(URLRequest(url: urlApp, cachePolicy: .reloadIgnoringLocalCacheData))
    }

    /// Página de status/erro no lugar da janela em branco.
    private func mostrarAviso(titulo: String, corpo: String, instrucoes: String?) {
        let extra = instrucoes.map { "<p class=\"dica\">\($0)</p>" } ?? ""
        webView.loadHTMLString(
            """
            <!doctype html><meta charset="utf-8">
            <style>
              :root { color-scheme: dark }
              body { margin:0; height:100vh; display:grid; place-content:center; gap:.6rem;
                     background:#0d0d12; color:#e8e8ee; text-align:center; padding:2rem;
                     font:16px/1.5 -apple-system, system-ui, sans-serif }
              h1 { font-size:1.25rem; margin:0 }
              p { margin:0; color:#a0a0b0; max-width:38rem }
              .dica { font-size:.9rem }
              code { background:#1c1c26; padding:.1rem .3rem; border-radius:4px; color:#cdd0ff }
            </style>
            <h1>\(titulo)</h1><p>\(corpo)</p>\(extra)
            """,
            baseURL: nil
        )
    }

    /// ⌘R: se o backend ainda não subiu, recomeça o fluxo em vez de recarregar o aviso.
    @objc func recarregar(_ sender: Any?) {
        if webView.url == nil {
            prepararBackend()
        } else {
            webView.reloadFromOrigin()
        }
    }

    /// window.open (ex.: "ver anexo") → nova janela nativa com WKWebView.
    /// Sem este delegate o WKWebView ignora window.open silenciosamente. A view
    /// DEVE usar a configuration recebida (blob: URLs vivem no processo da página).
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        let visao = WKWebView(frame: .zero, configuration: configuration)
        visao.uiDelegate = self
        visao.navigationDelegate = self  // para salvar o anexo a partir da própria janela
        let nova = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 900, height: 720),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        nova.title = "Anexo — FinControl"
        nova.contentView = visao
        nova.center()
        nova.isReleasedWhenClosed = false
        nova.delegate = self  // para soltar a referência quando fechar
        nova.makeKeyAndOrderFront(nil)
        janelasExtras.append(nova)
        return visao
    }

    /// Janela de anexo fechada → sai do array (senão a web view fica retida para sempre).
    func windowWillClose(_ notification: Notification) {
        guard let fechada = notification.object as? NSWindow else { return }
        janelasExtras.removeAll { $0 === fechada }
    }

    // MARK: - Downloads

    /// `<a download>` (exportar CSV, salvar anexo). Sem esta política o WKWebView
    /// ignora o clique em silêncio — o botão parece morto.
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        preferences: WKWebpagePreferences,
        decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void
    ) {
        decisionHandler(navigationAction.shouldPerformDownload ? .download : .allow, preferences)
    }

    /// Conteúdo que a web view não sabe exibir vira download em vez de página em branco.
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    /// Salva direto em ~/Downloads (sem painel: o nome do arquivo já vem pronto do app)
    /// e nunca sobrescreve — "arquivo.csv" vira "arquivo (2).csv" se já existir.
    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        let fm = FileManager.default
        let pasta = fm.urls(for: .downloadsDirectory, in: .userDomainMask).first
            ?? fm.homeDirectoryForCurrentUser.appendingPathComponent("Downloads")
        let nome = suggestedFilename.isEmpty ? "download" : suggestedFilename
        var destino = pasta.appendingPathComponent(nome)
        if fm.fileExists(atPath: destino.path) {
            let base = destino.deletingPathExtension().lastPathComponent
            let ext = destino.pathExtension
            var n = 2
            repeat {
                let candidato = ext.isEmpty ? "\(base) (\(n))" : "\(base) (\(n)).\(ext)"
                destino = pasta.appendingPathComponent(candidato)
                n += 1
            } while fm.fileExists(atPath: destino.path)
        }
        destinos[ObjectIdentifier(download)] = destino
        completionHandler(destino)
    }

    /// Sem lista de downloads no wrapper, revelar no Finder é o único retorno visível.
    func downloadDidFinish(_ download: WKDownload) {
        if let destino = destinos.removeValue(forKey: ObjectIdentifier(download)) {
            NSWorkspace.shared.activateFileViewerSelecting([destino])
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        destinos.removeValue(forKey: ObjectIdentifier(download))
        let alerta = NSAlert()
        alerta.messageText = "Não foi possível salvar o arquivo"
        alerta.informativeText = error.localizedDescription
        alerta.runModal()
    }

    /// Painel nativo de arquivos para <input type=file> (upload de PDFs/fotos).
    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping ([URL]?) -> Void
    ) {
        let painel = NSOpenPanel()
        painel.canChooseFiles = true
        painel.canChooseDirectories = parameters.allowsDirectories
        painel.allowsMultipleSelection = parameters.allowsMultipleSelection
        painel.beginSheetModal(for: janela) { resposta in
            completionHandler(resposta == .OK ? painel.urls : nil)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    /// Menu mínimo para Cmd+Q e para copiar/colar funcionarem nos campos da web view.
    private func criarMenu() {
        let principal = NSMenu()

        let itemApp = NSMenuItem()
        principal.addItem(itemApp)
        let menuApp = NSMenu()
        menuApp.addItem(withTitle: "Recarregar", action: #selector(recarregar(_:)), keyEquivalent: "r")
        menuApp.addItem(.separator())
        menuApp.addItem(withTitle: "Sair do FinControl", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        itemApp.submenu = menuApp

        let itemEditar = NSMenuItem()
        principal.addItem(itemEditar)
        let menuEditar = NSMenu(title: "Editar")
        menuEditar.addItem(withTitle: "Desfazer", action: Selector(("undo:")), keyEquivalent: "z")
        menuEditar.addItem(withTitle: "Refazer", action: Selector(("redo:")), keyEquivalent: "Z")
        menuEditar.addItem(.separator())
        menuEditar.addItem(withTitle: "Recortar", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        menuEditar.addItem(withTitle: "Copiar", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        menuEditar.addItem(withTitle: "Colar", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        menuEditar.addItem(withTitle: "Selecionar Tudo", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        itemEditar.submenu = menuEditar

        let itemJanela = NSMenuItem()
        principal.addItem(itemJanela)
        let menuJanela = NSMenu(title: "Janela")
        menuJanela.addItem(withTitle: "Minimizar", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        menuJanela.addItem(withTitle: "Fechar", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        itemJanela.submenu = menuJanela
        NSApp.windowsMenu = menuJanela

        NSApp.mainMenu = principal
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
