package com.mysecrets.app.link

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import com.mysecrets.app.BuildConfig
import com.mysecrets.app.R
import com.mysecrets.app.str
import com.mysecrets.app.ui.ApprovalInfo
import com.mysecrets.app.ui.MySecretsTheme
import com.mysecrets.app.ui.rememberApproval

/**
 * Aberta pela notificação do pedido do PC (inclusive sobre a tela bloqueada):
 * pede a digital direto. Fecha sozinha quando o pedido termina.
 */
class ApprovalActivity : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setShowWhenLocked(true)
        setTurnScreenOn(true)
        if (!BuildConfig.DEBUG) window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        if (LinkServer.request.value == null) { finish(); return }
        val activity = this
        setContent {
            MySecretsTheme {
                Surface(Modifier.fillMaxSize()) {
                    val req by LinkServer.request.collectAsState()
                    val r = req
                    LaunchedEffect(r) { if (r == null) finish() }
                    if (r != null) {
                        val st = rememberApproval(activity, r)
                        Column(Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp),
                            verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically)) {
                            Text(str(R.string.desbloquear_o_pc), style = MaterialTheme.typography.headlineSmall)
                            ApprovalInfo(r, st.error)
                            if (st.busy) CircularProgressIndicator(Modifier.align(Alignment.CenterHorizontally))
                            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.align(Alignment.End)) {
                                OutlinedButton(onClick = { r.answer.complete(null) }) { Text(str(R.string.negar)) }
                                Button(enabled = !st.busy, onClick = { st.retry() }) { Text(str(R.string.aprovar_com_digital)) }
                            }
                        }
                    }
                }
            }
        }
    }
}
