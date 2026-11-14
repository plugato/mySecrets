package com.mysecrets.app.link

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.mysecrets.app.R
import com.mysecrets.app.str

/**
 * Botões das notificações de pedido do PC que não pedem a digital:
 *  - "Negar" do pedido pela rede local;
 *  - "Negar" do pedido pelo relay (resposta "deny", sem K_d);
 *  - "Encerrar agora" da leitura liberada por tempo (resposta "end").
 */
class ApprovalActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            ACTION_DENY -> LinkServer.denyCurrent()
            ACTION_RELAY_DENY, ACTION_RELAY_END -> {
                // Rede fora da thread principal; goAsync mantém o processo vivo até responder
                val pending = goAsync()
                val app = context.applicationContext
                Thread({
                    try { relay(app, intent) } catch (_: Exception) { Relay.toast(app, str(R.string.relay_falha_envio)) } finally { pending.finish() }
                }, "mysecrets-relay-action").start()
            }
        }
    }

    private fun relay(ctx: Context, intent: Intent) {
        val reqId = intent.getStringExtra(RelayApprovalActivity.EXTRA_REQ) ?: return
        if (intent.action == ACTION_RELAY_END) {
            Relay.toast(ctx, str(if (Relay.endWindow(ctx, reqId) == Relay.Result.ERROR) R.string.relay_falha_envio else R.string.relay_liberacao_encerrada))
            return
        }
        val pairId = intent.getStringExtra(RelayApprovalActivity.EXTRA_PAIR) ?: return
        val r = Relay.findOrFetch(ctx, pairId, reqId)
        if (r == null) {
            Relay.dismiss(ctx, pairId, reqId)
            Relay.toast(ctx, str(R.string.relay_pedido_encerrado))
            return
        }
        Relay.toast(ctx, str(when (Relay.answer(ctx, r, "deny")) {
            Relay.Result.OK -> R.string.relay_negado
            Relay.Result.GONE -> R.string.relay_pedido_encerrado
            Relay.Result.ERROR -> R.string.relay_falha_envio
        }))
    }

    companion object {
        const val ACTION_DENY = "com.mysecrets.app.DENY_PC"
        const val ACTION_RELAY_DENY = "com.mysecrets.app.DENY_RELAY"
        const val ACTION_RELAY_END = "com.mysecrets.app.END_RELAY_WINDOW"
    }
}
