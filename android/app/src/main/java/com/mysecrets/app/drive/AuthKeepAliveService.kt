package com.mysecrets.app.drive

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.mysecrets.app.R
import com.mysecrets.app.str

/**
 * Serviço em primeiro plano só durante o login com Google. Com o Chrome na
 * frente, o MySecrets fica em segundo plano e o HyperOS/MIUI (e o "freezer" do
 * Android) congelam ou matam o processo: o servidor loopback 127.0.0.1 que
 * recebe o retorno do Google deixava de responder e o Chrome mostrava erro.
 */
class AuthKeepAliveService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        try {
            val nm = getSystemService(NotificationManager::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                nm.createNotificationChannel(NotificationChannel(CHANNEL, str(R.string.login_com_google), NotificationManager.IMPORTANCE_LOW))
            }
            val n: Notification = NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setContentTitle(str(R.string.login_com_google))
                .setContentText(str(R.string.aguardando_o_login_no_navegador))
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build()
            ServiceCompat.startForeground(this, NOTIFICATION_ID, n,
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0)
        } catch (e: Exception) {
            Log.w(TAG, "não foi possível ficar em primeiro plano: ${e.message}")
            stopSelf()
        }
        return START_NOT_STICKY
    }

    companion object {
        private const val TAG = "MySecretsAuth"
        private const val CHANNEL = "google-login"
        private const val NOTIFICATION_ID = 4201

        /** Melhor esforço: se o sistema recusar, o login segue sem o serviço. */
        fun start(context: Context) {
            try {
                ContextCompat.startForegroundService(context, Intent(context, AuthKeepAliveService::class.java))
            } catch (e: Exception) {
                Log.w(TAG, "serviço de login não iniciou: ${e.message}")
            }
        }

        fun stop(context: Context) {
            try { context.stopService(Intent(context, AuthKeepAliveService::class.java)) } catch (_: Exception) {}
        }
    }
}
