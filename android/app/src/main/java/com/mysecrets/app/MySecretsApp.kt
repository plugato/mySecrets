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
import com.mysecrets.app.vault.Vault

class MySecretsApp : Application() {
    private var backgroundSince = 0L
    private var lastSync = 0L

    override fun onCreate() {
        super.onCreate()
        Settings.init(this)
        Vault.init(this)
        DriveSync.init(this)
        Pairings.init(this)

        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                // App visível: escuta pedidos do PC na rede local
                LinkServer.start()
                if (backgroundSince > 0 && Vault.isUnlocked) {
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
                LinkServer.stop()
                backgroundSince = SystemClock.elapsedRealtime()
            }
        })

        // Tela apagada: bloqueia na hora
        registerReceiver(object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                Vault.lock()
            }
        }, IntentFilter(Intent.ACTION_SCREEN_OFF))
    }
}
