package com.mysecrets.app.drive

import com.mysecrets.app.R
import com.mysecrets.app.str
import android.content.Context
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import com.mysecrets.app.BuildConfig
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.net.InetAddress
import java.net.ServerSocket
import java.net.SocketTimeoutException
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Login com Google usando o MESMO OAuth client do desktop (tipo "app para
 * computador"): navegador (Custom Tab) + redirecionamento para um servidor
 * loopback 127.0.0.1 aberto pelo app + PKCE. Mesmo projeto do Google Cloud =
 * mesmo acesso drive.file à pasta MySecrets que o desktop criou.
 */
object GoogleAuth {
    private const val AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
    const val TOKEN_URL = "https://oauth2.googleapis.com/token"
    private const val USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
    private const val REVOKE_URL = "https://oauth2.googleapis.com/revoke"
    const val DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file"
    val NO_DRIVE_PERMISSION: String
        get() = str(R.string.a_permissao_do_google_drive_nao) + str(R.string.marque_a_opcao_de_acesso_aos)

    val http = OkHttpClient()

    fun configured(): Boolean = BuildConfig.GOOGLE_CLIENT_ID.isNotBlank() && BuildConfig.GOOGLE_CLIENT_SECRET.isNotBlank()

    data class Tokens(val refreshToken: String, val accessToken: String, val expiresAt: Long, val email: String)

    private fun b64url(b: ByteArray) = Base64.getUrlEncoder().withoutPadding().encodeToString(b)

    /** Login em andamento (um só por vez; vive no processo, não na tela). */
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var pending: Deferred<Unit>? = null

    /**
     * Abre o login no navegador, espera o retorno e guarda a conta.
     *
     * O trabalho roda fora da tela que pediu: se ela sair de cena (cofre
     * bloqueado ao apagar a tela, Activity recriada pelo MIUI), o servidor
     * loopback continua de pé e a conta é guardada mesmo assim. Um serviço em
     * primeiro plano impede o sistema de congelar o app enquanto o Chrome está
     * na frente.
     */
    suspend fun connect(activity: Context) {
        val job = synchronized(this) {
            pending?.takeIf { it.isActive } ?: scope.async {
                val app = activity.applicationContext
                AuthKeepAliveService.start(app)
                try {
                    val t = com.mysecrets.app.MySecretsApp.duringExternalFlow { authorizeRaw(activity) }
                    DriveSync.saveAccount(t)
                } finally {
                    AuthKeepAliveService.stop(app)
                }
            }.also { pending = it }
        }
        job.await()
    }

    private suspend fun authorizeRaw(context: Context): Tokens = withContext(Dispatchers.IO) {
        val rnd = SecureRandom()
        val verifier = b64url(ByteArray(32).also(rnd::nextBytes))
        val challenge = b64url(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()))
        val state = b64url(ByteArray(16).also(rnd::nextBytes))

        val server = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
        val redirectUri = "http://127.0.0.1:${server.localPort}"
        try {
            val url = Uri.parse(AUTH_URL).buildUpon()
                .appendQueryParameter("client_id", BuildConfig.GOOGLE_CLIENT_ID)
                .appendQueryParameter("redirect_uri", redirectUri)
                .appendQueryParameter("response_type", "code")
                .appendQueryParameter("scope", "$DRIVE_SCOPE openid email")
                .appendQueryParameter("code_challenge", challenge)
                .appendQueryParameter("code_challenge_method", "S256")
                .appendQueryParameter("state", state)
                .appendQueryParameter("access_type", "offline")
                .appendQueryParameter("prompt", "consent")
                .build()
            withContext(Dispatchers.Main) {
                CustomTabsIntent.Builder().build().launchUrl(context, url)
            }

            val code = waitForCode(server, state)
            // Android 15 (e MIUI/HyperOS) cortam a rede de apps em segundo plano: com o
            // navegador na frente, a troca do código falharia ("No address associated
            // with hostname"). Espera o app voltar para a frente antes de chamar o Google.
            awaitForeground()
            val body = FormBody.Builder()
                .add("code", code)
                .add("client_id", BuildConfig.GOOGLE_CLIENT_ID)
                .add("client_secret", BuildConfig.GOOGLE_CLIENT_SECRET)
                .add("redirect_uri", redirectUri)
                .add("grant_type", "authorization_code")
                .add("code_verifier", verifier)
                .build()
            val tokens = withNetworkRetry { postJson(Request.Builder().url(TOKEN_URL).post(body).build()) }
            val refresh = tokens.optString("refresh_token")
            if (refresh.isEmpty()) throw Exception(str(R.string.o_google_nao_devolveu_um_refresh))
            // Sem revogar: o grant é do mesmo OAuth client do PC
            if (DRIVE_SCOPE !in tokens.optString("scope").split(" ")) throw Exception(NO_DRIVE_PERMISSION)
            val access = tokens.getString("access_token")
            val email = try {
                http.newCall(Request.Builder().url(USERINFO_URL).header("Authorization", "Bearer $access").build())
                    .execute().use { JSONObject(it.body!!.string()).optString("email") }
            } catch (_: Exception) { "" }
            Tokens(refresh, access, System.currentTimeMillis() + tokens.optLong("expires_in", 3600) * 1000, email)
        } finally {
            server.close()
        }
    }

    /** Suspende até o app estar visível (no máximo 5 min). */
    private suspend fun awaitForeground() {
        withContext(Dispatchers.Main) {
            val lc = ProcessLifecycleOwner.get().lifecycle
            if (!lc.currentState.isAtLeast(Lifecycle.State.STARTED)) {
                withTimeoutOrNull(5 * 60 * 1000L) {
                    suspendCancellableCoroutine { cont ->
                        val obs = object : DefaultLifecycleObserver {
                            override fun onStart(owner: LifecycleOwner) {
                                lc.removeObserver(this)
                                if (cont.isActive) cont.resume(Unit)
                            }
                        }
                        lc.addObserver(obs)
                        cont.invokeOnCancellation { lc.removeObserver(obs) }
                    }
                }
            }
        }
        delay(300) // a regra de firewall do sistema leva um instante para liberar
    }

    /** Repete chamadas que falham por rede ainda bloqueada/instável (DNS, conexão). */
    suspend fun <T> withNetworkRetry(block: () -> T): T {
        var ultimo: Exception? = null
        repeat(5) { tentativa ->
            try {
                return block()
            } catch (e: java.io.IOException) {
                ultimo = e
                delay(700L * (tentativa + 1))
            }
        }
        throw Exception(str(R.string.sem_conexao_com_o_google_confira, ultimo?.message))
    }

    /** Aceita conexões no loopback até chegar o redirecionamento do Google (5 min). */
    private suspend fun waitForCode(server: ServerSocket, state: String): String = suspendCancellableCoroutine { cont ->
        cont.invokeOnCancellation { try { server.close() } catch (_: Exception) {} }
        Thread {
            val limite = System.currentTimeMillis() + 5 * 60 * 1000
            try {
                while (System.currentTimeMillis() < limite) {
                    server.soTimeout = 1000
                    val sock = try { server.accept() } catch (_: SocketTimeoutException) { continue }
                    sock.use { s ->
                        s.soTimeout = 5000
                        val line = s.getInputStream().bufferedReader().readLine() ?: return@use
                        val path = line.split(" ").getOrNull(1) ?: return@use
                        val uri = Uri.parse("http://127.0.0.1$path")
                        val code = uri.getQueryParameter("code")
                        val error = uri.getQueryParameter("error")
                        val ok = uri.getQueryParameter("state") == state && (code != null || error != null)
                        val html = if (ok && code != null) PAGE_OK else PAGE_ERROR
                        val bytes = html.toByteArray()
                        s.getOutputStream().write(("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n" +
                            "Content-Length: ${bytes.size}\r\nConnection: close\r\n\r\n").toByteArray() + bytes)
                        s.getOutputStream().flush()
                        if (!ok) return@use
                        if (cont.isActive) {
                            if (code != null) cont.resume(code)
                            else cont.resumeWithException(Exception(if (error == "access_denied") str(R.string.login_cancelado) else str(R.string.erro_do_google, error)))
                        }
                        return@Thread
                    }
                }
                if (cont.isActive) cont.resumeWithException(Exception(str(R.string.tempo_esgotado_esperando_o_login_do)))
            } catch (e: Exception) {
                if (cont.isActive) cont.resumeWithException(Exception(str(R.string.login_com_google_interrompido)))
            }
        }.start()
    }

    fun postJson(req: Request): JSONObject = http.newCall(req).execute().use { res ->
        val o = try { JSONObject(res.body?.string() ?: "{}") } catch (_: Exception) { JSONObject() }
        if (!res.isSuccessful) {
            throw AuthException(o.optString("error_description").ifBlank { o.optString("error").ifBlank { "HTTP ${res.code}" } }, o.optString("error"))
        }
        o
    }

    class AuthException(message: String, val code: String) : Exception(message)

    fun revoke(token: String) {
        try {
            http.newCall(Request.Builder().url("$REVOKE_URL?token=${Uri.encode(token)}").post(FormBody.Builder().build()).build()).execute().close()
        } catch (_: Exception) {}
    }

    private fun page(titulo: String, texto: String, botao: String, redirecionar: Boolean): String {
        val esc = { t: String -> t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;") }
        return """<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>MySecrets</title><body style="font-family:system-ui;text-align:center;padding:3rem 1rem">
<h2>${esc(titulo)}</h2><p>${esc(texto)}</p>
<p><a href="mysecrets://oauth-done" style="display:inline-block;padding:12px 20px;background:#6d4ae0;color:#fff;border-radius:10px;text-decoration:none">${esc(botao)}</a></p>""" +
            (if (redirecionar) "<script>setTimeout(function(){location.href='mysecrets://oauth-done'},300)</script>" else "") + "</body>"
    }

    private val PAGE_OK: String
        get() = page(str(R.string.oauth_ok_titulo), str(R.string.oauth_ok_texto), str(R.string.oauth_voltar), true)
    private val PAGE_ERROR: String
        get() = page(str(R.string.oauth_erro_titulo), str(R.string.oauth_erro_texto), str(R.string.oauth_voltar), false)
}
