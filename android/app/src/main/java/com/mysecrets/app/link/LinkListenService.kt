package com.mysecrets.app.link

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
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
import com.mysecrets.app.MySecretsApp
import com.mysecrets.app.R
import com.mysecrets.app.str
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * Depois do push do PC: mantém o [LinkServer] escutando por um tempo curto,
 * com o app fechado. Quando o pedido chega e o app não está na tela, mostra a
 * notificação que acende a tela e abre a [ApprovalActivity] (digital direto).
 */
class LinkListenService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var job: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        try {
            channels(this)
            val n: Notification = NotificationCompat.Builder(this, CHANNEL_WAIT)
                .setSmallIcon(android.R.drawable.ic_lock_lock)
                .setContentTitle(str(R.string.aguardando_o_pc))
                .setContentText(str(R.string.o_pc_pediu_para_abrir_o_mysecrets))
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build()
            ServiceCompat.startForeground(this, ID_WAIT, n,
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0)
        } catch (e: Exception) {
            Log.w(TAG, "não foi possível ficar em primeiro plano: ${e.message}")
            stopSelf()
            return START_NOT_STICKY
        }
        LinkServer.acquire(OWNER)
        // Novo push durante a espera: recomeça a contagem
        job?.cancel()
        job = scope.launch { follow() }
        return START_NOT_STICKY
    }

    private suspend fun follow() {
        val nm = getSystemService(NotificationManager::class.java)
        // O PC procura o celular logo depois de mandar o push
        val req = kotlinx.coroutines.withTimeoutOrNull(WAIT_MS) { LinkServer.request.first { it != null } }
        if (req != null) {
            if (!MySecretsApp.inForeground) nm.notify(ID_REQUEST, requestNotification(req))
            LinkServer.request.first { it !== req }
            nm.cancel(ID_REQUEST)
            // Dá tempo de a resposta sair pela conexão antes de fechar o servidor
            delay(3000)
        }
        stopSelf()
    }

    private fun requestNotification(r: LinkServer.ApprovalRequest): Notification {
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        // Toque, botão "Aprovar" e tela cheia: todos abrem só o prompt da digital
        val open = PendingIntent.getActivity(this, 0,
            Intent(this, ApprovalActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), flags)
        val deny = PendingIntent.getBroadcast(this, 1,
            Intent(this, ApprovalActionReceiver::class.java).setAction(ApprovalActionReceiver.ACTION_DENY), flags)
        return NotificationCompat.Builder(this, CHANNEL_REQUEST)
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setContentTitle(str(R.string.desbloquear_pc_nome, r.desktopName))
            .setContentText(str(R.string.codigo_toque_para_aprovar, r.code))
            .setStyle(NotificationCompat.BigTextStyle().bigText(str(R.string.codigo_toque_para_aprovar, r.code)))
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(open)
            .setFullScreenIntent(open, true)
            .addAction(0, str(R.string.aprovar), open)
            .addAction(0, str(R.string.negar), deny)
            // Fica até o pedido terminar (o serviço tira): cancelar a digital não perde o pedido
            .setOngoing(true)
            .setTimeoutAfter(90_000)
            .build()
    }

    override fun onDestroy() {
        scope.cancel()
        getSystemService(NotificationManager::class.java).cancel(ID_REQUEST)
        LinkServer.release(OWNER)
        super.onDestroy()
    }

    companion object {
        private const val TAG = "MySecretsLink"
        private const val OWNER = "push"
        private const val CHANNEL_WAIT = "pc-wait"
        private const val CHANNEL_REQUEST = "pc-unlock"
        private const val ID_WAIT = 4301
        private const val ID_REQUEST = 4302
        private const val WAIT_MS = 2 * 60 * 1000L

        private fun channels(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val nm = context.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CHANNEL_WAIT, str(R.string.canal_aguardando_o_pc), NotificationManager.IMPORTANCE_LOW))
            nm.createNotificationChannel(NotificationChannel(CHANNEL_REQUEST, str(R.string.canal_pedidos_do_pc), NotificationManager.IMPORTANCE_HIGH).apply {
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            })
        }

        /** Chamado pelo push (mensagem de alta prioridade libera o serviço em primeiro plano). */
        fun start(context: Context) {
            try {
                ContextCompat.startForegroundService(context, Intent(context, LinkListenService::class.java))
            } catch (e: Exception) {
                Log.w(TAG, "serviço de escuta não iniciou: ${e.message}")
            }
        }
    }
}
