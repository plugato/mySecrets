package com.mysecrets.app.drive

import android.content.Context
import android.content.SharedPreferences
import com.mysecrets.app.BuildConfig
import com.mysecrets.app.crypto.Keys
import com.mysecrets.app.vault.Merge
import com.mysecrets.app.vault.Vault
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.FormBody
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.security.MessageDigest

/** Cliente mínimo da API do Drive (escopo drive.file), igual ao do desktop. */
class DriveClient(private val refreshToken: String) {
    private var accessToken: String? = null
    private var expiresAt = 0L

    fun seed(access: String, expires: Long) {
        accessToken = access
        expiresAt = expires
    }

    private fun token(): String {
        accessToken?.let { if (System.currentTimeMillis() < expiresAt - 60_000) return it }
        val t = GoogleAuth.postJson(Request.Builder().url(GoogleAuth.TOKEN_URL).post(
            FormBody.Builder()
                .add("client_id", BuildConfig.GOOGLE_CLIENT_ID)
                .add("client_secret", BuildConfig.GOOGLE_CLIENT_SECRET)
                .add("refresh_token", refreshToken)
                .add("grant_type", "refresh_token")
                .build()).build())
        accessToken = t.getString("access_token")
        expiresAt = System.currentTimeMillis() + t.optLong("expires_in", 3600) * 1000
        return accessToken!!
    }

    private fun call(build: Request.Builder, retry: Boolean = true): String {
        val res = GoogleAuth.http.newCall(build.header("Authorization", "Bearer ${token()}").build()).execute()
        res.use {
            val body = it.body?.string() ?: ""
            if (it.code == 401 && retry) {
                accessToken = null
                return call(build, false)
            }
            if (!it.isSuccessful) {
                if (it.code == 403 && Regex("insufficient(Permissions| authentication scopes)", RegexOption.IGNORE_CASE).containsMatchIn(body)) {
                    throw GoogleAuth.AuthException(GoogleAuth.NO_DRIVE_PERMISSION, "insufficient_scope")
                }
                throw Exception("Google Drive respondeu HTTP ${it.code}: ${body.take(200)}")
            }
            return body
        }
    }

    data class FileMeta(val id: String, val name: String, val md5: String?)

    fun find(q: String): List<FileMeta> {
        val url = okhttp3.HttpUrl.Builder().scheme("https").host("www.googleapis.com").addPathSegments("drive/v3/files")
            .addQueryParameter("q", q)
            .addQueryParameter("fields", "files(id,name,md5Checksum,modifiedTime)")
            .addQueryParameter("spaces", "drive")
            .addQueryParameter("pageSize", "10")
            .build()
        val arr = JSONObject(call(Request.Builder().url(url))).optJSONArray("files") ?: return emptyList()
        return (0 until arr.length()).map {
            val o = arr.getJSONObject(it)
            FileMeta(o.getString("id"), o.optString("name"), o.optString("md5Checksum").ifBlank { null })
        }
    }

    fun findFolder(name: String): String? =
        find("name = '$name' and mimeType = '$FOLDER_MIME' and trashed = false").firstOrNull()?.id

    fun ensureFolder(name: String): String = findFolder(name) ?: JSONObject(call(Request.Builder()
        .url("$DRIVE/files?fields=id")
        .post(JSONObject().put("name", name).put("mimeType", FOLDER_MIME).toString().toRequestBody(JSON)))).getString("id")

    fun findFile(name: String, folderId: String): FileMeta? =
        find("name = '$name' and '$folderId' in parents and trashed = false").firstOrNull()

    fun download(id: String): String = call(Request.Builder().url("$DRIVE/files/$id?alt=media"))

    /** Cria ou substitui; devolve o md5 do conteúdo no Drive. */
    fun upload(name: String, folderId: String, content: String, fileId: String?, mime: String = "application/octet-stream"): String? {
        val fields = "fields=id,md5Checksum,modifiedTime"
        val body: RequestBody
        val req = if (fileId != null) {
            body = content.toRequestBody(mime.toMediaType())
            Request.Builder().url("$UPLOAD/files/$fileId?uploadType=media&$fields").patch(body)
        } else {
            body = MultipartBody.Builder().setType("multipart/related".toMediaType())
                .addPart(JSONObject().put("name", name).put("parents", org.json.JSONArray().put(folderId)).toString().toRequestBody(JSON))
                .addPart(content.toRequestBody(mime.toMediaType()))
                .build()
            Request.Builder().url("$UPLOAD/files?uploadType=multipart&$fields").post(body)
        }
        return JSONObject(call(req)).optString("md5Checksum").ifBlank { null }
    }

    companion object {
        const val DRIVE = "https://www.googleapis.com/drive/v3"
        const val UPLOAD = "https://www.googleapis.com/upload/drive/v3"
        const val FOLDER_MIME = "application/vnd.google-apps.folder"
        val JSON = "application/json; charset=UTF-8".toMediaType()
    }
}

/**
 * Sincronização com o Google Drive — mesmo algoritmo de runGdriveSync() do
 * desktop (src/main.js): baixa só se o md5 mudou, mescla por entrada com
 * lápides, envia se a nuvem não tem o resultado.
 */
/** A nuvem mudou entre a leitura e o envio: a rodada recomeça. */
class RemoteChanged : Exception("O cofre no Google Drive mudou durante a sincronização.")

object DriveSync {
    const val FOLDER = "MySecrets"
    private const val LEIA_ME = """MySecrets — cofre sincronizado
==============================

Esta pasta é mantida pelo app MySecrets (login com Google).

- secrets.enc: o seu cofre, criptografado com AES-256-GCM. Sem a senha mestra
  ninguém consegue ler, nem o Google.
- .mysecrets-exclusoes.json: identificadores de itens apagados (sem dados).

Não edite nem apague esses arquivos. Para usar em outro aparelho, instale o
MySecrets e entre com a mesma conta Google e a mesma senha mestra.
"""

    data class Status(val connected: Boolean, val email: String, val lastSyncAt: String?, val lastError: String?, val syncing: Boolean)

    private lateinit var prefs: SharedPreferences
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val mutex = Mutex()
    private var client: DriveClient? = null
    private var debounce: Job? = null

    private val _status = MutableStateFlow(Status(false, "", null, null, false))
    val status: StateFlow<Status> = _status

    fun init(context: Context) {
        prefs = context.getSharedPreferences("google-drive", Context.MODE_PRIVATE)
        publish(false)
        Vault.onLocalChange = { schedule() }
    }

    val connected get() = prefs.getString("token", null) != null

    private fun publish(syncing: Boolean) {
        _status.value = Status(connected, prefs.getString("email", "") ?: "", prefs.getString("lastSyncAt", null), prefs.getString("lastError", null), syncing)
    }

    private fun client(): DriveClient? {
        client?.let { return it }
        val sealed = prefs.getString("token", null) ?: return null
        val refresh = try { String(Keys.open(sealed)) } catch (_: Exception) { return null }
        return DriveClient(refresh).also { client = it }
    }

    /** Guarda a conta depois do login (refresh token protegido pelo Keystore). */
    fun saveAccount(t: GoogleAuth.Tokens) {
        prefs.edit().clear()
            .putString("token", Keys.seal(t.refreshToken.toByteArray()))
            .putString("email", t.email)
            .apply()
        client = DriveClient(t.refreshToken).also { it.seed(t.accessToken, t.expiresAt) }
        publish(false)
    }

    /**
     * Esquece a conta neste aparelho. Não revoga o token no Google: o OAuth
     * client é o mesmo do PC, e revogar derrubaria a sincronização de lá também.
     */
    fun disconnect() {
        prefs.edit().clear().apply()
        client = null
        publish(false)
    }

    /** Primeiro uso: baixa o cofre da pasta MySecrets (null se ainda não existe). */
    suspend fun downloadExisting(): String? = withContext(Dispatchers.IO) {
        val c = client() ?: error("Conta Google não conectada")
        val folder = c.findFolder(FOLDER) ?: return@withContext null
        prefs.edit().putString("folderId", folder).apply()
        val meta = c.findFile(Vault.VAULT_FILE, folder) ?: return@withContext null
        c.download(meta.id)
    }

    /** Agenda uma sincronização (vários pedidos seguidos viram um só). */
    fun schedule(delayMs: Long = 2000) {
        if (!connected || !Vault.isUnlocked) return
        debounce?.cancel()
        debounce = scope.launch {
            delay(delayMs)
            // Fora do job do atraso: um novo pedido cancela só a espera, nunca
            // uma sincronização já em andamento
            scope.launch { syncNow() }
        }
    }

    suspend fun syncNow() = withContext(Dispatchers.IO) {
        mutex.withLock {
            val c = client() ?: return@withLock
            if (!Vault.isUnlocked) return@withLock
            publish(true)
            try {
                // Rede pode estar bloqueada por instantes (app voltando do segundo plano)
                var tentativa = 0
                var mudouNaNuvem = 0
                while (true) {
                    try {
                        run(c)
                        break
                    } catch (e: RemoteChanged) {
                        // Outro aparelho enviou no meio da rodada: mescla de novo
                        if (++mudouNaNuvem >= 3) throw Exception("O cofre no Google Drive mudou durante a sincronização. Tente de novo.")
                    } catch (e: java.io.IOException) {
                        if (++tentativa >= 3) throw Exception("Sem conexão com o Google Drive (${e.message})")
                        delay(1500L * tentativa)
                    }
                }
                prefs.edit().putString("lastSyncAt", Vault.now()).remove("lastError").apply()
            } catch (e: GoogleAuth.AuthException) {
                if (e.code == "invalid_grant" || e.code == "insufficient_scope") {
                    client = null
                    prefs.edit().remove("token").putString("lastError",
                        if (e.code == "invalid_grant") "O acesso ao Google foi revogado. Entre novamente." else e.message).apply()
                } else {
                    prefs.edit().putString("lastError", e.message).apply()
                }
            } catch (e: Exception) {
                prefs.edit().putString("lastError", e.message ?: "Falha na sincronização").apply()
            } finally {
                publish(false)
            }
        }
    }

    private fun hash(entries: List<JSONObject>): String {
        val d = MessageDigest.getInstance("SHA-256").digest(org.json.JSONArray(entries).toString().toByteArray())
        return d.joinToString("") { "%02x".format(it) }
    }

    private suspend fun run(c: DriveClient) {
        var folderId = prefs.getString("folderId", null)
        if (folderId == null) {
            folderId = c.ensureFolder(FOLDER)
            if (c.findFile("LEIA-ME.txt", folderId) == null) c.upload("LEIA-ME.txt", folderId, LEIA_ME, null, "text/plain")
        }

        val remoteMeta = c.findFile(Vault.VAULT_FILE, folderId)
        val tombMeta = c.findFile(Vault.TOMBSTONES_FILE, folderId)

        // Baixa o cofre só se mudou. Erro de rede sobe como está (nova
        // tentativa); só a falha ao decifrar vira "outra senha".
        var remote: List<JSONObject>? = null
        if (remoteMeta != null && remoteMeta.md5 != prefs.getString("lastRemoteMd5", null)) {
            val texto = c.download(remoteMeta.id)
            remote = try {
                Vault.decryptOther(texto)
            } catch (_: Exception) {
                throw Exception("O cofre no Google Drive usa outra senha mestra (ou está corrompido).")
            }
        }

        // Exclusões da nuvem: falha ao baixar ou ler interrompe a rodada. Antes
        // virava "vazia" e era enviada por cima da lista dos outros aparelhos.
        val remoteT: Map<String, String> = tombMeta?.let {
            val texto = c.download(it.id)
            try {
                val o = JSONObject(texto)
                o.keys().asSequence().associateWith { k -> o.getString(k) }
            } catch (_: Exception) {
                throw Exception("A lista de exclusões no Google Drive está ilegível. A sincronização foi interrompida para não perder exclusões.")
            }
        } ?: emptyMap()

        // Mescla com o estado local atual (atômico com as edições do usuário)
        val r = Vault.applySync(remote, remoteT)
        val mergedHash = hash(r.merged)

        val remoteHash = if (remote != null) hash(remote) else if (remoteMeta != null) prefs.getString("lastSyncedHash", null) else null
        val enviarCofre = remoteMeta == null || mergedHash != remoteHash
        val enviarExclusoes = r.tombstones != remoteT
        var md5 = remoteMeta?.md5
        if (enviarCofre || enviarExclusoes) {
            // Outro aparelho enviou desde a leitura? Recomeça em vez de sobrescrever.
            val agoraV = c.findFile(Vault.VAULT_FILE, folderId)
            val agoraT = c.findFile(Vault.TOMBSTONES_FILE, folderId)
            if (agoraV?.md5 != remoteMeta?.md5 || agoraT?.md5 != tombMeta?.md5) throw RemoteChanged()
            if (enviarExclusoes) {
                // Exclusões primeiro: se o envio do cofre falhar, a próxima rodada ainda sabe o que foi apagado
                val o = JSONObject()
                r.tombstones.forEach { (k, v) -> o.put(k, v) }
                c.upload(Vault.TOMBSTONES_FILE, folderId, o.toString(2), tombMeta?.id, "application/json")
            }
            if (enviarCofre) {
                md5 = c.upload(Vault.VAULT_FILE, folderId, Vault.encryptForUpload(r.merged), remoteMeta?.id)
            }
        }

        prefs.edit()
            .putString("folderId", folderId)
            .putString("lastRemoteMd5", md5)
            .putString("lastSyncedHash", mergedHash)
            .apply()
    }
}
