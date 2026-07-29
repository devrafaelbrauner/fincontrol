import Cocoa
import WebKit

/// Wrapper nativo mínimo: uma janela com WKWebView apontando para o backend
/// local, que serve o frontend buildado (frontend/dist) na porta 8000.
let urlApp = URL(string: "http://127.0.0.1:8000")!

class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    var janela: NSWindow!
    var webView: WKWebView!
    var janelasExtras: [NSWindow] = []  // janelas de window.open (ex.: visualizar anexo)

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
            guard let self else { return }
            // Shell sempre buscado no servidor; os bundles com hash continuam cacheáveis.
            self.webView.load(URLRequest(url: urlApp, cachePolicy: .reloadIgnoringLocalCacheData))
        }
    }

    /// Backend ainda subindo → tenta de novo em 1 s em vez de mostrar erro.
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
            self?.webView.load(URLRequest(url: urlApp, cachePolicy: .reloadIgnoringLocalCacheData))
        }
    }

    @objc func recarregar(_ sender: Any?) {
        webView.reloadFromOrigin()
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
        visao.uiDelegate = self  // sem navigationDelegate: o retry do shell não pertence a esta janela
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
        nova.makeKeyAndOrderFront(nil)
        janelasExtras.append(nova)
        return visao
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

        NSApp.mainMenu = principal
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
