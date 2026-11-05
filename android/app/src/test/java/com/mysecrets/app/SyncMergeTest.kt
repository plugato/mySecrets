package com.mysecrets.app

import com.mysecrets.app.vault.Vault
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.AfterClass
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Test
import java.io.File
import java.nio.file.Files

/**
 * Mescla da sincronização (Vault.applySync): usa o estado local ATUAL, então
 * edições e exclusões feitas enquanto a rede respondia não se perdem.
 */
class SyncMergeTest {
    companion object {
        private lateinit var dir: File

        @BeforeClass @JvmStatic fun setup() {
            dir = Files.createTempDirectory("mysecrets-sync").toFile()
            Vault.initDir(dir)
            runBlocking { Vault.create("senha-de-teste") }
        }

        @AfterClass @JvmStatic fun teardown() {
            Vault.lock()
            dir.deleteRecursively()
        }
    }

    private fun e(id: String, title: String, min: Int) =
        JSONObject().put("id", id).put("type", "note").put("title", title)
            .put("updatedAt", "2026-11-05T12:%02d:00.000Z".format(min))

    private fun ids(list: List<JSONObject>) = list.map { it.getString("id") }.sorted()

    @Test fun edicaoEExclusaoDuranteOSyncNaoSePerdem() = runBlocking {
        Vault.upsert(e("a", "A", 1))
        Vault.upsert(e("b", "B", 1))
        // A nuvem foi lida ANTES destas edições locais (snapshot antigo)
        val remotoLidoAntes = listOf(e("a", "A", 1), e("b", "B", 1), e("c", "Do PC", 2))

        // Enquanto a rede respondia: edita "a" e apaga "b" de vez
        Vault.upsert(e("a", "A editada", 5))
        Vault.deleteForever("b")

        val r = Vault.applySync(remotoLidoAntes, emptyMap())
        assertEquals(listOf("a", "c"), ids(r.merged))
        assertEquals("A editada", r.merged.first { it.getString("id") == "a" }.getString("title"))
        assertTrue("exclusão de b vai para a nuvem", r.tombstones.containsKey("b"))
        assertEquals(listOf("a", "c"), ids(Vault.entries.value))
        assertTrue(r.localChanged)

        // Exclusões que chegam da nuvem também valem
        val r2 = Vault.applySync(null, mapOf("c" to "2026-11-05T12:30:00.000Z"))
        assertEquals(listOf("a"), ids(r2.merged))
    }

    @Test fun exclusoesLocaisIlegiveisSaoGuardadas() {
        val f = File(dir, Vault.TOMBSTONES_FILE)
        f.writeText("{ quebrado")
        assertEquals(emptyMap<String, String>(), Vault.readTombstones())
        val guardado = dir.listFiles()!!.firstOrNull { it.name.startsWith(".corrompido-") }
        assertTrue("cópia guardada", guardado != null)
        assertEquals("{ quebrado", guardado!!.readText())
    }
}
