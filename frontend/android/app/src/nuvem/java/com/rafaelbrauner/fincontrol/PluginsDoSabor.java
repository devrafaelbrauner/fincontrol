package com.rafaelbrauner.fincontrol;

import com.getcapacitor.BridgeActivity;

/**
 * Sabor `nuvem`: nenhum plugin nativo próprio. O `BackendLocal` só existe no sabor `local`
 * (src/local/.../PluginsDoSabor.kt); aqui a chamada da MainActivity não faz nada.
 */
public final class PluginsDoSabor {

    private PluginsDoSabor() {}

    public static void registrar(BridgeActivity atividade) {}
}
