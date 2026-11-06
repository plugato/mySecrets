package com.mysecrets.app.link

import com.mysecrets.app.R
import com.mysecrets.app.str
import android.util.Log
import androidx.fragment.app.FragmentActivity
import com.mysecrets.app.crypto.Biometric
import com.mysecrets.app.crypto.Keys
import com.mysecrets.app.ui.scanQr
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * Pareamento com o PC fora da tela: ao voltar do leitor de QR alguns aparelhos
 * (MIUI/HyperOS) recriam a Activity, o que cancelava a tarefa presa à tela e o
 * pareamento nunca era guardado. Aqui o estado vive no processo; a confirmação
 * com a digital roda na tela que estiver aberta (ver MainActivity.PairFlowHost).
 */
object PairFlow {
    private const val TAG = "MySecretsPair"

    sealed class State {
        data object Idle : State()
        /** QR lido; falta confirmar com a digital. */
        data class Scanned(val qr: LinkProtocol.QrPairing, val attempt: Int = 0) : State()
        data class Waiting(val pairId: String, val desktopName: String) : State()
        data class Error(val message: String) : State()
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val _state = MutableStateFlow<State>(State.Idle)
    val state: StateFlow<State> = _state

    fun scan(activity: FragmentActivity) {
        if (!Biometric.available(activity)) {
            _state.value = State.Error(Biometric.unavailableReason(activity))
            return
        }
        scope.launch {
            try {
                val raw = scanQr(activity)
                if (raw == null) {
                    Log.i(TAG, "leitura do QR cancelada")
                    return@launch
                }
                accept(raw)
            } catch (e: Exception) {
                fail(e)
            }
        }
    }

    /** Texto do QR (leitor ou, no build de debug, injetado por intent). */
    fun accept(raw: String) {
        try {
            val qr = LinkProtocol.parseQr(raw)
            Log.i(TAG, "QR lido: PC ${qr.desktopName}, código ${qr.pairId.take(6)}")
            _state.value = State.Scanned(qr)
        } catch (e: Exception) {
            fail(e)
        }
    }

    /** Confirma com a digital e guarda o pareamento (chamado pela tela atual). */
    suspend fun confirm(activity: FragmentActivity, s: State.Scanned) {
        try {
            val cipher = Keys.bioEncryptCipher(Keys.BIO_LINK)
            val ok = Biometric.authenticate(activity, cipher, str(R.string.parear_com, s.qr.desktopName), str(R.string.confirme_com_a_digital_ou_o))
            LinkServer.clearConfirmed()
            Pairings.add(s.qr, ok)
            Log.i(TAG, "pareamento guardado: ${s.qr.pairId.take(6)}")
            _state.value = State.Waiting(s.qr.pairId, s.qr.desktopName)
        } catch (e: Biometric.Interrupted) {
            // A tela saiu de cena no meio: pede de novo quando ela voltar
            Log.i(TAG, "confirmação interrompida (${e.message}); pedindo de novo ao voltar")
            _state.value = s.copy(attempt = s.attempt + 1)
        } catch (e: Biometric.Cancelled) {
            Log.i(TAG, "confirmação cancelada: ${e.message}")
            _state.value = State.Error(str(R.string.pareamento_cancelado_leia_o_qr_de))
        } catch (e: kotlinx.coroutines.CancellationException) {
            // A tela foi recriada no meio: o estado continua Scanned e a próxima tela pede de novo
            Log.i(TAG, "tela recriada durante a confirmação; pedindo de novo")
            throw e
        } catch (e: Exception) {
            fail(e)
        }
    }

    private fun fail(e: Exception) {
        Log.w(TAG, "pareamento falhou: ${e.javaClass.simpleName}: ${e.message}")
        _state.value = State.Error(e.message ?: e.javaClass.simpleName)
    }

    fun dismiss() {
        _state.value = State.Idle
    }
}
