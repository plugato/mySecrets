package com.mysecrets.app.vault

import com.mysecrets.app.R
import com.mysecrets.app.str
import android.content.Context
import com.mysecrets.app.crypto.VaultCrypto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant

/**
 * O cofre deste aparelho: um secrets.enc (mesmo formato do desktop) em
 * filesDir, mais o arquivo de lápides usado na sincronização.
 *
 * Desbloqueado, as entradas ficam só na memória do processo; [lock] apaga tudo.
 * As entradas são JSONObject para não perder campos que este app não conhece
 * (versões futuras do desktop continuam íntegras depois de editar no celular).
 */
object Vault {
    const val VAULT_FILE = "secrets.enc"
    const val TOMBSTONES_FILE = ".mysecrets-exclusoes.json"

    private lateinit var dir: File
    private val mutex = Mutex()

    private var key: VaultCrypto.Key? = null
    private var password: String? = null
    private var knownIds: Set<String> = emptySet()

    private val _entries = MutableStateFlow<List<JSONObject>>(emptyList())
    val entries: StateFlow<List<JSONObject>> = _entries
    private val _unlocked = MutableStateFlow(false)
    val unlocked: StateFlow<Boolean> = _unlocked

    /** Chamado depois de cada gravação local (a sincronização escuta). */
    var onLocalChange: (() -> Unit)? = null

    fun init(context: Context) {
        dir = context.filesDir
    }

    /** Testes JVM: usa uma pasta qualquer no lugar de context.filesDir. */
    internal fun initDir(d: File) {
        dir = d
    }

    private val vaultFile get() = File(dir, VAULT_FILE)
    private val tombFile get() = File(dir, TOMBSTONES_FILE)

    fun exists(): Boolean = vaultFile.exists()
    val isUnlocked get() = _unlocked.value
    fun currentPassword(): String? = password

    class WrongPassword : Exception(str(R.string.senha_mestra_incorreta_ou_cofre_corrompido))

    suspend fun unlock(pass: String) = withContext(Dispatchers.Default) {
        mutex.withLock {
            val data = JSONObject(vaultFile.readText())
            val k = VaultCrypto.keyFor(data, pass)
            val list = try {
                parseEntries(VaultCrypto.decrypt(data, k))
            } catch (e: Exception) {
                throw WrongPassword()
            }
            // Formato legado: regrava no v2 já no primeiro desbloqueio (como o desktop)
            key = if (VaultCrypto.isLegacy(data)) VaultCrypto.newKey(pass) else k
            password = pass
            if (VaultCrypto.isLegacy(data)) writeFile(list)
            publish(list)
            _unlocked.value = true
        }
    }

    suspend fun create(pass: String) = withContext(Dispatchers.Default) {
        mutex.withLock {
            key = VaultCrypto.newKey(pass)
            password = pass
            writeFile(emptyList())
            publish(emptyList())
            _unlocked.value = true
        }
        onLocalChange?.invoke()
    }

    /** Primeiro uso: grava o arquivo baixado do Drive (ainda cifrado). */
    fun importEncrypted(content: String) {
        JSONObject(content).getString("encrypted") // valida o formato
        vaultFile.writeText(content)
    }

    fun lock() {
        key?.bytes?.fill(0)
        key = null
        password = null
        _entries.value = emptyList()
        knownIds = emptySet()
        _unlocked.value = false
    }

    /** Apaga o cofre deste aparelho (não mexe no Drive). */
    fun wipe() {
        lock()
        vaultFile.delete()
        tombFile.delete()
    }

    fun find(id: String): JSONObject? = _entries.value.firstOrNull { it.optString("id") == id }

    /**
     * Altera o cofre: recebe uma cópia das entradas, grava e publica.
     * Entradas removidas da lista viram lápides (exclusão definitiva).
     */
    suspend fun update(change: (MutableList<JSONObject>) -> Unit) = withContext(Dispatchers.Default) {
        mutex.withLock {
            check(_unlocked.value) { str(R.string.cofre_bloqueado) }
            val copy = _entries.value.map { JSONObject(it.toString()) }.toMutableList()
            change(copy)
            val removidos = Merge.removedIds(knownIds, copy)
            if (removidos.isNotEmpty()) {
                val t = readTombstones()
                val agora = now()
                removidos.forEach { t[it] = agora }
                writeTombstones(t)
            }
            writeFile(copy)
            publish(copy)
        }
        onLocalChange?.invoke()
    }

    suspend fun upsert(entry: JSONObject) = update { list ->
        val i = list.indexOfFirst { it.optString("id") == entry.optString("id") }
        if (i >= 0) list[i] = entry else list.add(entry)
    }

    suspend fun moveToTrash(id: String) = update { list ->
        list.firstOrNull { it.optString("id") == id }?.put("deletedAt", now())
    }

    suspend fun restore(id: String) = update { list ->
        list.firstOrNull { it.optString("id") == id }?.let { it.remove("deletedAt"); it.put("updatedAt", now()) }
    }

    suspend fun deleteForever(id: String) = update { list -> list.removeAll { it.optString("id") == id } }

    // ===== Usado pela sincronização =====

    /** Resultado da mescla de uma rodada de sincronização. */
    internal class SyncMerge(val merged: List<JSONObject>, val tombstones: Map<String, String>, val localChanged: Boolean)

    /**
     * Mescla o que veio da nuvem com o estado local ATUAL e grava, tudo dentro
     * do mutex das edições: o que o usuário salvou ou apagou enquanto a rede
     * respondia entra na mescla, em vez de ser sobrescrito (ou ressuscitado).
     */
    internal suspend fun applySync(remote: List<JSONObject>?, remoteT: Map<String, String>): SyncMerge = withContext(Dispatchers.Default) {
        mutex.withLock {
            check(_unlocked.value) { str(R.string.cofre_bloqueado) }
            val local = _entries.value
            val localT = readTombstones()
            val tombs = Merge.mergeTombstones(localT, remoteT)
            val merged = Merge.mergeVaults(if (remote != null) listOf(local, remote) else listOf(local), tombs)
            val changed = JSONArray(local).toString() != JSONArray(merged).toString()
            if (tombs != localT) writeTombstones(tombs)
            if (changed) {
                writeFile(merged)
                publish(merged)
            }
            SyncMerge(merged, tombs, changed)
        }
    }

    /** Abre um cofre vindo do Drive (reaproveita a chave se o salt for o mesmo). */
    internal fun decryptOther(content: String): List<JSONObject> {
        val data = JSONObject(content)
        val k = key ?: error(str(R.string.cofre_bloqueado))
        val usar = if (!VaultCrypto.isLegacy(data) && VaultCrypto.saltOf(data) == VaultCrypto.hex(k.salt) &&
            data.optInt("iterations", VaultCrypto.V2_ITERATIONS) == k.iterations) k
        else VaultCrypto.keyFor(data, password ?: error(str(R.string.cofre_bloqueado)))
        return parseEntries(VaultCrypto.decrypt(data, usar))
    }

    internal fun encryptForUpload(list: List<JSONObject>): String =
        VaultCrypto.encrypt(JSONArray(list).toString(), key ?: error(str(R.string.cofre_bloqueado))).toString()

    internal fun readTombstones(): MutableMap<String, String> {
        if (!tombFile.exists()) return mutableMapOf()
        return try {
            val o = JSONObject(tombFile.readText())
            o.keys().asSequence().associateWith { o.getString(it) }.toMutableMap()
        } catch (_: Exception) {
            // Ilegível: guarda uma cópia em vez de deixar a próxima gravação
            // apagar as exclusões que havia nele
            tombFile.renameTo(File(dir, ".corrompido-${System.currentTimeMillis()}-${TOMBSTONES_FILE.removePrefix(".")}"))
            mutableMapOf()
        }
    }

    private fun writeTombstones(t: Map<String, String>) {
        val o = JSONObject()
        t.forEach { (k, v) -> o.put(k, v) }
        tombFile.writeText(o.toString(2))
    }

    // ===== Interno =====

    private fun publish(list: List<JSONObject>) {
        _entries.value = list
        knownIds = list.map { it.optString("id") }.toSet()
    }

    private fun writeFile(list: List<JSONObject>) {
        val content = VaultCrypto.encrypt(JSONArray(list).toString(), key ?: error(str(R.string.cofre_bloqueado))).toString()
        val tmp = File(dir, "$VAULT_FILE.tmp")
        tmp.writeText(content)
        if (!tmp.renameTo(vaultFile)) {
            vaultFile.writeText(content)
            tmp.delete()
        }
    }

    fun parseEntries(json: String): MutableList<JSONObject> {
        val arr = JSONArray(json)
        return MutableList(arr.length()) { arr.getJSONObject(it) }
    }

    /** ISO com milissegundos, como o toISOString() do JavaScript. */
    fun now(): String = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MILLIS).toString()

    /** Mesmo formato do desktop: Date.now().toString(36) + aleatório. */
    fun newId(): String {
        val rnd = java.security.SecureRandom()
        val tail = (1..11).map { "0123456789abcdefghijklmnopqrstuvwxyz"[rnd.nextInt(36)] }.joinToString("")
        return java.lang.Long.toString(System.currentTimeMillis(), 36) + tail
    }
}
