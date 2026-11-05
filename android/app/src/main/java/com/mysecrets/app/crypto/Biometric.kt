package com.mysecrets.app.crypto

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

    /** Digital (forte); no Android 11+ também o PIN/padrão do aparelho como alternativa. */
    val allowed: Int
        get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) BIOMETRIC_STRONG or DEVICE_CREDENTIAL else BIOMETRIC_STRONG

    fun available(context: Context): Boolean =
        BiometricManager.from(context).canAuthenticate(allowed) == BiometricManager.BIOMETRIC_SUCCESS

    fun unavailableReason(context: Context): String = when (BiometricManager.from(context).canAuthenticate(allowed)) {
        BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED ->
            "Nenhuma digital (nem bloqueio de tela) cadastrada. Cadastre uma digital nas Configurações do Android > Senhas e segurança."
        BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE -> "Este aparelho não tem leitor biométrico forte"
        BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE -> "Leitor biométrico indisponível agora. Tente de novo."
        BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED -> "O Android pede uma atualização de segurança para usar a biometria"
        else -> "Biometria indisponível neste aparelho"
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
                    if (!cont.isActive) return
                    val cancelado = errorCode == BiometricPrompt.ERROR_USER_CANCELED ||
                        errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON || errorCode == BiometricPrompt.ERROR_CANCELED
                    // Cancelar não é erro; o resto (bloqueio por tentativas, sem digital…) precisa aparecer
                    cont.resumeWithException(if (cancelado) Cancelled(errString.toString()) else Exception(errString.toString()))
                }
            })
            val info = BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .apply { if (subtitle != null) setSubtitle(subtitle) }
                .setAllowedAuthenticators(allowed)
                .apply { if (allowed and DEVICE_CREDENTIAL == 0) setNegativeButtonText("Cancelar") }
                .setConfirmationRequired(false)
                .build()
            prompt.authenticate(info, BiometricPrompt.CryptoObject(cipher))
            cont.invokeOnCancellation { prompt.cancelAuthentication() }
        }
}
