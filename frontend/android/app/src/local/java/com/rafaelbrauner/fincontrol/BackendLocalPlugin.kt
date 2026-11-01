package com.rafaelbrauner.fincontrol

import android.content.ActivityNotFoundException
import android.content.Intent
import android.util.Log
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File

/**
 * Ponte `BackendLocal`, só no sabor `local`: o par dos comandos `backend_*` do Tauri, para o
 * `backendLocal.ts` e a `TelaBackend` servirem igual (o adaptador do front é da S1b).
 *
 * - `estado()` → `{estado: "iniciando" | "pronto" | "falhou", motivo?}`; o evento `estado`
 *   leva o mesmo payload a cada troca;
 * - `info()` → `{base: "http://127.0.0.1:<porta>", token}`, só em `pronto`; fora dele rejeita
 *   com `nao_pronto`. Token e porta valem o processo: o front os guarda só em memória;
 * - `reiniciar()` → relança o processo (token e porta novos); nunca reimporta o `app.main`;
 * - `pastaDeDados()` → `{caminho}` da pasta de dados do backend, para exibir;
 * - `abrirAnexo({caminho})` → abre o anexo no app padrão pelo FileProvider (ver o método).
 */
@CapacitorPlugin(name = "BackendLocal")
class BackendLocalPlugin : Plugin() {

    // Na thread dos métodos do plugin (a do `addListener`), não na do RuntimeBackend.
    private val ouvinte = RuntimeBackend.Ouvinte { estado -> execute { notifyListeners("estado", js(estado)) } }

    override fun load() {
        RuntimeBackend.ouvir(ouvinte)
    }

    override fun handleOnDestroy() {
        RuntimeBackend.pararDeOuvir(ouvinte)
    }

    @PluginMethod
    fun estado(call: PluginCall) {
        call.resolve(js(RuntimeBackend.estado()))
    }

    @PluginMethod
    fun info(call: PluginCall) {
        val info = RuntimeBackend.info() ?: return call.reject("nao_pronto", "nao_pronto")
        call.resolve(JSObject().put("base", info.base).put("token", info.token))
    }

    @PluginMethod
    fun reiniciar(call: PluginCall) {
        val atividade = activity ?: return call.reject("sem_tela", "sem_tela")
        call.resolve()
        RuntimeBackend.relancarProcesso(atividade)
    }

    @PluginMethod
    fun pastaDeDados(call: PluginCall) {
        call.resolve(JSObject().put("caminho", RuntimeBackend.pastaDeDados(context).absolutePath))
    }

    /**
     * Abre um anexo no app padrão do aparelho. `caminho` é o que o `/anexos/{id}/abrir` do backend
     * devolve, relativo à pasta de dados (`uploads/<arquivo>`); a casca confere de novo, porque
     * quem chama é o WebView: só um arquivo que existe dentro de `uploads/` (depois de resolver
     * `..` e links) e só os tipos que o backend aceita. O outro app recebe um `content://` do
     * FileProvider, que neste sabor só expõe `uploads/` e `exportacoes/` (`res/xml/file_paths.xml`),
     * com leitura concedida só para esta abertura. Rejeita com `caminho_invalido`, `tipo_invalido`
     * ou `sem_app`; o logcat leva só o tipo, nunca o caminho.
     */
    @PluginMethod
    fun abrirAnexo(call: PluginCall) {
        val atividade = activity ?: return call.reject("sem_tela", "sem_tela")
        val arquivo = anexoEmUploads(call.getString("caminho")) ?: return recusar(call, "caminho_invalido")
        val tipo = TIPOS_DE_ANEXO[arquivo.extension.lowercase()] ?: return recusar(call, "tipo_invalido")
        val uri = try {
            FileProvider.getUriForFile(atividade, "${atividade.packageName}.fileprovider", arquivo)
        } catch (e: IllegalArgumentException) {
            return recusar(call, "caminho_invalido") // fora das pastas do file_paths.xml
        }
        val abrir = Intent(Intent.ACTION_VIEW).setDataAndType(uri, tipo).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        try {
            atividade.startActivity(abrir)
        } catch (e: ActivityNotFoundException) {
            return recusar(call, "sem_app")
        }
        Log.i(TAG, "abrirAnexo: $tipo entregue ao app padrão")
        call.resolve()
    }

    /** O arquivo, se `relativo` cair dentro de `<dados>/uploads/` e existir; senão, null. */
    private fun anexoEmUploads(relativo: String?): File? {
        if (relativo.isNullOrBlank()) return null
        val dados = RuntimeBackend.pastaDeDados(context)
        val uploads = File(dados, "uploads").canonicalFile
        val arquivo = File(dados, relativo).canonicalFile
        return arquivo.takeIf { it.path.startsWith(uploads.path + File.separator) && it.isFile }
    }

    private fun recusar(call: PluginCall, codigo: String) {
        Log.w(TAG, "abrirAnexo recusado: $codigo")
        call.reject(codigo, codigo)
    }

    private fun js(estado: RuntimeBackend.Estado) = JSObject().apply {
        put("estado", estado.nome)
        if (estado is RuntimeBackend.Estado.Falhou) put("motivo", estado.motivo)
    }

    private companion object {
        const val TAG = "FinControlLocal"

        /** Extensão → tipo, os mesmos de `TIPOS_PERMITIDOS` em `backend/app/routers/anexos.py`. */
        val TIPOS_DE_ANEXO = mapOf(
            "pdf" to "application/pdf",
            "jpg" to "image/jpeg",
            "png" to "image/png",
            "heic" to "image/heic",
            "webp" to "image/webp",
        )
    }
}
