package com.mysecrets.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import com.mysecrets.app.R
import com.mysecrets.app.crypto.Biometric
import com.mysecrets.app.crypto.Keys
import com.mysecrets.app.link.LinkServer
import com.mysecrets.app.link.Pairings
import com.mysecrets.app.str
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first

/** Pede a digital e, se aprovada, devolve ao PC a chave de desbloqueio. */
suspend fun approveWithBiometric(activity: FragmentActivity, r: LinkServer.ApprovalRequest) {
    val pc = Pairings.find(r.pairId) ?: error(str(R.string.pareamento_nao_encontrado))
    val cipher = Keys.bioDecryptCipher(Keys.BIO_LINK, pc.unlockSealed)
    val ok = Biometric.authenticate(activity, cipher, str(R.string.aprovar_login_no, r.desktopName), str(R.string.codigo, r.code))
    r.answer.complete(Keys.finishOpen(ok, pc.unlockSealed))
}

/** Estado de um pedido do PC: a digital abre sozinha; se cancelar ou falhar, [failed]. */
class ApprovalState {
    var busy by mutableStateOf(false)
    var failed by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var attempt by mutableIntStateOf(0)
    fun retry() { failed = false; error = null; attempt++ }
}

@Composable
fun rememberApproval(activity: FragmentActivity, r: LinkServer.ApprovalRequest): ApprovalState {
    val st = remember(r) { ApprovalState() }
    LaunchedEffect(r, st.attempt) {
        // Só com a tela visível (o prompt precisa de uma tela na frente)
        activity.lifecycle.currentStateFlow.first { it.isAtLeast(Lifecycle.State.RESUMED) }
        delay(300)
        if (r.answer.isCompleted) return@LaunchedEffect
        st.busy = true
        try {
            approveWithBiometric(activity, r)
            toast(activity, str(R.string.login_aprovado))
        } catch (e: Biometric.Interrupted) {
            // A tela saiu de cena no meio: pede de novo quando ela voltar
            st.attempt++
        } catch (e: CancellationException) {
            throw e
        } catch (e: Biometric.Cancelled) {
            st.failed = true
        } catch (e: Keys.InvalidatedException) {
            st.error = str(R.string.as_digitais_do_aparelho_mudaram_remova)
            st.failed = true
        } catch (e: Exception) {
            st.error = e.message
            st.failed = true
        } finally {
            st.busy = false
        }
    }
    return st
}

/** Código e mensagem do pedido (diálogo do app e tela aberta pela notificação). */
@Composable
fun ApprovalInfo(r: LinkServer.ApprovalRequest, error: String?) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(str(R.string.quer_abrir_o_mysecrets, r.desktopName))
        Text(str(R.string.confira_se_o_codigo_e_o))
        Text(r.code, fontSize = 32.sp, fontWeight = FontWeight.Bold, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
        if (error != null) Text(error, color = MaterialTheme.colorScheme.error)
    }
}

/** Pedido do PC com o app aberto: vai direto para a digital; o diálogo só aparece se cancelar. */
@Composable
fun ApprovalDialog(activity: FragmentActivity) {
    val req by LinkServer.request.collectAsState()
    val r = req ?: return
    val st = rememberApproval(activity, r)
    if (!st.failed) return
    AlertDialog(
        onDismissRequest = {},
        title = { Text(str(R.string.desbloquear_o_pc)) },
        text = { ApprovalInfo(r, st.error) },
        confirmButton = { Button(enabled = !st.busy, onClick = { st.retry() }) { Text(str(R.string.aprovar_com_digital)) } },
        dismissButton = { TextButton(onClick = { r.answer.complete(null) }) { Text(str(R.string.negar)) } }
    )
}
