package com.mysecrets.app

import com.mysecrets.app.link.LinkProtocol
import com.mysecrets.app.link.RelayProtocol
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File
import java.security.KeyFactory
import java.security.spec.PKCS8EncodedKeySpec
import java.util.Base64

/**
 * Relay (aprovar de qualquer lugar): vetores gerados pelo Node
 * (src/lib/phone-relay.js), em src/test/resources/relay-vectors.json.
 */
class RelayProtocolTest {
    private val v = JSONObject(File("src/test/resources/relay-vectors.json").readText())
    private val secret = hex(v.getString("S_hex"))
    private val pairId = v.getString("pairId")
    private val reqId = v.getString("reqId")
    private val now = 1700000000000L + 10_000

    private fun hex(s: String) = ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    private fun hexOf(b: ByteArray) = b.joinToString("") { "%02x".format(it) }
    private fun b64(s: String) = Base64.getDecoder().decode(s)
    private fun privateKey(name: String) = KeyFactory.getInstance("EC").generatePrivate(PKCS8EncodedKeySpec(b64(v.getString(name))))

    @Test fun canalEChaveDoPedido() {
        assertEquals(v.getString("channelId"), RelayProtocol.channelId(secret))
        assertEquals(v.getString("requestKey_hex"), hexOf(RelayProtocol.requestKey(secret, reqId)))
        assertEquals("e$reqId", RelayProtocol.endId(reqId))
    }

    @Test fun abrePedidoDoPc() {
        val r = RelayProtocol.openRequest(secret, pairId, reqId, v.getString("requestBox_b64"), now)
        val j = JSONObject(v.getString("requestJson"))
        assertEquals("read", r.kind)
        assertEquals(j.getString("desktop"), r.desktop)
        assertEquals(j.getString("client"), r.client)
        assertEquals(j.getString("epk"), r.epk)
        assertEquals(1700000240000L, r.expiresAt)
        assertEquals("github", r.summary.getString("query"))
        assertEquals(5, r.windowMinutes)
        assertTrue(r.allowWindow)
        assertNull(r.code)
    }

    @Test fun recusaPedidoVencidoOuDeOutro() {
        val box = v.getString("requestBox_b64")
        fun falha(block: () -> Unit) = try { block(); fail("deveria recusar") } catch (_: Exception) {}
        falha { RelayProtocol.openRequest(secret, pairId, reqId, box, 1700000240000L + 1) } // depois de expiresAt
        falha { RelayProtocol.openRequest(secret, pairId, reqId, box, 1700000000000L - 6 * 60 * 1000) } // relógio
        falha { RelayProtocol.openRequest(secret, "outro", reqId, box, now) }
        falha { RelayProtocol.openRequest(secret, pairId, "BBBBBBBBBBBBBBBBBBBBBB", box, now) }
        falha { RelayProtocol.openRequest(ByteArray(32), pairId, reqId, box, now) }
    }

    @Test fun ecdhEChaveDaRespostaBatemComONode() {
        val shared = RelayProtocol.ecdh(privateKey("phonePrivatePkcs8_b64"), v.getString("pcPublicSpki_b64"))
        assertEquals(v.getString("ecdhShared_hex"), hexOf(shared))
        // Do lado do PC dá o mesmo segredo
        assertEquals(hexOf(shared), hexOf(RelayProtocol.ecdh(privateKey("pcPrivatePkcs8_b64"), v.getString("phonePublicSpki_b64"))))
        val key = RelayProtocol.answerKey(secret, reqId, shared)
        assertEquals(v.getString("answerKey_hex"), hexOf(key))
        val plain = LinkProtocol.gcmOpen(key, b64(v.getString("answerBox_b64")), "$pairId|$reqId|answer")
        assertEquals(v.getString("answerJson"), String(plain, Charsets.UTF_8))
    }

    @Test fun respostaCifradaAbreNoPc() {
        val kd = ByteArray(32) { 7 }
        val msg = RelayProtocol.sealAnswer(secret, pairId, reqId, v.getString("pcPublicSpki_b64"), "approve",
            mode = "window", minutes = 15, kd = kd, now = now)
        // O PC faz o ECDH com a chave privada dele e a epk do celular
        val shared = RelayProtocol.ecdh(privateKey("pcPrivatePkcs8_b64"), msg.getString("epk"))
        val body = JSONObject(String(LinkProtocol.gcmOpen(RelayProtocol.answerKey(secret, reqId, shared),
            b64(msg.getString("box")), "$pairId|$reqId|answer"), Charsets.UTF_8))
        assertEquals(1, body.getInt("v"))
        assertEquals(reqId, body.getString("reqId"))
        assertEquals("approve", body.getString("decision"))
        assertEquals("window", body.getString("mode"))
        assertEquals(15, body.getInt("minutes"))
        assertEquals(now, body.getLong("ts"))
        assertEquals(Base64.getEncoder().encodeToString(kd), body.getString("kd"))

        // Negar e encerrar não levam K_d; o fim vai para a escuta "e" + reqId
        val end = RelayProtocol.endId(reqId)
        val m2 = RelayProtocol.sealAnswer(secret, pairId, end, v.getString("pcPublicSpki_b64"), "end", now = now)
        val s2 = RelayProtocol.ecdh(privateKey("pcPrivatePkcs8_b64"), m2.getString("epk"))
        val b2 = JSONObject(String(LinkProtocol.gcmOpen(RelayProtocol.answerKey(secret, end, s2),
            b64(m2.getString("box")), "$pairId|$end|answer"), Charsets.UTF_8))
        assertEquals("end", b2.getString("decision"))
        assertEquals(end, b2.getString("reqId"))
        assertFalse(b2.has("kd") || b2.has("mode") || b2.has("minutes"))
    }

    @Test fun pushDoRelay() {
        val p = v.getJSONObject("relayPush")
        val ts = p.getString("ts")
        val t = ts.toLong()
        assertTrue(RelayProtocol.verifyRelayPush(secret, p.getString("pairId"), ts, p.getString("nonce"), p.getString("sig"), t + 1000))
        assertFalse(RelayProtocol.verifyRelayPush(secret, "outro", ts, p.getString("nonce"), p.getString("sig"), t))
        assertFalse(RelayProtocol.verifyRelayPush(secret, p.getString("pairId"), ts, p.getString("nonce"), p.getString("sig"), t + 6 * 60 * 1000))
        assertFalse(RelayProtocol.verifyRelayPush(ByteArray(32), p.getString("pairId"), ts, p.getString("nonce"), p.getString("sig"), t))
        // Assinatura de "wake" não serve como "relay"
        assertFalse(LinkProtocol.verifyWake(secret, p.getString("pairId"), ts, p.getString("nonce"), p.getString("sig"), t))
    }

    @Test fun codigoDoLoginPeloRelay() {
        assertEquals(v.getString("unlockCode_for_reqId"), LinkProtocol.verificationCode(secret, reqId))
    }
}
