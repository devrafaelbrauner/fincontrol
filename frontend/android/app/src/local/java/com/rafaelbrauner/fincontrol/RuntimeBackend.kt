package com.rafaelbrauner.fincontrol

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.util.Log
import com.chaquo.python.PyException
import com.chaquo.python.Python
import com.chaquo.python.android.AndroidPlatform
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.atomic.AtomicBoolean
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.system.exitProcess

/**
 * Backend embutido do sabor `local`: o par da casca Rust do desktop (`sidecar.rs`), aqui
 * dentro do processo do app.
 *
 * Uma vez por processo (o `FinControlApp` chama num executor, antes do WebView): sorteia o
 * token (64 hex), lê os segredos do `CofreBackend`, sobe o Python e chama
 * `app.android.iniciar`, que faz o bind em 127.0.0.1:0 e devolve a porta. Só fica `pronto`
 * depois de o `/api/health` devolver a prova HMAC do nonce com esse token, por socket cru
 * (`sidecar.rs:555-590`): quem responde na porta conhece o token sem ele trafegar. Estados e
 * payload são os do Tauri (`sidecar.rs:42-50`) para a `TelaBackend` servir igual:
 * `iniciando`, `pronto` e `falhou` com um motivo legível. Token e porta valem o processo;
 * reiniciar é relançar o processo (o `app.main` não se importa duas vezes), o que também traz
 * token e porta novos.
 *
 * Logcat: só estado, porta e tempos. Nunca token, nonce, prova, segredo ou a mensagem de uma
 * exceção do Python (pode carregar valores); da falha sai só o tipo.
 */
internal object RuntimeBackend {

    sealed class Estado(val nome: String) {
        data object Iniciando : Estado("iniciando")
        data object Pronto : Estado("pronto")
        data class Falhou(val motivo: String) : Estado("falhou")
    }

    class Info(val base: String, val token: String)

    fun interface Ouvinte {
        fun mudou(estado: Estado)
    }

    private const val TAG = "FinControlLocal"
    private const val PRAZO_PROVA_MS = 5_000L
    private const val PAUSA_PROVA_MS = 100L
    private const val ESPERA_RELANCAR_MS = 300L
    private const val RESPOSTA_MAX = 64 * 1024
    private val IDENTIFICADOR = Regex("[A-Za-z_][A-Za-z0-9_]*")
    private val ERROS_DE_ARQUIVO = setOf(
        "OSError", "PermissionError", "FileExistsError", "FileNotFoundError", "NotADirectoryError",
        "IsADirectoryError",
    )

    private val aleatorio = SecureRandom()

    /** 64 hex novos a cada processo; saem daqui só para o Python e pelo `info()` do plugin. */
    private val token: String = hex(ByteArray(32).also(aleatorio::nextBytes))
    private val iniciado = AtomicBoolean(false)
    private val ouvintes = CopyOnWriteArraySet<Ouvinte>()
    private val trava = Any()
    private var estado: Estado = Estado.Iniciando // sob `trava`
    private var porta = 0 // sob `trava`; diferente de 0 só em `pronto`

    fun estado(): Estado = synchronized(trava) { estado }

    /** Base e token só em `pronto` (como o `backend_info` do Tauri); fora dele, null. */
    fun info(): Info? = synchronized(trava) {
        if (estado == Estado.Pronto) Info("http://127.0.0.1:$porta", token) else null
    }

    fun pastaDeDados(contexto: Context) = File(contexto.filesDir, "fincontrol")

    fun ouvir(ouvinte: Ouvinte) {
        ouvintes.add(ouvinte)
    }

    fun pararDeOuvir(ouvinte: Ouvinte) {
        ouvintes.remove(ouvinte)
    }

    /** Bloqueia até `pronto` ou `falhou`; chamar fora da main thread. Só a 1ª chamada age. */
    fun iniciar(contexto: Context) {
        if (!iniciado.compareAndSet(false, true)) return
        val app = contexto.applicationContext
        val inicio = SystemClock.elapsedRealtime()
        Log.i(TAG, "estado: iniciando (${desdeOInicioDoProcesso()} ms desde o início do processo)")
        var etapa = "python"
        try {
            if (!Python.isStarted()) Python.start(AndroidPlatform(app))
            val python = SystemClock.elapsedRealtime()
            etapa = "cofre"
            val segredos = CofreBackend.segredos(app)
            val cofre = SystemClock.elapsedRealtime()
            etapa = "backend"
            val entrada = JSONObject()
                .put("secret_key", segredos.secretKey)
                .put("fernet_key", segredos.fernetKey)
                .put("token", token)
                .toString()
            val aberta = Python.getInstance().getModule("app.android")
                .callAttr("iniciar", pastaDeDados(app).absolutePath, entrada)
                .toInt()
            val iniciou = SystemClock.elapsedRealtime()
            if (!provar(aberta)) {
                falhar("o backend em 127.0.0.1:$aberta não provou o token no /api/health", inicio)
                return
            }
            mudar(Estado.Pronto, aberta)
            Log.i(
                TAG,
                "estado: pronto em 127.0.0.1:$aberta, ${desdeOInicioDoProcesso()} ms desde o início do processo " +
                    "(python ${python - inicio} ms, cofre ${cofre - python} ms " +
                    "${if (segredos.gerados) "com segredos gerados no 1º uso" else "com segredos lidos"}, " +
                    "iniciar ${iniciou - cofre} ms, prova ${SystemClock.elapsedRealtime() - iniciou} ms)",
            )
        } catch (e: Throwable) {
            falhar(motivo(etapa, e), inicio)
        }
    }

    /**
     * `reiniciar` do plugin. O backend só sobe de novo num processo novo: avisa `iniciando`
     * (o `info()` passa a recusar), reabre a tela de entrada numa tarefa nova e encerra este
     * processo; o sistema cria outro para ela, e o `FinControlApp` sobe tudo de novo.
     */
    fun relancarProcesso(atividade: Activity) {
        mudar(Estado.Iniciando, 0)
        Log.i(TAG, "reiniciar: relançando o processo")
        val tela = atividade.packageManager.getLaunchIntentForPackage(atividade.packageName)?.component
            ?: atividade.componentName
        Handler(Looper.getMainLooper()).postDelayed({
            atividade.startActivity(Intent.makeRestartActivityTask(tela))
            exitProcess(0)
        }, ESPERA_RELANCAR_MS)
    }

    private fun mudar(novo: Estado, novaPorta: Int = 0) {
        synchronized(trava) {
            estado = novo
            porta = novaPorta
        }
        ouvintes.forEach { it.mudou(novo) }
    }

    private fun falhar(motivo: String, inicio: Long) {
        mudar(Estado.Falhou(motivo))
        Log.w(TAG, "estado: falhou ($motivo) em ${SystemClock.elapsedRealtime() - inicio} ms")
    }

    /** Motivo legível para a tela e o log: texto fixo e o tipo do erro, nunca a mensagem. */
    private fun motivo(etapa: String, e: Throwable): String {
        if (e is CofreBackend.Falha) return "cofre: ${e.message}"
        if (etapa == "python") return "o Python embutido não iniciou (${e.javaClass.simpleName})"
        if (etapa == "cofre") return "cofre: falhou (${e.javaClass.simpleName})"
        if (e !is PyException) return "o backend falhou ao iniciar (${e.javaClass.simpleName})"
        return when (val tipo = tipoPython(e)) {
            "TimeoutError" -> "o backend não ficou pronto a tempo (TimeoutError)"
            "EntradaInvalida" -> "o backend recusou os segredos do cofre (EntradaInvalida)"
            "ImportError", "ModuleNotFoundError" -> "o backend não carregou: falta um módulo ($tipo)"
            in ERROS_DE_ARQUIVO -> "o backend não abriu a porta local ou a pasta de dados ($tipo)"
            else -> "o backend falhou ao iniciar ($tipo)"
        }
    }

    /** "app.desktop.EntradaInvalida: ..." → "EntradaInvalida"; o resto da mensagem fica de fora. */
    private fun tipoPython(e: PyException): String {
        val tipo = e.message.orEmpty().lineSequence().first().substringBefore(':').substringAfterLast('.').trim()
        return if (IDENTIFICADOR.matches(tipo)) tipo else "erro do Python"
    }

    /** Prova até o prazo: o `iniciar` só volta com o uvicorn aceitando, mas a 1ª pode falhar. */
    private fun provar(porta: Int): Boolean {
        val limite = SystemClock.elapsedRealtime() + PRAZO_PROVA_MS
        while (true) {
            if (runCatching { saudavel(porta) }.getOrDefault(false)) return true
            if (SystemClock.elapsedRealtime() >= limite) return false
            SystemClock.sleep(PAUSA_PROVA_MS)
        }
    }

    /** `GET /api/health` com nonce novo: pronto só com 200, `ok` e prova = HMAC-SHA256(token, nonce). */
    private fun saudavel(porta: Int): Boolean {
        val nonce = hex(ByteArray(16).also(aleatorio::nextBytes))
        // nosemgrep: kotlin.lang.security.unencrypted-socket.unencrypted-socket — loopback (127.0.0.1); trafegam só o nonce e a prova HMAC, nunca o token
        val bruto = Socket().use { socket ->
            socket.connect(InetSocketAddress(InetAddress.getByAddress(byteArrayOf(127, 0, 0, 1)), porta), 1_000)
            socket.soTimeout = 2_000
            socket.getOutputStream().write(
                ("GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:$porta\r\nX-FinControl-Nonce: $nonce\r\n" +
                    "Connection: close\r\n\r\n").toByteArray(Charsets.US_ASCII),
            )
            lerAte(socket.getInputStream(), RESPOSTA_MAX)
        }
        val texto = String(bruto, Charsets.UTF_8)
        val fimDoCabecalho = texto.indexOf("\r\n\r\n")
        if (fimDoCabecalho < 0) return false
        val status = texto.substring(0, fimDoCabecalho).lineSequence().first().split(' ').getOrNull(1)
        if (status != "200") return false
        val corpo = runCatching { JSONObject(texto.substring(fimDoCabecalho + 4)) }.getOrNull() ?: return false
        if (!corpo.optBoolean("ok", false)) return false
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(token.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        val esperada = hex(mac.doFinal(nonce.toByteArray(Charsets.UTF_8)))
        return MessageDigest.isEqual(
            corpo.optString("prova", "").toByteArray(Charsets.UTF_8),
            esperada.toByteArray(Charsets.UTF_8),
        )
    }

    private fun lerAte(entrada: InputStream, limite: Int): ByteArray {
        val saida = ByteArrayOutputStream()
        val bloco = ByteArray(4096)
        while (saida.size() < limite) {
            val lidos = entrada.read(bloco, 0, minOf(bloco.size, limite - saida.size()))
            if (lidos < 0) break
            saida.write(bloco, 0, lidos)
        }
        return saida.toByteArray()
    }

    private fun desdeOInicioDoProcesso() = SystemClock.elapsedRealtime() - Process.getStartElapsedRealtime()

    private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }
}
