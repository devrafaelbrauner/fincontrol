package com.rafaelbrauner.fincontrol

import android.app.Activity
import android.app.Application
import android.os.Build
import android.os.Bundle
import android.os.Process
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import com.chaquo.python.Kwarg
import com.chaquo.python.Python
import com.chaquo.python.android.AndroidPlatform
import org.json.JSONObject
import java.io.File
import java.net.InetAddress
import java.net.Socket
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.Executors
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Sabor `local`, spike S0 do programa android-local: sobe o backend Python embutido
 * (Chaquopy) uma vez por processo, fora da main thread e antes do WebView, e loga o que o
 * gate precisa ver — `import app.main` no aparelho (sys.platform, SQLite em WAL, JSON), a
 * porta em 127.0.0.1, a prova HMAC do /api/health com o token do processo e os tempos de
 * boot (frio: desde o início do processo; quente: da retomada da tela à prova).
 *
 * Só spike: segredos sorteados a cada processo (nada real, nada gravado) e o token nunca
 * vai ao log. Cofre no AndroidKeyStore, RuntimeBackend e plugin para o front são da S1.
 */
class FinControlApp : Application() {

    private val executor = Executors.newSingleThreadExecutor { tarefa -> Thread(tarefa, "backend-local") }

    @Volatile
    private var backend: Pair<Int, String>? = null

    override fun onCreate() {
        super.onCreate()
        executor.execute {
            try {
                subir()
            } catch (e: Throwable) {
                Log.e(TAG, "backend local falhou", e)
            }
        }
        registerActivityLifecycleCallbacks(RetomadaMedida())
    }

    private fun subir() {
        if (!Python.isStarted()) {
            Python.start(AndroidPlatform(this))
        }
        val py = Python.getInstance()
        val dados = File(filesDir, "fincontrol")
        val resposta = py.getModule("app.android")
            .callAttr("iniciar", dados.absolutePath, segredosDoSpike())
            .asList()
        val porta = resposta[0].toInt()
        val token = resposta[1].toString()
        val aceitando = desdeOInicioDoProcesso()
        val prova = provar(porta, token)
        Log.i(TAG, "android.iniciar: backend em 127.0.0.1:$porta; aceitando conexões em $aceitando ms, " +
            "/api/health com prova ${if (prova) "OK" else "FALHOU"} em ${desdeOInicioDoProcesso()} ms " +
            "desde o início do processo (boot frio)")
        backend = porta to token
        diagnosticar(py)
    }

    /** S0.1: o que o `import app.main` deixou no processo (Python, SQLite, JSON, ABI, página). */
    private fun diagnosticar(py: Python) {
        val sys = py.getModule("sys")
        val modulos = sys["modules"]!!
        val conexao = py.getModule("app.db").callAttr("connect")
        val modoDoJornal = try {
            conexao.callAttr("execute", "PRAGMA journal_mode").callAttr("fetchone").asList()[0].toString()
        } finally {
            conexao.callAttr("close")
        }
        val json = py.getModule("json")
        val original = json.callAttr("loads", "{\"ok\": true, \"descricao\": \"Pão de açúcar\", \"valor_cents\": -1990}")
        val idaEVolta = json.callAttr("loads", json.callAttr("dumps", original, Kwarg("ensure_ascii", false)))
        Log.i(TAG, "S0.1 import app.main=${modulos.callAttr("__contains__", "app.main").toBoolean()} " +
            "sys.platform=${sys["platform"]} python=${py.getModule("platform").callAttr("python_version")} " +
            "machine=${py.getModule("platform").callAttr("machine")} abi=${Build.SUPPORTED_ABIS[0]} " +
            "pagina=${py.getModule("mmap")["PAGESIZE"]} sqlite=${py.getModule("sqlite3")["sqlite_version"]} " +
            "journal_mode=$modoDoJornal json_ida_e_volta=${idaEVolta == original} " +
            "pydantic_core=${py.getModule("pydantic_core")["__version__"]} " +
            "webauthn_importado=${modulos.callAttr("__contains__", "webauthn").toBoolean()} " +
            "VERSAO=${py.getModule("app.versao")["VERSAO"]}")
    }

    /**
     * Prova por socket cru, como a casca do desktop: quem responde na porta conhece o token
     * do processo (HMAC-SHA256 do nonce), sem o token trafegar.
     */
    private fun provar(porta: Int, token: String): Boolean {
        val nonce = hex(aleatorio(16))
        val resposta = Socket(InetAddress.getByName("127.0.0.1"), porta).use { socket ->
            socket.soTimeout = 5_000
            socket.getOutputStream().write(
                ("GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:$porta\r\n" +
                    "X-FinControl-Nonce: $nonce\r\nConnection: close\r\n\r\n").toByteArray(Charsets.US_ASCII)
            )
            socket.getInputStream().readBytes().toString(Charsets.UTF_8)
        }
        val status = resposta.substringBefore("\r\n")
        val prova = JSONObject(resposta.substringAfter("\r\n\r\n")).optString("prova")
        val mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(token.toByteArray(), "HmacSHA256")) }
        val esperada = hex(mac.doFinal(nonce.toByteArray()))
        val confere = MessageDigest.isEqual(prova.toByteArray(), esperada.toByteArray())
        Log.i(TAG, "prova /api/health: \"$status\" nonce=$nonce prova=$prova confere=$confere")
        return confere && status.startsWith("HTTP/1.1 200")
    }

    /** Quente: processo vivo, tela volta; o backend já está de pé e só se prova de novo. */
    private inner class RetomadaMedida : ActivityLifecycleCallbacks {
        override fun onActivityResumed(activity: Activity) {
            val (porta, token) = backend ?: return
            val retomada = SystemClock.elapsedRealtime()
            executor.execute {
                val ok = runCatching { provar(porta, token) }.getOrDefault(false)
                Log.i(TAG, "retomada (boot quente): /api/health com prova ${if (ok) "OK" else "FALHOU"} " +
                    "em ${SystemClock.elapsedRealtime() - retomada} ms")
            }
        }

        override fun onActivityCreated(activity: Activity, estado: Bundle?) {}
        override fun onActivityStarted(activity: Activity) {}
        override fun onActivityPaused(activity: Activity) {}
        override fun onActivityStopped(activity: Activity) {}
        override fun onActivitySaveInstanceState(activity: Activity, estado: Bundle) {}
        override fun onActivityDestroyed(activity: Activity) {}
    }

    private fun desdeOInicioDoProcesso() = SystemClock.elapsedRealtime() - Process.getStartElapsedRealtime()

    private fun segredosDoSpike(): String = JSONObject()
        .put("secret_key", hex(aleatorio(32)))
        .put("fernet_key", Base64.encodeToString(aleatorio(32), Base64.URL_SAFE or Base64.NO_WRAP))
        .toString()

    private fun aleatorio(n: Int) = ByteArray(n).also { SecureRandom().nextBytes(it) }

    private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }

    private companion object {
        const val TAG = "FinControlLocal"
    }
}
