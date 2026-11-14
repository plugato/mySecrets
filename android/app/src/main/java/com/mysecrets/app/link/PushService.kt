package com.mysecrets.app.link

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.mysecrets.app.Settings
import java.util.Collections

/**
 * Recebe os avisos do PC. Só age se a mensagem foi assinada com o segredo de
 * um pareamento deste celular; qualquer outra coisa é ignorada em silêncio.
 *  - "wake": o PC vai procurar o celular na rede local ([LinkListenService]);
 *  - "relay": há pedido na caixa postal do site ([Relay]); busca e notifica.
 */
class PushService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        Settings.pushToken = token
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val d = message.data
        val type = d["type"]
        if ((type != "wake" && type != "relay") || !Settings.pushEnabled) return
        val pairId = d["pairId"].orEmpty()
        val ts = d["ts"].orEmpty()
        val nonce = d["nonce"].orEmpty()
        val pc = Pairings.find(pairId) ?: return
        val ok = try {
            if (type == "relay") RelayProtocol.verifyRelayPush(pc.secret(), pairId, ts, nonce, d["sig"])
            else LinkProtocol.verifyWake(pc.secret(), pairId, ts, nonce, d["sig"])
        } catch (e: Exception) {
            Log.w(TAG, "push não verificado: ${e.message}")
            false
        }
        if (!ok || !seen.add("$type|$nonce")) return
        if (seen.size > 100) synchronized(seen) { seen.remove(seen.first()) }
        if (type == "relay") {
            // Já numa thread de fundo (com ~10 s): busca na hora e mostra as notificações
            Log.i(TAG, "PC ${pc.desktopName} deixou pedido na caixa postal")
            Relay.fetch(applicationContext, pairId)
            return
        }
        Log.i(TAG, "PC ${pc.desktopName} pediu aprovação; escutando a rede local")
        LinkListenService.start(applicationContext)
    }

    companion object {
        private const val TAG = "MySecretsPush"
        private val seen = Collections.synchronizedSet(LinkedHashSet<String>())
    }
}
