package com.mysecrets.app

import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.SystemClock
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.mysecrets.app.drive.DriveSync
import com.mysecrets.app.link.LinkServer
import com.mysecrets.app.link.Pairings
import com.mysecrets.app.link.Push
import com.mysecrets.app.vault.Vault

/**
 * Texto de res/values/strings.xml (ou values-en) de qualquer lugar do app (telas, erros,
 * serviços). Fora do app (testes JVM) devolve um marcador em vez de quebrar.
 */
fun str(@androidx.annotation.StringRes id: Int, vararg args: Any?): String =
    MySecretsApp.instance?.let { app -> runCatching { app.getString(id, *args) }.getOrNull() } ?: "#$id"

class MySecretsApp : Application() {
    /**
     * O app passou a ter inglês. Quem já tinha cofre (usava em português)
     * continua em português mesmo com o celular em inglês; a troca fica em
     * Configurações do Android > Apps > MySecrets > Idioma (Android 13+).
     */
    private fun manterPortuguesParaQuemJaUsava() {
        if (android.os.Build.VERSION.SDK_INT < 33) return
        val prefs = getSharedPreferences("idioma", MODE_PRIVATE)
        if (prefs.getBoolean("migrado", false)) return
        try {
            val lm = getSystemService(android.app.LocaleManager::class.java)
            if (Vault.exists() && lm.applicationLocales.isEmpty) {
                lm.applicationLocales = android.os.LocaleList.forLanguageTags("pt-BR")
            }
        } catch (_: Exception) { /* sem LocaleManager: segue o sistema */ }
        prefs.edit().putBoolean("migrado", true).apply()
    }

    companion object {
        /** O app em execução (para str()); null nos testes JVM. */
        @Volatile var instance: MySecretsApp? = null
            private set

        /**
         * Telas abertas pelo próprio app (leitor de QR, login do Google, salvar
         * arquivo) põem o app em segundo plano. Enquanto uma delas estiver aberta o
         * bloqueio automático não conta — senão o cofre trancava na volta e a ação
         * em andamento (ex.: parear com o PC) era cancelada.
         */
        @Volatile private var externalFlows = 0

        suspend fun <T> duringExternalFlow(block: suspend () -> T): T {
            synchronized(this) { externalFlows++ }
            try {
                return block()
            } finally {
                synchronized(this) { externalFlows-- }
            }
        }

        fun beginExternalFlow() = synchronized(this) { externalFlows++ }
        fun endExternalFlow() = synchronized(this) { if (externalFlows > 0) externalFlows-- }
        val inExternalFlow: Boolean get() = externalFlows > 0

        /** Alguma tela do app está visível (senão o pedido do PC vira notificação). */
        @Volatile var inForeground = false
            private set
    }

    private var backgroundSince = 0L
    private var lastSync = 0L

    override fun onCreate() {
        super.onCreate()
        instance = this
        Settings.init(this)
        Vault.init(this)
        manterPortuguesParaQuemJaUsava()
        DriveSync.init(this)
        Pairings.init(this)
        Push.init(this)

        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                // App visível: escuta pedidos do PC na rede local
                inForeground = true
                LinkServer.acquire("ui")
                if (backgroundSince > 0 && Vault.isUnlocked && !inExternalFlow) {
                    val fora = (SystemClock.elapsedRealtime() - backgroundSince) / 1000
                    if (fora >= Settings.autoLockSeconds) Vault.lock()
                }
                backgroundSince = 0
                if (Vault.isUnlocked && SystemClock.elapsedRealtime() - lastSync > 60_000) {
                    lastSync = SystemClock.elapsedRealtime()
                    DriveSync.schedule(500)
                }
            }

            override fun onStop(owner: LifecycleOwner) {
                inForeground = false
                LinkServer.release("ui")
                backgroundSince = if (inExternalFlow) 0 else SystemClock.elapsedRealtime()
            }
        })

        // Tela apagada: bloqueia na hora
        registerReceiver(object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                Vault.lock()
                backgroundSince = 0
            }
        }, IntentFilter(Intent.ACTION_SCREEN_OFF))
    }
}
