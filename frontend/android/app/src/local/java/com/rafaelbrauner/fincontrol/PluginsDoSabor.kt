package com.rafaelbrauner.fincontrol

import com.getcapacitor.BridgeActivity

/**
 * Plugins nativos do sabor `local` (o `nuvem` tem o seu `PluginsDoSabor.java`, vazio). A
 * `MainActivity` chama antes do `super.onCreate`, onde a ponte do Capacitor nasce com a lista.
 */
object PluginsDoSabor {
    @JvmStatic
    fun registrar(atividade: BridgeActivity) {
        atividade.registerPlugin(BackendLocalPlugin::class.java)
    }
}
