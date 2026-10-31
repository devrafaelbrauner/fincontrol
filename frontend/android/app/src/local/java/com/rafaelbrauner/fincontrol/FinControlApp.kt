package com.rafaelbrauner.fincontrol

import android.app.Application
import java.util.concurrent.Executors

/**
 * Sabor `local`: sobe o backend embutido uma vez por processo, fora da main thread, já no
 * `onCreate` do app, antes do WebView (NF1). Token, cofre, prova e estado ficam no
 * `RuntimeBackend`; o front os vê pelo plugin `BackendLocal`.
 */
class FinControlApp : Application() {

    override fun onCreate() {
        super.onCreate()
        val executor = Executors.newSingleThreadExecutor { tarefa -> Thread(tarefa, "backend-local") }
        executor.execute { RuntimeBackend.iniciar(this) }
        executor.shutdown() // a tarefa já entregue roda até o fim; depois a thread acaba
    }
}
