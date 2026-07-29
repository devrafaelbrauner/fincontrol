import Cocoa
import WebKit

/// Wrapper nativo mínimo: uma janela com WKWebView apontando para o backend
/// local, que serve o frontend buildado (frontend/dist) na porta 8000.
let urlApp = URL(string: "http://127.0.0.1:8000")!

class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var janela: NSWindow!
    var webView: WKWebView!

    func applicationDidFinishLaunching(_ notification: Notification) {
        criarMenu()

        let config = WKWebViewConfiguration()
        // Dentro do wrapper o backend é local — service worker só serve conteúdo
        // defasado do cache; desregistra qualquer um e mantém localStorage (login).
        let semSW = WKUserScript(
            source: "navigator.serviceWorker?.getRegistrations().then(rs => rs.forEach(r => r.unregister()));",
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(semSW)
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self

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

        webView.load(URLRequest(url: urlApp))
    }

    /// Backend ainda subindo → tenta de novo em 1 s em vez de mostrar erro.
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
            self?.webView.load(URLRequest(url: urlApp))
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    /// Menu mínimo para Cmd+Q e para copiar/colar funcionarem nos campos da web view.
    private func criarMenu() {
        let principal = NSMenu()

        let itemApp = NSMenuItem()
        principal.addItem(itemApp)
        let menuApp = NSMenu()
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
