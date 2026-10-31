package com.rafaelbrauner.fincontrol;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Plugins nativos do sabor (o `local` registra o BackendLocal; o `nuvem`, nenhum). Antes
        // do super.onCreate: é nele que a ponte do Capacitor nasce com a lista de plugins.
        PluginsDoSabor.registrar(this);
        super.onCreate(savedInstanceState);
    }
}
