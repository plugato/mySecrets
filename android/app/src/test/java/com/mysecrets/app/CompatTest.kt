package com.mysecrets.app

import com.mysecrets.app.crypto.VaultCrypto
import com.mysecrets.app.link.LinkProtocol
import com.mysecrets.app.otp.Otp
import com.mysecrets.app.vault.Merge
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Compatibilidade com o desktop: os vetores em tests/fixtures/ foram gerados
 * pelo código Node (src/lib/vault-crypto.js e src/lib/phone-link.js).
 */
class CompatTest {
    private fun fixture(name: String) = JSONObject(File("../../tests/fixtures/$name").readText())

    @Test fun abreCofreV2DoDesktop() {
        val f = fixture("vault-vectors.json")
        val list = JSONArray(VaultCrypto.decrypt(f.getJSONObject("v2"), f.getString("password")))
        assertEquals(f.getJSONArray("entries").toString(), list.toString())
        assertEquals("p@ss/çã", list.getJSONObject(0).getString("password"))
    }

    @Test fun abreCofreLegadoV1() {
        val f = fixture("vault-vectors.json")
        val list = JSONArray(VaultCrypto.decrypt(f.getJSONObject("v1"), f.getString("password")))
        assertEquals(2, list.length())
    }

    @Test fun senhaErradaFalha() {
        val f = fixture("vault-vectors.json")
        try {
            VaultCrypto.decrypt(f.getJSONObject("v2"), "errada")
            fail("deveria falhar")
        } catch (_: Exception) {}
    }

    @Test fun cifraNoFormatoV2ReaproveitandoAChave() {
        val key = VaultCrypto.newKey("abc")
        val a = VaultCrypto.encrypt("[1]", key)
        val b = VaultCrypto.encrypt("[2]", key)
        assertEquals(2, a.getInt("version"))
        assertEquals(a.getString("salt"), b.getString("salt"))
        assertTrue(a.getString("iv") != b.getString("iv"))
        assertEquals("[2]", VaultCrypto.decrypt(b, "abc"))
    }

    @Test fun protocoloBateComONode() {
        val v = fixture("phone-link-vectors.json")
        val secret = Base64.getDecoder().decode(v.getString("secret"))
        val parts = v.getJSONArray("macParts")
        val args = (0 until parts.length()).map { parts.get(it).let { p -> if (p is Number) p.toLong() else p } }.toTypedArray()
        assertEquals(v.getString("mac"), LinkProtocol.mac(secret, *args))
        assertEquals(v.getString("code"), LinkProtocol.verificationCode(secret, v.getString("nonce")))

        val qr = LinkProtocol.parseQr(v.getString("qr"))
        assertEquals(v.getString("pairId"), qr.pairId)
        assertEquals("PC-Teste", qr.desktopName)
        assertEquals(v.getString("unlockKey"), Base64.getEncoder().encodeToString(qr.unlockKey))

        // A aprovação gerada aqui abre do mesmo jeito que o PC abre (iv || ct || tag)
        val nonce = v.getString("nonce")
        val approval = LinkProtocol.approval(secret, qr.pairId, nonce, qr.unlockKey)
        val sealed = Base64.getDecoder().decode(approval.getString("data"))
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, SecretKeySpec(LinkProtocol.hmac(secret, "unlock-key", nonce), "AES"), GCMParameterSpec(128, sealed, 0, 12))
        c.updateAAD("${qr.pairId}|$nonce".toByteArray())
        val k = c.doFinal(sealed, 12, sealed.size - 12)
        assertEquals(v.getString("unlockKey"), Base64.getEncoder().encodeToString(k))
    }

    @Test fun helloValidoEAdulterado() {
        val secret = ByteArray(32) { it.toByte() }
        val ts = System.currentTimeMillis()
        val hello = JSONObject().put("v", 1).put("op", "unlock").put("pair", "p1").put("name", "PC").put("nonce", "n1").put("ts", ts)
            .put("mac", LinkProtocol.mac(secret, "hello", "unlock", "p1", "n1", ts, "PC"))
        assertTrue(LinkProtocol.verifyHello(secret, hello))
        assertFalse(LinkProtocol.verifyHello(secret, JSONObject(hello.toString()).put("name", "Outro")))
        assertFalse(LinkProtocol.verifyHello(secret, hello, ts + 10 * 60 * 1000))
    }

    private fun e(id: String, updated: String, extra: Map<String, Any> = emptyMap()) =
        JSONObject().put("id", id).put("updatedAt", updated).also { o -> extra.forEach { (k, v) -> o.put(k, v) } }

    @Test fun mesclagemIgualAoDesktop() {
        val pc1 = listOf(e("a", "2026-01-02T00:00:00Z", mapOf("title" to "A novo")), e("b", "2026-01-01T00:00:00Z"))
        val pc2 = listOf(e("a", "2026-01-01T00:00:00Z", mapOf("title" to "A velho")), e("c", "2026-01-03T00:00:00Z"))
        val r = Merge.mergeVaults(listOf(pc1, pc2))
        assertEquals(listOf("a", "b", "c"), r.map { it.getString("id") })
        assertEquals("A novo", r[0].getString("title"))
        val lixo = Merge.mergeVaults(listOf(listOf(e("a", "2026-01-03T00:00:00Z")), listOf(e("a", "2026-01-01T00:00:00Z", mapOf("deletedAt" to "2026-01-05T00:00:00.000Z")))))
        assertTrue(lixo[0].has("deletedAt"))
        val apagado = Merge.mergeVaults(listOf(pc1), mapOf("b" to "2026-02-01T00:00:00.000Z"))
        assertEquals(listOf("a"), apagado.map { it.getString("id") })
    }

    @Test fun totpRfc6238() {
        // Vetor do RFC 6238 (SHA1, 8 dígitos, T=59s)
        val secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
        assertEquals("94287082", Otp.totp(secret, 30, 8, "sha1", 59_000).code)
        assertEquals("6", Otp.totp("JBSWY3DPEHPK3PXP", nowMs = 0).code.length.toString())
    }
}
