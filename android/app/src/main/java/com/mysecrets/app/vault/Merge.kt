package com.mysecrets.app.vault

import org.json.JSONObject
import java.time.Instant
import java.time.OffsetDateTime

/**
 * Mesclagem entrada por entrada — porte de src/lib/vault-sync.js.
 * Por id vence a alteração mais recente (updatedAt/deletedAt); empate fica com
 * a primeira lista (a deste aparelho). Lápides (exclusão definitiva) removem a
 * entrada se forem posteriores à última alteração dela.
 */
object Merge {
    fun time(iso: Any?): Long {
        val s = (iso as? String)?.takeIf { it.isNotBlank() } ?: return 0
        return try {
            Instant.parse(s).toEpochMilli()
        } catch (_: Exception) {
            try {
                OffsetDateTime.parse(s).toInstant().toEpochMilli()
            } catch (_: Exception) {
                0
            }
        }
    }

    fun entryTime(e: JSONObject?): Long {
        if (e == null) return 0
        return maxOf(time(e.opt("updatedAt")), time(e.opt("deletedAt")))
    }

    fun mergeTombstones(vararg maps: Map<String, String>): MutableMap<String, String> {
        val out = LinkedHashMap<String, String>()
        for (m in maps) for ((id, quando) in m) {
            val atual = out[id]
            if (atual == null || time(quando) > time(atual)) out[id] = quando
        }
        return out
    }

    fun mergeVaults(lists: List<List<JSONObject>>, tombstones: Map<String, String> = emptyMap()): MutableList<JSONObject> {
        val byId = LinkedHashMap<String, JSONObject>()
        for (list in lists) for (e in list) {
            val id = e.optString("id")
            if (id.isEmpty()) continue
            val atual = byId[id]
            if (atual == null || entryTime(e) > entryTime(atual)) byId[id] = e
        }
        for ((id, quando) in tombstones) {
            val e = byId[id] ?: continue
            if (time(quando) >= entryTime(e)) byId.remove(id)
        }
        return byId.values.toMutableList()
    }

    fun removedIds(before: Collection<String>, after: List<JSONObject>): List<String> {
        val agora = after.map { it.optString("id") }.toSet()
        return before.filter { it.isNotEmpty() && it !in agora }
    }
}
