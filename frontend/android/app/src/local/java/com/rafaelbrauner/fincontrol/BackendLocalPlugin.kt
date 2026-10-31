package com.rafaelbrauner.fincontrol

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Ponte `BackendLocal`, só no sabor `local`: o par dos comandos `backend_*` do Tauri, para o
 * `backendLocal.ts` e a `TelaBackend` servirem igual (o adaptador do front é da S1b).
 *
 * - `estado()` → `{estado: "iniciando" | "pronto" | "falhou", motivo?}`; o evento `estado`
 *   leva o mesmo payload a cada troca;
 * - `info()` → `{base: "http://127.0.0.1:<porta>", token}`, só em `pronto`; fora dele rejeita
 *   com `nao_pronto`. Token e porta valem o processo: o front os guarda só em memória;
 * - `reiniciar()` → relança o processo (token e porta novos); nunca reimporta o `app.main`;
 * - `pastaDeDados()` → `{caminho}` da pasta de dados do backend, para exibir.
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

    private fun js(estado: RuntimeBackend.Estado) = JSObject().apply {
        put("estado", estado.nome)
        if (estado is RuntimeBackend.Estado.Falhou) put("motivo", estado.motivo)
    }
}
