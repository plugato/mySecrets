package com.mysecrets.app.link

import org.json.JSONObject
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.PublicKey
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import javax.crypto.KeyAgreement

/**
 * Criptografia do relay (aprovar de qualquer lugar) — mesmo protocolo de
 * src/lib/phone-relay.js; ver docs/developer/RELAY.md.
 *  - canal: hex(HMAC(S, "relay-channel"))[0..32]
 *  - pedido: AES-GCM(HMAC(S, "relay-req", reqId)), aad "pairId|reqId"
 *  - resposta: ECDH P-256 efêmero com a epk do pedido;
 *    chave HMAC(S, "relay-answer", id, base64(ecdh)), aad "pairId|id|answer"
 *
 * Sem dependência do Android (testado na JVM com os vetores do Node).
 */
object RelayProtocol {
    private const val CLOCK_SKEW_MS = 5 * 60 * 1000L
    private val KINDS = setOf("write", "read", "unlock")
    private val b64 = Base64.getEncoder()
    private val unb64 = Base64.getDecoder()

    /** Pedido aberto e conferido. Só nomes e metadados: nenhum valor de segredo. */
    class Request(
        val pairId: String,
        val reqId: String,
        val kind: String,
        val desktop: String,
        val client: String,
        val ts: Long,
        val expiresAt: Long,
        /** Chave pública efêmera do PC (SPKI base64): a resposta é cifrada para ela. */
        val epk: String,
        val pending: Int,
        val summary: JSONObject,
        val windowMinutes: Int,
        val allowWindow: Boolean,
        val code: String?,
    )

    // ===== Chaves =====

    fun channelId(secret: ByteArray): String =
        LinkProtocol.hmac(secret, "relay-channel").copyOfRange(0, 16).joinToString("") { "%02x".format(it) }

    fun requestKey(secret: ByteArray, reqId: String): ByteArray = LinkProtocol.hmac(secret, "relay-req", reqId)

    fun answerKey(secret: ByteArray, id: String, shared: ByteArray): ByteArray =
        LinkProtocol.hmac(secret, "relay-answer", id, b64.encodeToString(shared))

    /** Id da "escuta" de fim de uma liberação de leitura por tempo. */
    fun endId(reqId: String): String = "e$reqId"

    // ===== ECDH P-256 (chaves em DER SPKI, como o Node exporta) =====

    fun newKeyPair(): java.security.KeyPair =
        KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()

    fun importPublic(spkiB64: String): PublicKey {
        val key = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(unb64.decode(spkiB64)))
        require(key is ECPublicKey && key.params.curve.field.fieldSize == 256) { "epk inválida" }
        return key
    }

    fun exportPublic(key: PublicKey): String = b64.encodeToString(key.encoded)

    /** Segredo compartilhado (32 bytes, coordenada x), igual a crypto.diffieHellman do Node. */
    fun ecdh(privateKey: PrivateKey, publicB64: String): ByteArray =
        KeyAgreement.getInstance("ECDH").run {
            init(privateKey)
            doPhase(importPublic(publicB64), true)
            generateSecret()
        }

    // ===== Pedido (PC → celular) =====

    /**
     * Decifra e confere um pedido da caixa postal. Lança exceção se não abrir,
     * não for deste pareamento/id, for de tipo desconhecido ou estiver vencido.
     */
    fun openRequest(secret: ByteArray, pairId: String, reqId: String, box: String,
                    now: Long = System.currentTimeMillis()): Request {
        val plain = LinkProtocol.gcmOpen(requestKey(secret, reqId), unb64.decode(box), "$pairId|$reqId")
        val o = JSONObject(String(plain, Charsets.UTF_8))
        require(o.optInt("v") == 1 && o.optString("reqId") == reqId && o.optString("pairId") == pairId &&
            o.optString("kind") in KINDS) { "pedido inválido" }
        val ts = o.optLong("ts", 0)
        val expiresAt = o.optLong("expiresAt", 0)
        require(kotlin.math.abs(now - ts) <= CLOCK_SKEW_MS && now <= expiresAt) { "pedido vencido" }
        val epk = o.optString("epk")
        importPublic(epk) // falha já aqui se a chave do PC não servir
        return Request(
            pairId = pairId,
            reqId = reqId,
            kind = o.getString("kind"),
            desktop = o.optString("desktop").ifBlank { "PC" },
            client = o.optString("client").ifBlank { "agente" },
            ts = ts,
            expiresAt = expiresAt,
            epk = epk,
            pending = o.optInt("pending", 1).coerceAtLeast(1),
            summary = o.optJSONObject("summary") ?: JSONObject(),
            windowMinutes = o.optInt("windowMinutes", 5).takeIf { it in setOf(5, 15, 30) } ?: 5,
            allowWindow = o.optBoolean("allowWindow", false),
            // Calculado aqui (o mesmo que o PC mostra), sem depender do campo "code"
            code = if (o.getString("kind") == "unlock") LinkProtocol.verificationCode(secret, reqId) else null,
        )
    }

    // ===== Resposta (celular → PC) =====

    /** Corpo da resposta (antes de cifrar). [kd] vai em base64 padrão. */
    fun answerBody(id: String, decision: String, now: Long, mode: String? = null, minutes: Int? = null,
                   kd: ByteArray? = null): JSONObject {
        val o = JSONObject().put("v", 1).put("reqId", id).put("decision", decision).put("ts", now)
        if (mode != null) o.put("mode", mode)
        if (minutes != null && minutes > 0) o.put("minutes", minutes)
        if (kd != null) o.put("kd", b64.encodeToString(kd))
        return o
    }

    /**
     * Cifra a resposta para a [pcEpk] do pedido com uma chave efêmera nova.
     * Devolve `{ epk, box }`, o corpo do POST /{id}/answer.
     */
    fun sealAnswer(secret: ByteArray, pairId: String, id: String, pcEpk: String, decision: String,
                   mode: String? = null, minutes: Int? = null, kd: ByteArray? = null,
                   now: Long = System.currentTimeMillis()): JSONObject {
        val kp = newKeyPair()
        val shared = ecdh(kp.private, pcEpk)
        val key = answerKey(secret, id, shared)
        shared.fill(0)
        val plain = answerBody(id, decision, now, mode, minutes, kd).toString().toByteArray(Charsets.UTF_8)
        val box = LinkProtocol.gcmSeal(key, plain, "$pairId|$id|answer")
        plain.fill(0)
        key.fill(0)
        return JSONObject().put("epk", exportPublic(kp.public)).put("box", b64.encodeToString(box))
    }

    // ===== Push =====

    /** Push `type: "relay"`: assinado com S e recente (5 min). */
    fun verifyRelayPush(secret: ByteArray, pairId: String, ts: String, nonce: String, sig: String?,
                        now: Long = System.currentTimeMillis()): Boolean {
        val t = ts.toLongOrNull() ?: return false
        if (kotlin.math.abs(now - t) > CLOCK_SKEW_MS || nonce.isBlank()) return false
        return LinkProtocol.macOk(secret, sig, "relay", pairId, ts, nonce)
    }
}
