package com.mysecrets.app

import com.mysecrets.app.crypto.VaultCrypto
import com.mysecrets.app.link.LinkServer
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.net.InetAddress

class HardeningTest {
    private fun ip(s: String) = InetAddress.getByName(s)

    @Test fun linkServerSoAtendeRedeLocal() {
        for (local in listOf("192.168.0.10", "10.1.2.3", "172.16.5.4", "172.31.255.1", "169.254.1.1",
                "127.0.0.1", "fe80::1", "fd12:3456::1", "::ffff:192.168.0.10", "::1")) {
            assertTrue(local, LinkServer.isLocalNetwork(ip(local)))
        }
        for (fora in listOf("8.8.8.8", "100.64.0.1", "172.32.0.1", "2804:14c:1::1", "2001:4860:4860::8888", "::ffff:8.8.8.8")) {
            assertFalse(fora, LinkServer.isLocalNetwork(ip(fora)))
        }
        assertFalse(LinkServer.isLocalNetwork(null))
    }

    @Test fun iteracoesDoArquivoTemLimite() {
        assertEquals(VaultCrypto.V2_ITERATIONS, VaultCrypto.iterationsOf(JSONObject()))
        assertEquals(600000, VaultCrypto.iterationsOf(JSONObject().put("iterations", 600000)))
        for (ruim in listOf<Any>(1_000_000_000_000L, 999, 0.5, -1, "600000")) {
            try {
                VaultCrypto.iterationsOf(JSONObject().put("iterations", ruim))
                fail("aceitou $ruim")
            } catch (e: IllegalArgumentException) {
                assertTrue(e.message!!.contains("iterações"))
            }
        }
    }
}
