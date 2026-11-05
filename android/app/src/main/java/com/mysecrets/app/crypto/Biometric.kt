package com.mysecrets.app.crypto

import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import kotlinx.coroutines.suspendCancellableCoroutine
import javax.crypto.Cipher
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

object Biometric {
    class Cancelled(message: String) : Exception(message)

    fun available(context: Context): Boolean =
        BiometricManager.from(context).canAuthenticate(BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS

    fun unavailableReason(context: Context): String = when (BiometricManager.from(context).canAuthenticate(BIOMETRIC_STRONG)) {
        BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> "Nenhuma digital cadastrada no aparelho"
        BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE -> "Este aparelho não tem leitor biométrico forte"
        BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE -> "Leitor biométrico indisponível agora"
        else -> "Biometria indisponível"
    }

    /** Mostra o prompt de digital e devolve o Cipher liberado pelo Keystore. */
    suspend fun authenticate(activity: FragmentActivity, cipher: Cipher, title: String, subtitle: String? = null): Cipher =
        suspendCancellableCoroutine { cont ->
            val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    val c = result.cryptoObject?.cipher
                    if (c != null) cont.resume(c) else cont.resumeWithException(Cancelled("Falha na biometria"))
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    if (cont.isActive) cont.resumeWithException(Cancelled(errString.toString()))
                }
            })
            val info = BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .apply { if (subtitle != null) setSubtitle(subtitle) }
                .setAllowedAuthenticators(BIOMETRIC_STRONG)
                .setNegativeButtonText("Cancelar")
                .setConfirmationRequired(false)
                .build()
            prompt.authenticate(info, BiometricPrompt.CryptoObject(cipher))
            cont.invokeOnCancellation { prompt.cancelAuthentication() }
        }
}
