package com.mysecrets.app.autofill

import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.edit
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * Digital Asset Links: o site diz quais apps podem usar os logins dele, em
 * https://<site>/.well-known/assetlinks.json (pacote + certificado SHA-256).
 *
 * Serve para o caso em que o MySecrets só adivinharia pelo nome do pacote
 * (netflix.com ↔ com.netflix.mediaclient): qualquer um pode publicar um app
 * chamado com.netflix.qualquer, mas não assinado com o certificado da Netflix.
 */
object AssetLinks {
    enum class Status {
        /** O site lista este app (pacote e certificado). */
        VERIFIED,
        /** O site lista apps Android, e este não está entre eles. */
        DENIED,
        /** Sem arquivo, sem apps listados, sem rede ou ainda não consultado. */
        UNKNOWN
    }

    private val RELATIONS = setOf(
        "delegate_permission/common.get_login_creds",
        "delegate_permission/common.handle_all_urls"
    )

    /** Lê um assetlinks.json. [certs]: SHA-256 do(s) certificado(s) do app, "AA:BB:…". */
    fun evaluate(json: String, pkg: String, certs: Set<String>): Status {
        val arr = try { JSONArray(json) } catch (_: Exception) { return Status.UNKNOWN }
        val wanted = certs.map { normalize(it) }.toSet()
        var listsApps = false
        for (i in 0 until arr.length()) {
            val st = arr.optJSONObject(i) ?: continue
            val target = st.optJSONObject("target") ?: continue
            if (target.optString("namespace") != "android_app") continue
            val rels = st.optJSONArray("relation") ?: continue
            if ((0 until rels.length()).none { rels.optString(it) in RELATIONS }) continue
            listsApps = true
            if (target.optString("package_name") != pkg) continue
            val fps = target.optJSONArray("sha256_cert_fingerprints") ?: continue
            if ((0 until fps.length()).any { normalize(fps.optString(it)) in wanted }) return Status.VERIFIED
        }
        return if (listsApps) Status.DENIED else Status.UNKNOWN
    }

    private fun normalize(fp: String) = fp.replace(":", "").trim().uppercase()

    fun fingerprint(cert: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(cert).joinToString(":") { "%02X".format(it) }

    /** Certificados com que o app instalado foi assinado. Vazio se não der para ler. */
    fun appCerts(ctx: Context, pkg: String): Set<String> = try {
        val info = ctx.packageManager.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo
        val sigs = when {
            info == null -> emptyArray()
            info.hasMultipleSigners() -> info.apkContentsSigners
            else -> info.signingCertificateHistory
        }
        sigs.map { fingerprint(it.toByteArray()) }.toSet()
    } catch (_: Exception) { emptySet() }

    /** Endereços onde procurar o arquivo, na ordem: o host da entrada e o domínio registrável. */
    fun candidates(host: String): List<String> {
        val site = Structure.registrableDomain(host) ?: return emptyList()
        return listOf(host, site, "www.$site").distinct()
    }

    // ===== Cache e rede =====

    private const val PREFS = "assetlinks"
    private const val TTL_ANSWER = 7L * 24 * 3600 * 1000   // o site respondeu (lista ou não o app)
    private const val TTL_NO_FILE = 24L * 3600 * 1000      // o site não tem o arquivo
    private const val MAX_BYTES = 256 * 1024

    private val http by lazy {
        OkHttpClient.Builder()
            .followRedirects(false).followSslRedirects(false) // como o Android faz com App Links
            .connectTimeout(1500, TimeUnit.MILLISECONDS)
            .readTimeout(1500, TimeUnit.MILLISECONDS)
            .callTimeout(2500, TimeUnit.MILLISECONDS)
            .build()
    }

    private fun key(host: String, pkg: String, certs: Set<String>) = "$host|$pkg|${certs.sorted().joinToString(",")}"

    /** Só o que já está em cache: não acessa a rede (pode ser chamado na thread principal). */
    fun cached(ctx: Context, host: String, pkg: String): Status {
        val certs = appCerts(ctx, pkg)
        if (certs.isEmpty()) return Status.UNKNOWN
        val raw = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(key(host, pkg, certs), null) ?: return Status.UNKNOWN
        val (st, until) = raw.split('|').let { (it.getOrNull(0) ?: "") to (it.getOrNull(1)?.toLongOrNull() ?: 0L) }
        if (System.currentTimeMillis() > until) return Status.UNKNOWN
        return runCatching { Status.valueOf(st) }.getOrDefault(Status.UNKNOWN)
    }

    fun isCached(ctx: Context, host: String, pkg: String): Boolean {
        val certs = appCerts(ctx, pkg)
        if (certs.isEmpty()) return true // nada a consultar
        val raw = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(key(host, pkg, certs), null) ?: return false
        return (raw.substringAfter('|').toLongOrNull() ?: 0L) > System.currentTimeMillis()
    }

    /** Consulta o site (acessa a rede: nunca na thread principal) e guarda a resposta. */
    fun check(ctx: Context, host: String, pkg: String): Status {
        val certs = appCerts(ctx, pkg)
        if (certs.isEmpty()) return Status.UNKNOWN
        var answer: Status? = null
        var reachedAny = false
        for (h in candidates(host)) {
            val body = fetch(h)
            if (body == null) continue
            reachedAny = true
            val st = if (body.isEmpty()) Status.UNKNOWN else evaluate(body, pkg, certs)
            if (st != Status.UNKNOWN) { answer = st; break }
        }
        // Erro de rede em todos: não guarda (tenta de novo na próxima vez)
        if (!reachedAny) return Status.UNKNOWN
        val st = answer ?: Status.UNKNOWN
        val ttl = if (answer != null) TTL_ANSWER else TTL_NO_FILE
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit {
            putString(key(host, pkg, certs), "${st.name}|${System.currentTimeMillis() + ttl}")
        }
        return st
    }

    /** Conteúdo do arquivo; "" se o site respondeu sem ele (404, redirecionamento…); null se não respondeu. */
    private fun fetch(host: String): String? {
        val req = Request.Builder().url("https://$host/.well-known/assetlinks.json").header("Accept", "application/json").build()
        return try {
            http.newCall(req).execute().use { resp ->
                if (resp.code != 200) return ""
                val body = resp.body ?: return ""
                val out = java.io.ByteArrayOutputStream()
                val buf = ByteArray(8192)
                body.byteStream().use { input ->
                    while (out.size() <= MAX_BYTES) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                    }
                }
                if (out.size() > MAX_BYTES) "" else out.toString("UTF-8")
            }
        } catch (_: Exception) { null }
    }

    fun clear(ctx: Context) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit { clear() }
    }
}
