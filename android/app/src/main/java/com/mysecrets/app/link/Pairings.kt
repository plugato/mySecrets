package com.mysecrets.app.link

import android.content.Context
import android.content.SharedPreferences
import com.mysecrets.app.crypto.Keys
import com.mysecrets.app.vault.Vault
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONArray
import org.json.JSONObject
import javax.crypto.Cipher

/**
 * PCs pareados. Por PC guardamos:
 *  - secret: segredo do pareamento (S), protegido pela chave de armazenamento;
 *  - unlockKey: chave de desbloqueio (K_d), protegida pela chave biométrica —
 *    só sai com a digital, na hora de aprovar.
 */
object Pairings {
    data class Pc(val pairId: String, val desktopName: String, val pairedAt: String, val confirmed: Boolean,
                  val secretSealed: String, val unlockSealed: String, val lastUsedAt: String?) {
        fun secret(): ByteArray = Keys.open(secretSealed)
    }

    private lateinit var prefs: SharedPreferences
    private val _list = MutableStateFlow<List<Pc>>(emptyList())
    val list: StateFlow<List<Pc>> = _list

    fun init(context: Context) {
        prefs = context.getSharedPreferences("pairings", Context.MODE_PRIVATE)
        _list.value = load()
    }

    private fun load(): List<Pc> = try {
        val arr = JSONArray(prefs.getString("list", "[]"))
        (0 until arr.length()).map {
            val o = arr.getJSONObject(it)
            Pc(o.getString("pairId"), o.optString("desktopName"), o.optString("pairedAt"), o.optBoolean("confirmed"),
                o.getString("secret"), o.getString("unlock"), o.optString("lastUsedAt").ifBlank { null })
        }
    } catch (_: Exception) { emptyList() }

    private fun save(list: List<Pc>) {
        val arr = JSONArray()
        list.forEach {
            arr.put(JSONObject().put("pairId", it.pairId).put("desktopName", it.desktopName).put("pairedAt", it.pairedAt)
                .put("confirmed", it.confirmed).put("secret", it.secretSealed).put("unlock", it.unlockSealed)
                .put("lastUsedAt", it.lastUsedAt ?: ""))
        }
        prefs.edit().putString("list", arr.toString()).apply()
        _list.value = list
    }

    fun find(pairId: String): Pc? = _list.value.firstOrNull { it.pairId == pairId }

    /** Grava o pareamento lido do QR. [bioCipher] já liberado pela digital. */
    fun add(qr: LinkProtocol.QrPairing, bioCipher: Cipher) {
        val pc = Pc(qr.pairId, qr.desktopName, Vault.now(), false,
            Keys.seal(qr.secret), Keys.finishSeal(bioCipher, qr.unlockKey), null)
        qr.unlockKey.fill(0)
        save(_list.value.filter { it.pairId != qr.pairId } + pc)
    }

    fun markConfirmed(pairId: String) = save(_list.value.map { if (it.pairId == pairId) it.copy(confirmed = true) else it })

    fun markUsed(pairId: String) = save(_list.value.map { if (it.pairId == pairId) it.copy(lastUsedAt = Vault.now()) else it })

    fun remove(pairId: String) = save(_list.value.filter { it.pairId != pairId })
}
