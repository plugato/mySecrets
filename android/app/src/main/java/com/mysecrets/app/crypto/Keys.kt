package com.mysecrets.app.crypto

import com.mysecrets.app.R
import com.mysecrets.app.str
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Chaves no Android Keystore (nunca saem do hardware seguro).
 *
 *  - STORAGE: protege dados em repouso que o app usa sem digital
 *    (token do Google, segredo dos pareamentos).
 *  - Chaves biométricas (BIO_UNLOCK, BIO_LINK): só funcionam depois de uma
 *    digital (BIOMETRIC_STRONG) e são invalidadas se outra digital for cadastrada.
 */
object Keys {
    const val STORAGE = "mysecrets_storage"
    const val BIO_UNLOCK = "mysecrets_bio_unlock"
    const val BIO_LINK = "mysecrets_bio_link"

    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val TRANSFORM = "AES/GCM/NoPadding"

    private fun keyStore() = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

    private fun getOrCreate(alias: String, biometric: Boolean): SecretKey {
        (keyStore().getKey(alias, null) as? SecretKey)?.let { return it }
        val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .apply {
                if (biometric) {
                    setUserAuthenticationRequired(true)
                    setInvalidatedByBiometricEnrollment(true)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
                    }
                }
            }
            .build()
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE).run {
            init(spec)
            generateKey()
        }
    }

    fun delete(alias: String) {
        try { keyStore().deleteEntry(alias) } catch (_: Exception) {}
    }

    // ===== Sem digital =====

    fun seal(plain: ByteArray): String {
        val c = Cipher.getInstance(TRANSFORM)
        c.init(Cipher.ENCRYPT_MODE, getOrCreate(STORAGE, false))
        return Base64.getEncoder().encodeToString(c.iv + c.doFinal(plain))
    }

    fun open(sealed: String): ByteArray {
        val all = Base64.getDecoder().decode(sealed)
        val c = Cipher.getInstance(TRANSFORM)
        c.init(Cipher.DECRYPT_MODE, getOrCreate(STORAGE, false), GCMParameterSpec(128, all, 0, 12))
        return c.doFinal(all, 12, all.size - 12)
    }

    // ===== Com digital: o Cipher é liberado pelo BiometricPrompt =====

    class InvalidatedException : Exception(str(R.string.a_digital_mudou_neste_aparelho_configure))

    /** Cipher para cifrar (cadastro). Passe-o ao BiometricPrompt e depois chame [finishSeal]. */
    fun bioEncryptCipher(alias: String): Cipher {
        val c = Cipher.getInstance(TRANSFORM)
        try {
            c.init(Cipher.ENCRYPT_MODE, getOrCreate(alias, true))
        } catch (e: KeyPermanentlyInvalidatedException) {
            delete(alias)
            c.init(Cipher.ENCRYPT_MODE, getOrCreate(alias, true))
        }
        return c
    }

    fun finishSeal(authorized: Cipher, plain: ByteArray): String =
        Base64.getEncoder().encodeToString(authorized.iv + authorized.doFinal(plain))

    /** Cipher para decifrar [sealed]. Lança [InvalidatedException] se a digital mudou. */
    fun bioDecryptCipher(alias: String, sealed: String): Cipher {
        val all = Base64.getDecoder().decode(sealed)
        val key = keyStore().getKey(alias, null) as? SecretKey ?: throw InvalidatedException()
        val c = Cipher.getInstance(TRANSFORM)
        try {
            c.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, all, 0, 12))
        } catch (e: KeyPermanentlyInvalidatedException) {
            delete(alias)
            throw InvalidatedException()
        }
        return c
    }

    fun finishOpen(authorized: Cipher, sealed: String): ByteArray {
        val all = Base64.getDecoder().decode(sealed)
        return authorized.doFinal(all, 12, all.size - 12)
    }
}
