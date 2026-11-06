package com.mysecrets.app.crypto

import com.mysecrets.app.R
import com.mysecrets.app.str
import android.content.Context
import androidx.biometric.BiometricManager
import android.os.Build
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import kotlinx.coroutines.suspendCancellableCoroutine
import javax.crypto.Cipher
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

object Biometric {
    class Cancelled(message: String) : Exception(message)

    /** O prompt foi fechado porque a tela saiu de cena (app em segundo plano, tela recriada). */
    class Interrupted(message: String) : Exception(message)

    /** Digital (forte); no Android 11+ também o PIN/padrão do aparelho como alternativa. */
    val allowed: Int
        get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) BIOMETRIC_STRONG or DEVICE_CREDENTIAL else BIOMETRIC_STRONG

    fun available(context: Context): Boolean =
        BiometricManager.from(context).canAuthenticate(allowed) == BiometricManager.BIOMETRIC_SUCCESS

    fun unavailableReason(context: Context): String = when (BiometricManager.from(context).canAuthenticate(allowed)) {
        BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED ->
            str(R.string.nenhuma_digital_nem_bloqueio_de_tela)
        BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE -> str(R.string.este_aparelho_nao_tem_leitor_biometrico)
        BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE -> str(R.string.leitor_biometrico_indisponivel_agora_tente_de)
        BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED -> str(R.string.o_android_pede_uma_atualizacao_de)
        else -> str(R.string.biometria_indisponivel_neste_aparelho)
    }

    /** Mostra o prompt de digital e devolve o Cipher liberado pelo Keystore. */
    suspend fun authenticate(activity: FragmentActivity, cipher: Cipher, title: String, subtitle: String? = null): Cipher =
        suspendCancellableCoroutine { cont ->
            val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    val c = result.cryptoObject?.cipher
                    if (c != null) cont.resume(c) else cont.resumeWithException(Cancelled(str(R.string.falha_na_biometria)))
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    if (!cont.isActive) return
                    val cancelado = errorCode == BiometricPrompt.ERROR_USER_CANCELED ||
                        errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON || errorCode == BiometricPrompt.ERROR_CANCELED
                    if (!cancelado) {
                        // Bloqueio por tentativas, sem digital… precisa aparecer
                        cont.resumeWithException(Exception(errString.toString()))
                        return
                    }
                    // Ao sair do app (Home, tela recriada) o sistema fecha o prompt como "cancelado
                    // pelo usuário" antes de a tela registrar a saída: espera um instante e confere.
                    android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                        if (!cont.isActive) return@postDelayed
                        val foraDeCena = activity.isFinishing || activity.isDestroyed ||
                            !activity.lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)
                        cont.resumeWithException(if (foraDeCena) Interrupted(errString.toString()) else Cancelled(errString.toString()))
                    }, 600)
                }
            })
            val info = BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .apply { if (subtitle != null) setSubtitle(subtitle) }
                .setAllowedAuthenticators(allowed)
                .apply { if (allowed and DEVICE_CREDENTIAL == 0) setNegativeButtonText(str(R.string.cancelar)) }
                .setConfirmationRequired(false)
                .build()
            prompt.authenticate(info, BiometricPrompt.CryptoObject(cipher))
            cont.invokeOnCancellation { prompt.cancelAuthentication() }
        }
}
