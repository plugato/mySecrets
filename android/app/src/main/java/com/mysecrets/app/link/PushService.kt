package com.mysecrets.app.link

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.mysecrets.app.Settings
import java.util.Collections

/**
 * Recebe o "acorde" do PC. Só age se a mensagem foi assinada com o segredo de
 * um pareamento deste celular; qualquer outra coisa é ignorada em silêncio.
 */
class PushService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        Settings.pushToken = token
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val d = message.data
        if (d["type"] != "wake" || !Settings.pushEnabled) return
        val pairId = d["pairId"].orEmpty()
        val ts = d["ts"].orEmpty()
        val nonce = d["nonce"].orEmpty()
        val pc = Pairings.find(pairId) ?: return
        val ok = try {
            LinkProtocol.verifyWake(pc.secret(), pairId, ts, nonce, d["sig"])
        } catch (e: Exception) {
            Log.w(TAG, "push não verificado: ${e.message}")
            false
        }
        if (!ok || !seen.add(nonce)) return
        if (seen.size > 100) synchronized(seen) { seen.remove(seen.first()) }
        Log.i(TAG, "PC ${pc.desktopName} pediu aprovação; escutando a rede local")
        LinkListenService.start(applicationContext)
    }

    companion object {
        private const val TAG = "MySecretsPush"
        private val seen = Collections.synchronizedSet(LinkedHashSet<String>())
    }
}
