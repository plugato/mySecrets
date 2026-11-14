package com.mysecrets.app.link

import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.fragment.app.FragmentActivity
import com.mysecrets.app.BuildConfig
import com.mysecrets.app.R
import com.mysecrets.app.str
import com.mysecrets.app.ui.MySecretsTheme
import com.mysecrets.app.ui.rememberBiometricStep
import com.mysecrets.app.ui.releaseUnlockKey
import com.mysecrets.app.ui.toast
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Pedido do PC pela internet (relay), aberto pela notificação, inclusive sobre
 * a tela bloqueada. Janela transparente, como a [ApprovalActivity]:
 *  - gravação e login: vai direto ao prompt da digital;
 *  - leitura: pelo botão da notificação já vem escolhido ("só esta" ou "por N
 *    min"); pelo toque na notificação, um diálogo pergunta antes.
 * A digital libera a K_d (que vai cifrada na resposta). Cancelar a digital
 * mostra um diálogo para tentar de novo ou negar. Fecha quando o pedido acaba.
 */
class RelayApprovalActivity : FragmentActivity() {
    private class Target(val pairId: String, val reqId: String, val mode: String?)

    private var target by mutableStateOf<Target?>(null)

    private fun parse(i: Intent?): Target? {
        val pairId = i?.getStringExtra(EXTRA_PAIR) ?: return null
        val reqId = i.getStringExtra(EXTRA_REQ) ?: return null
        return Target(pairId, reqId, i.getStringExtra(EXTRA_MODE))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setShowWhenLocked(true)
        setTurnScreenOn(true)
        if (!BuildConfig.DEBUG) window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        target = parse(intent) ?: run { finish(); return }
        setContent {
            MySecretsTheme {
                target?.let { Screen(it) }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // Outro botão (ou outro pedido) com a tela já aberta
        parse(intent)?.let { target = it }
    }

    @Composable
    private fun Screen(t: Target) {
        val activity = this
        val all by Relay.requests.collectAsState()
        val scope = rememberCoroutineScope()
        // Processo reiniciado (notificação antiga): busca o pedido na caixa postal
        var loaded by remember(t) { mutableStateOf(Relay.find(t.reqId) != null) }
        LaunchedEffect(t) {
            if (loaded) return@LaunchedEffect
            val found = try {
                withContext(Dispatchers.IO) { Relay.findOrFetch(applicationContext, t.pairId, t.reqId) }
            } catch (_: Exception) {
                toast(activity, str(R.string.relay_falha_envio))
                finish()
                return@LaunchedEffect
            }
            if (found == null) {
                withContext(Dispatchers.IO) { Relay.dismiss(applicationContext, t.pairId, t.reqId) }
                toast(activity, str(R.string.relay_pedido_encerrado))
                finish()
            } else loaded = true
        }
        if (!loaded) return
        val r = all.firstOrNull { it.reqId == t.reqId }
        // Respondido (aqui, pelo "Negar" ou por outro aparelho) ou vencido: fecha
        LaunchedEffect(r == null) { if (r == null) finish() }
        if (r == null) return

        var chosen by remember(t) { mutableStateOf(t.mode) }
        var sending by remember(t) { mutableStateOf(false) }
        fun deny() {
            if (sending) return
            sending = true
            scope.launch {
                val res = withContext(Dispatchers.IO) { Relay.answer(applicationContext, r, "deny") }
                toast(activity, str(when (res) {
                    Relay.Result.OK -> R.string.relay_negado
                    Relay.Result.GONE -> R.string.relay_pedido_encerrado
                    Relay.Result.ERROR -> R.string.relay_falha_envio
                }))
                sending = false
                if (res != Relay.Result.ERROR) finish()
            }
        }

        // Gravação pelo toque na notificação (ou pela tela cheia): revisar antes da digital
        if (r.kind == "write" && chosen == null) {
            AlertDialog(
                onDismissRequest = { finish() }, // fechar não nega: o pedido segue na notificação
                title = { Text(Relay.title(r)) },
                text = { Column(Modifier.verticalScroll(rememberScrollState())) { RelayInfo(r, null) } },
                confirmButton = { Button(enabled = !sending, onClick = { chosen = "approve" }) { Text(str(R.string.aprovar_com_digital)) } },
                dismissButton = { TextButton(enabled = !sending, onClick = { deny() }) { Text(str(R.string.negar)) } }
            )
            return
        }

        // Leitura pelo toque na notificação: escolher antes da digital
        if (r.kind == "read" && chosen == null) {
            AlertDialog(
                onDismissRequest = { finish() }, // fechar não nega: o pedido segue na notificação
                title = { Text(Relay.title(r)) },
                text = { RelayInfo(r, null) },
                confirmButton = { Button(enabled = !sending, onClick = { chosen = "once" }) { Text(str(R.string.relay_liberar_so_esta)) } },
                dismissButton = {
                    Row {
                        TextButton(enabled = !sending, onClick = { deny() }) { Text(str(R.string.negar)) }
                        if (r.allowWindow) {
                            TextButton(enabled = !sending, onClick = { chosen = "window" }) { Text(str(R.string.relay_liberar_por, r.windowMinutes)) }
                        }
                    }
                }
            )
            return
        }

        val st = rememberBiometricStep(activity, t.reqId + "|" + chosen, { Relay.find(r.reqId) == null || sending }) {
            approve(activity, r, chosen)
        }
        if (st.failed) {
            AlertDialog(
                onDismissRequest = { finish() },
                title = { Text(Relay.title(r)) },
                text = { Column(Modifier.verticalScroll(rememberScrollState())) { RelayInfo(r, st.error) } },
                confirmButton = { Button(enabled = !st.busy && !sending, onClick = { st.retry() }) { Text(str(R.string.aprovar_com_digital)) } },
                dismissButton = { TextButton(enabled = !st.busy && !sending, onClick = { deny() }) { Text(str(R.string.negar)) } }
            )
        }
    }

    companion object {
        const val EXTRA_PAIR = "pairId"
        const val EXTRA_REQ = "reqId"
        /** "once" / "window" (leitura), "approve" (gravação/login: direto à digital); ausente = revisar antes. */
        const val EXTRA_MODE = "mode"

        /**
         * Digital → K_d → resposta "approve" cifrada para o PC. Leitura leva o
         * modo ("once" = só esta; "window" = por [RelayProtocol.Request.windowMinutes]).
         */
        private suspend fun approve(activity: FragmentActivity, r: RelayProtocol.Request, mode: String?) {
            val readMode = if (r.kind != "read") null else if (mode == "window" && r.allowWindow) "window" else "once"
            val minutes = if (readMode == "window") r.windowMinutes else null
            val (title, subtitle) = when (r.kind) {
                "write" -> str(R.string.relay_aprovar_gravacao_no, r.desktop) to r.summary.optString("target")
                "read" -> str(R.string.relay_liberar_leitura_no, r.desktop) to
                    (if (minutes != null) str(R.string.relay_liberar_por, minutes) else str(R.string.relay_liberar_so_esta))
                else -> str(R.string.aprovar_login_no, r.desktop) to str(R.string.codigo, r.code ?: "")
            }
            val kd = releaseUnlockKey(activity, r.pairId, title, subtitle.ifBlank { null })
            val res = try {
                withContext(Dispatchers.IO) { Relay.answer(activity, r, "approve", readMode, minutes, kd) }
            } finally {
                kd.fill(0)
            }
            when (res) {
                Relay.Result.OK -> toast(activity, str(when (r.kind) {
                    "write" -> R.string.relay_gravacao_aprovada
                    "read" -> R.string.relay_leitura_liberada
                    else -> R.string.login_aprovado
                }))
                Relay.Result.GONE -> toast(activity, str(R.string.relay_pedido_encerrado))
                Relay.Result.ERROR -> error(str(R.string.relay_falha_envio))
            }
        }
    }
}

/** O que o PC pede: frase principal, detalhes e, no login, o código grande. */
@Composable
private fun RelayInfo(r: RelayProtocol.Request, error: String?) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(Relay.headline(r))
        if (r.kind == "unlock" && r.code != null) {
            Text(str(R.string.confira_se_o_codigo_e_o))
            Text(r.code, fontSize = 32.sp, fontWeight = FontWeight.Bold, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
        } else {
            Relay.details(r).forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
        }
        if (error != null) Text(error, color = MaterialTheme.colorScheme.error)
    }
}
