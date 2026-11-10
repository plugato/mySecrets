package com.mysecrets.app.link

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Botão "Negar" da notificação de pedido do PC. */
class ApprovalActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_DENY) LinkServer.denyCurrent()
    }

    companion object {
        const val ACTION_DENY = "com.mysecrets.app.DENY_PC"
    }
}
