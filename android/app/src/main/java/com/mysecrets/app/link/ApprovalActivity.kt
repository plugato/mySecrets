package com.mysecrets.app.link

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.compose.setContent
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.fragment.app.FragmentActivity
import com.mysecrets.app.BuildConfig
import com.mysecrets.app.R
import com.mysecrets.app.str
import com.mysecrets.app.ui.ApprovalInfo
import com.mysecrets.app.ui.MySecretsTheme
import com.mysecrets.app.ui.rememberApproval

/**
 * Aberta pela notificação do pedido do PC ("Aprovar", toque ou tela cheia),
 * inclusive sobre a tela bloqueada. A janela é transparente: aparece só o
 * prompt da digital, por cima do que estiver na tela, sem a tela do app.
 * Se a digital for cancelada, um diálogo com o código oferece tentar de novo
 * ou negar. Fecha sozinha quando o pedido termina.
 */
class ApprovalActivity : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setShowWhenLocked(true)
        setTurnScreenOn(true)
        if (!BuildConfig.DEBUG) window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        if (LinkServer.request.value == null) { finish(); return }
        val activity = this
        setContent {
            MySecretsTheme {
                val req by LinkServer.request.collectAsState()
                val r = req
                LaunchedEffect(r) { if (r == null) finish() }
                if (r != null) {
                    val st = rememberApproval(activity, r)
                    if (st.failed) {
                        AlertDialog(
                            // Fechar o diálogo não nega: o pedido segue na notificação
                            onDismissRequest = { finish() },
                            title = { Text(str(R.string.desbloquear_o_pc)) },
                            text = { ApprovalInfo(r, st.error) },
                            confirmButton = { Button(enabled = !st.busy, onClick = { st.retry() }) { Text(str(R.string.aprovar_com_digital)) } },
                            dismissButton = { TextButton(onClick = { r.answer.complete(null) }) { Text(str(R.string.negar)) } }
                        )
                    }
                }
            }
        }
    }
}
