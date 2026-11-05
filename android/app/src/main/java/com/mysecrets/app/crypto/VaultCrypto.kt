package com.mysecrets.app.crypto

import org.json.JSONObject
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Criptografia do cofre — o MESMO formato do desktop (src/lib/vault-crypto.js).
 *
 * v2: { version: 2, algorithm: "aes-256-gcm", iterations, salt, iv, authTag, encrypted } (hex)
 *     AES-256-GCM + PBKDF2-SHA256 (600.000 iterações).
 * v1 (legado): { encrypted, salt, iv } — AES-256-CBC + PBKDF2-SHA256 (100.000).
 *
 * Derivar a chave custa ~1 s no celular, então guardamos a chave da sessão:
 * ao gravar reaproveitamos o salt (com IV novo a cada gravação, o que é seguro
 * no GCM) e o desktop abre normalmente, porque o salt vai no arquivo.
 */
object VaultCrypto {
    const val V2_ITERATIONS = 600_000
    const val V1_ITERATIONS = 100_000
    private val random = SecureRandom()

    class Key(val salt: ByteArray, val iterations: Int, val bytes: ByteArray)

    /** PBKDF2-HMAC-SHA256 com 32 bytes de saída (um bloco), senha em UTF-8 como no Node. */
    fun deriveKey(password: String, salt: ByteArray, iterations: Int): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(password.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        mac.update(salt)
        mac.update(byteArrayOf(0, 0, 0, 1))
        var u = mac.doFinal()
        val t = u.copyOf()
        for (i in 1 until iterations) {
            u = mac.doFinal(u)
            for (j in t.indices) t[j] = (t[j].toInt() xor u[j].toInt()).toByte()
        }
        return t
    }

    fun newKey(password: String): Key {
        val salt = ByteArray(16).also(random::nextBytes)
        return Key(salt, V2_ITERATIONS, deriveKey(password, salt, V2_ITERATIONS))
    }

    fun isLegacy(data: JSONObject): Boolean = data.optInt("version", 0) < 2

    /** Sal + iterações do arquivo (para reaproveitar uma chave já derivada). */
    fun saltOf(data: JSONObject): String = data.getString("salt")

    /** Deriva a chave para um arquivo do cofre. */
    fun keyFor(data: JSONObject, password: String): Key {
        val salt = hex(data.getString("salt"))
        val iterations = if (isLegacy(data)) V1_ITERATIONS else iterationsOf(data)
        return Key(salt, iterations, deriveKey(password, salt, iterations))
    }

    // O número vem do próprio arquivo: sem limite, um cofre adulterado no Drive
    // com bilhões de iterações travaria o app. Mesmo limite do desktop.
    const val MIN_ITERATIONS = 1000
    const val MAX_ITERATIONS = 10_000_000

    fun iterationsOf(data: JSONObject): Int {
        if (!data.has("iterations")) return V2_ITERATIONS
        val v = data.get("iterations")
        val n = (v as? Number)?.toDouble() ?: throw IllegalArgumentException("Formato de dados criptografados inválido (iterações)")
        if (n != Math.floor(n) || n < MIN_ITERATIONS || n > MAX_ITERATIONS) {
            throw IllegalArgumentException("Formato de dados criptografados inválido (iterações)")
        }
        return n.toInt()
    }

    /** Descriptografa com a chave já derivada. Lança exceção se a senha estiver errada. */
    fun decrypt(data: JSONObject, key: Key): String {
        val iv = hex(data.getString("iv"))
        val ct = hex(data.getString("encrypted"))
        val secret = SecretKeySpec(key.bytes, "AES")
        return if (isLegacy(data)) {
            val c = Cipher.getInstance("AES/CBC/PKCS5Padding")
            c.init(Cipher.DECRYPT_MODE, secret, IvParameterSpec(iv))
            String(c.doFinal(ct), Charsets.UTF_8)
        } else {
            val tag = hex(data.getString("authTag"))
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, secret, GCMParameterSpec(tag.size * 8, iv))
            String(c.doFinal(ct + tag), Charsets.UTF_8)
        }
    }

    fun decrypt(data: JSONObject, password: String): String = decrypt(data, keyFor(data, password))

    /** Criptografa no formato v2 com a chave dada (IV novo a cada chamada). */
    fun encrypt(text: String, key: Key): JSONObject {
        val iv = ByteArray(12).also(random::nextBytes)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key.bytes, "AES"), GCMParameterSpec(128, iv))
        val out = c.doFinal(text.toByteArray(Charsets.UTF_8))
        val ct = out.copyOfRange(0, out.size - 16)
        val tag = out.copyOfRange(out.size - 16, out.size)
        return JSONObject()
            .put("version", 2)
            .put("algorithm", "aes-256-gcm")
            .put("iterations", key.iterations)
            .put("salt", hex(key.salt))
            .put("iv", hex(iv))
            .put("authTag", hex(tag))
            .put("encrypted", hex(ct))
    }

    fun hex(bytes: ByteArray): String {
        val sb = StringBuilder(bytes.size * 2)
        for (b in bytes) {
            val v = b.toInt() and 0xff
            sb.append("0123456789abcdef"[v shr 4]).append("0123456789abcdef"[v and 0xf])
        }
        return sb.toString()
    }

    fun hex(s: String): ByteArray {
        require(s.length % 2 == 0) { "hex inválido" }
        return ByteArray(s.length / 2) { i -> s.substring(i * 2, i * 2 + 2).toInt(16).toByte() }
    }
}
