package com.mysecrets.app.link

import com.mysecrets.app.R
import com.mysecrets.app.str
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Protocolo PC ↔ celular (lado do celular) — mesmo de src/lib/phone-link.js.
 * Mensagens JSON, uma por linha, sobre TCP na porta [PORT].
 */
object LinkProtocol {
    const val PORT = 47653
    const val QR_PREFIX = "mysecrets-pair:1:"
    private const val PROTO = "mysecrets-link-v1"
    private const val CLOCK_SKEW_MS = 5 * 60 * 1000L
    private val random = SecureRandom()

    class QrPairing(val pairId: String, val desktopName: String, val secret: ByteArray, val unlockKey: ByteArray)

    fun parseQr(text: String): QrPairing {
        require(text.startsWith(QR_PREFIX)) { str(R.string.este_qr_code_nao_e_de) }
        val json = String(Base64.getUrlDecoder().decode(text.removePrefix(QR_PREFIX)), Charsets.UTF_8)
        val o = JSONObject(json)
        val secret = Base64.getDecoder().decode(o.getString("s"))
        val key = Base64.getDecoder().decode(o.getString("k"))
        require(secret.size == 32 && key.size == 32) { str(R.string.qr_code_de_pareamento_invalido) }
        return QrPairing(o.getString("p"), o.optString("n", "PC"), secret, key)
    }

    fun hmac(secret: ByteArray, vararg parts: Any): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(secret, "HmacSHA256"))
        return mac.doFinal((listOf(PROTO) + parts.map { it.toString() }).joinToString("|").toByteArray(Charsets.UTF_8))
    }

    fun mac(secret: ByteArray, vararg parts: Any): String = Base64.getEncoder().encodeToString(hmac(secret, *parts))

    fun macOk(secret: ByteArray, provided: String?, vararg parts: Any): Boolean {
        if (provided == null) return false
        val got = try { Base64.getDecoder().decode(provided) } catch (_: Exception) { return false }
        return MessageDigest.isEqual(got, hmac(secret, *parts))
    }

    fun verificationCode(secret: ByteArray, nonce: String): String {
        val h = hmac(secret, "code", nonce)
        val n = ((h[0].toLong() and 0xff) shl 24 or ((h[1].toLong() and 0xff) shl 16) or
            ((h[2].toLong() and 0xff) shl 8) or (h[3].toLong() and 0xff)) % 1_000_000
        val s = n.toString().padStart(6, '0')
        return s.substring(0, 3) + " " + s.substring(3)
    }

    /** "ts" vem como número no JSON; o HMAC usa a mesma forma textual do JS. */
    private fun tsText(o: JSONObject): String {
        val v = o.opt("ts")
        return when (v) {
            is Number -> v.toLong().toString()
            else -> v?.toString() ?: ""
        }
    }

    fun verifyHello(secret: ByteArray, o: JSONObject, now: Long = System.currentTimeMillis()): Boolean {
        if (o.optInt("v") != 1) return false
        val op = o.optString("op")
        if (op != "pair" && op != "unlock") return false
        val ts = tsText(o).toLongOrNull() ?: return false
        if (kotlin.math.abs(now - ts) > CLOCK_SKEW_MS) return false
        return macOk(secret, if (o.has("mac")) o.optString("mac") else null, "hello", op, o.optString("pair"), o.optString("nonce"), tsText(o), o.optString("name"))
    }

    fun reply(type: String, secret: ByteArray, nonce: String, phoneName: String): JSONObject =
        JSONObject().put("type", type).put("phone", phoneName).put("mac", mac(secret, type, nonce, phoneName))

    /**
     * Token de push junto da resposta (campos à parte: PC antigo ignora). "" = o PC
     * deve esquecer o token (aviso com o app fechado desligado).
     */
    fun withPush(o: JSONObject, secret: ByteArray, nonce: String, token: String): JSONObject =
        o.put("push", token).put("pushMac", mac(secret, "push", nonce, token))

    /** Push de "acordar" vindo do PC: assinado com o segredo do pareamento e recente. */
    fun verifyWake(secret: ByteArray, pairId: String, ts: String, nonce: String, sig: String?,
                   now: Long = System.currentTimeMillis()): Boolean {
        val t = ts.toLongOrNull() ?: return false
        if (kotlin.math.abs(now - t) > WAKE_SKEW_MS || nonce.isBlank()) return false
        return macOk(secret, sig, "wake", pairId, ts, nonce)
    }

    private const val WAKE_SKEW_MS = 5 * 60 * 1000L

    fun deny(secret: ByteArray, nonce: String): JSONObject =
        JSONObject().put("type", "deny").put("mac", mac(secret, "deny", nonce))

    fun error(message: String): JSONObject = JSONObject().put("type", "error").put("message", message)

    /** Resposta de aprovação: K_d cifrada com a chave de uso único do pedido. */
    fun approval(secret: ByteArray, pairId: String, nonce: String, unlockKey: ByteArray): JSONObject {
        val key = hmac(secret, "unlock-key", nonce)
        val iv = ByteArray(12).also(random::nextBytes)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        c.updateAAD("$pairId|$nonce".toByteArray(Charsets.UTF_8))
        val sealed = iv + c.doFinal(unlockKey)
        return JSONObject().put("type", "approve").put("data", Base64.getEncoder().encodeToString(sealed))
    }
}
