package com.mysecrets.app.otp

import android.net.Uri
import org.json.JSONObject
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/** TOTP/HOTP (RFC 4226/6238), compatível com o otplib do desktop. */
object Otp {
    data class Code(val code: String, val remaining: Int, val period: Int)

    fun base32Decode(input: String): ByteArray {
        val s = input.uppercase().replace(Regex("[\\s=-]"), "")
        val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
        val out = java.io.ByteArrayOutputStream()
        var buffer = 0
        var bits = 0
        for (ch in s) {
            val v = alphabet.indexOf(ch)
            require(v >= 0) { "Segredo MFA inválido (base32)" }
            buffer = (buffer shl 5) or v
            bits += 5
            if (bits >= 8) {
                out.write((buffer shr (bits - 8)) and 0xff)
                bits -= 8
            }
        }
        return out.toByteArray()
    }

    fun hotp(secret: String, counter: Long, digits: Int = 6, hash: String = "sha1"): String {
        val alg = when (hash.lowercase()) {
            "sha256" -> "HmacSHA256"
            "sha512" -> "HmacSHA512"
            else -> "HmacSHA1"
        }
        val mac = Mac.getInstance(alg)
        mac.init(SecretKeySpec(base32Decode(secret), alg))
        val msg = ByteArray(8) { i -> (counter shr (56 - 8 * i)).toByte() }
        val h = mac.doFinal(msg)
        val off = h[h.size - 1].toInt() and 0x0f
        val bin = ((h[off].toInt() and 0x7f) shl 24) or
            ((h[off + 1].toInt() and 0xff) shl 16) or
            ((h[off + 2].toInt() and 0xff) shl 8) or
            (h[off + 3].toInt() and 0xff)
        var mod = 1L
        repeat(digits) { mod *= 10 }
        return (bin % mod).toString().padStart(digits, '0')
    }

    fun totp(secret: String, period: Int = 30, digits: Int = 6, hash: String = "sha1", nowMs: Long = System.currentTimeMillis()): Code {
        val epoch = nowMs / 1000
        val p = if (period > 0) period else 30
        return Code(hotp(secret, epoch / p, digits, hash), (p - (epoch % p)).toInt(), p)
    }

    /** Código atual de uma entrada MFA (null se não tiver segredo ou ele for inválido). */
    fun forEntry(e: JSONObject, nowMs: Long = System.currentTimeMillis()): Code? {
        val secret = e.optString("mfaSecret").trim()
        if (secret.isEmpty()) return null
        return try {
            val digits = e.optInt("mfaDigits", 6).takeIf { it in 4..10 } ?: 6
            val hash = e.optString("mfaHash", "sha1").ifBlank { "sha1" }
            if (e.optString("mfaAlgorithm", "totp") == "hotp") {
                Code(hotp(secret, e.optLong("mfaCounter", 0), digits, hash), 0, 0)
            } else {
                totp(secret, e.optInt("mfaPeriod", 30), digits, hash, nowMs)
            }
        } catch (_: Exception) {
            null
        }
    }

    data class OtpAuth(val secret: String, val label: String, val issuer: String, val algorithm: String,
                       val digits: Int, val period: Int, val counter: Long, val hash: String)

    /** Lê um QR otpauth://totp/Rótulo?secret=...&issuer=... */
    fun parseOtpAuth(text: String): OtpAuth? {
        if (!text.startsWith("otpauth://", ignoreCase = true)) return null
        val uri = Uri.parse(text)
        val secret = uri.getQueryParameter("secret") ?: return null
        val label = Uri.decode(uri.path?.trimStart('/') ?: "")
        val issuer = uri.getQueryParameter("issuer") ?: label.substringBefore(':', "")
        return OtpAuth(
            secret = secret.replace(" ", ""),
            label = label,
            issuer = issuer,
            algorithm = if (uri.host.equals("hotp", true)) "hotp" else "totp",
            digits = uri.getQueryParameter("digits")?.toIntOrNull() ?: 6,
            period = uri.getQueryParameter("period")?.toIntOrNull() ?: 30,
            counter = uri.getQueryParameter("counter")?.toLongOrNull() ?: 0,
            hash = (uri.getQueryParameter("algorithm") ?: "sha1").lowercase()
        )
    }
}
