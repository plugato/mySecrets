package com.mysecrets.app.link

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.content.edit
import androidx.core.net.toUri
import com.mysecrets.app.R
import com.mysecrets.app.str
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.Date

/**
 * Pedidos do PC pela internet (relay; ver docs/developer/RELAY.md): busca a
 * caixa postal de cada pareamento, decifra os pedidos, mostra uma notificação
 * por pedido e manda a resposta. Aprovar passa pela [RelayApprovalActivity]
 * (digital libera a K_d); negar e encerrar passam pelo [ApprovalActionReceiver].
 *
 * Também guarda as liberações de leitura por tempo ativas (só ids e a chave
 * PÚBLICA efêmera do PC), para o "Encerrar agora" sobreviver ao fim do processo.
 */
object Relay {
    private const val TAG = "MySecretsRelay"
    private const val CHANNEL = "pc-relay"
    private const val CHANNEL_WINDOW = "pc-relay-window"
    private const val ID_REQUEST = 4320
    private const val ID_WINDOW = 4321
    private const val MIN_REFRESH_MS = 10_000L

    enum class Result { OK, GONE, ERROR }

    /** Liberação de leitura por tempo ativa no PC. */
    class Window(val reqId: String, val pairId: String, val epk: String, val desktop: String, val until: Long)

    private val _requests = MutableStateFlow<List<RelayProtocol.Request>>(emptyList())
    /** Pedidos abertos (de todos os pareamentos), do mais antigo ao mais novo. */
    val requests: StateFlow<List<RelayProtocol.Request>> = _requests

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val lock = Any()
    @Volatile private var lastRefresh = 0L
    /** Respondidos há pouco: uma busca em andamento não os traz de volta. */
    private val done = java.util.Collections.synchronizedSet(LinkedHashSet<String>())

    private fun markDone(reqId: String) {
        done.add(reqId)
        if (done.size > 64) synchronized(done) { done.remove(done.first()) }
    }

    fun find(reqId: String): RelayProtocol.Request? = _requests.value.firstOrNull { it.reqId == reqId }

    private fun tagOf(pairId: String, reqId: String) = "relay:$pairId:$reqId"
    private fun windowTag(reqId: String) = "relay-window:$reqId"

    // ===== Buscar =====

    /**
     * Busca a caixa postal de [pairId] (ou de todos os pareamentos) e atualiza as
     * notificações. Bloqueante (rede): chamar fora da thread principal.
     * Devolve false se alguma caixa postal não respondeu.
     */
    fun fetch(context: Context, pairId: String? = null): Boolean {
        val ctx = context.applicationContext
        val pcs = Pairings.list.value.filter { pairId == null || it.pairId == pairId }
        var ok = true
        for (pc in pcs) {
            val fresh = try {
                val secret = pc.secret()
                RelayClient.list(RelayProtocol.channelId(secret)).filter { it.reqId !in done }.mapNotNull { item ->
                    // Item que não abre (outro pareamento, adulterado, vencido): ignora em silêncio
                    try { RelayProtocol.openRequest(secret, pc.pairId, item.reqId, item.box) } catch (_: Exception) { null }
                }
            } catch (e: Exception) {
                Log.w(TAG, "caixa postal de ${pc.desktopName} indisponível: ${e.javaClass.simpleName}")
                ok = false
                continue
            }
            synchronized(lock) {
                _requests.value = (_requests.value.filter { it.pairId != pc.pairId } + fresh).sortedBy { it.ts }
            }
            show(ctx, pc.pairId, fresh)
        }
        return ok
    }

    /** Busca em segundo plano (app aberto), no máximo a cada alguns segundos. */
    fun refreshAsync(context: Context) {
        if (Pairings.list.value.isEmpty()) return
        val now = System.currentTimeMillis()
        if (now - lastRefresh < MIN_REFRESH_MS) return
        lastRefresh = now
        val ctx = context.applicationContext
        scope.launch { fetch(ctx) }
    }

    // ===== Responder =====

    /**
     * Manda a resposta ao PC. [kd] só em "approve" (liberada pela digital).
     * OK/GONE tiram o pedido da lista e a notificação. Bloqueante (rede).
     */
    fun answer(context: Context, r: RelayProtocol.Request, decision: String, mode: String? = null,
               minutes: Int? = null, kd: ByteArray? = null): Result {
        val ctx = context.applicationContext
        val pc = Pairings.find(r.pairId)
        val result = if (pc == null) Result.GONE else try {
            val secret = pc.secret()
            val msg = RelayProtocol.sealAnswer(secret, r.pairId, r.reqId, r.epk, decision, mode, minutes, kd)
            when (RelayClient.answer(RelayProtocol.channelId(secret), r.reqId, msg)) {
                in 200..299 -> Result.OK
                404, 410 -> Result.GONE
                else -> Result.ERROR
            }
        } catch (e: Exception) {
            // Sem rede, chave do PC inválida, Keystore: nada de segredo no log
            Log.w(TAG, "resposta não enviada: ${e.javaClass.simpleName}")
            Result.ERROR
        }
        if (result != Result.ERROR) forget(ctx, r)
        if (result == Result.OK && decision == "approve") {
            Pairings.markUsed(r.pairId)
            if (mode == "window" && minutes != null) startWindow(ctx, r, minutes)
        }
        return result
    }

    private fun forget(ctx: Context, r: RelayProtocol.Request) = dismiss(ctx, r.pairId, r.reqId)

    /** Pedido respondido ou que sumiu (outro aparelho respondeu, venceu): tira a notificação. */
    fun dismiss(context: Context, pairId: String, reqId: String) {
        markDone(reqId)
        synchronized(lock) { _requests.value = _requests.value.filter { it.reqId != reqId } }
        nm(context).cancel(tagOf(pairId, reqId), ID_REQUEST)
    }

    /**
     * Acha o pedido na memória ou, se o processo foi reiniciado, na caixa postal.
     * null = o pedido acabou; [IOException] = a caixa postal não respondeu. Bloqueante.
     */
    fun findOrFetch(context: Context, pairId: String, reqId: String): RelayProtocol.Request? {
        find(reqId)?.let { return it }
        if (!fetch(context, pairId)) throw IOException("caixa postal indisponível")
        return find(reqId)
    }

    // ===== Notificações dos pedidos =====

    private fun nm(ctx: Context) = ctx.getSystemService(NotificationManager::class.java)

    fun channels(ctx: Context) {
        val nm = nm(ctx)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, str(R.string.canal_relay), NotificationManager.IMPORTANCE_HIGH).apply {
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        })
        nm.createNotificationChannel(NotificationChannel(CHANNEL_WINDOW, str(R.string.canal_relay_liberacao), NotificationManager.IMPORTANCE_LOW))
    }

    private fun show(ctx: Context, pairId: String, fresh: List<RelayProtocol.Request>) {
        val nm = nm(ctx)
        channels(ctx)
        val prefix = "relay:$pairId:"
        val active = nm.activeNotifications.mapNotNull { it.tag }.filter { it.startsWith(prefix) }.toSet()
        val wanted = fresh.map { tagOf(pairId, it.reqId) }.toSet()
        // Respondidos (aqui ou em outro aparelho) ou vencidos: some a notificação
        (active - wanted).forEach { nm.cancel(it, ID_REQUEST) }
        // Só os novos: repostar acenderia a tela de novo
        fresh.filter { tagOf(pairId, it.reqId) !in active }.forEach { nm.notify(tagOf(pairId, it.reqId), ID_REQUEST, build(ctx, it)) }
    }

    /** Intent da tela de aprovação. [mode] null = escolher (leitura) ou direto à digital. */
    fun approveIntent(ctx: Context, r: RelayProtocol.Request, mode: String?): Intent =
        Intent(ctx, RelayApprovalActivity::class.java)
            // data distinta por pedido e botão: cada PendingIntent fica separado
            .setData("mysecrets-relay://${r.pairId}/${r.reqId}/${mode ?: "ask"}".toUri())
            .putExtra(RelayApprovalActivity.EXTRA_PAIR, r.pairId)
            .putExtra(RelayApprovalActivity.EXTRA_REQ, r.reqId)
            .putExtra(RelayApprovalActivity.EXTRA_MODE, mode)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    private fun denyIntent(ctx: Context, r: RelayProtocol.Request): PendingIntent =
        PendingIntent.getBroadcast(ctx, 0,
            Intent(ctx, ApprovalActionReceiver::class.java)
                .setAction(ApprovalActionReceiver.ACTION_RELAY_DENY)
                .setData("mysecrets-relay://${r.pairId}/${r.reqId}/deny".toUri())
                .putExtra(RelayApprovalActivity.EXTRA_PAIR, r.pairId)
                .putExtra(RelayApprovalActivity.EXTRA_REQ, r.reqId),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    private fun activityIntent(ctx: Context, r: RelayProtocol.Request, mode: String?): PendingIntent =
        PendingIntent.getActivity(ctx, 0, approveIntent(ctx, r, mode),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    /** Título curto da notificação / tela. */
    fun title(r: RelayProtocol.Request): String = when (r.kind) {
        "write" -> str(R.string.relay_titulo_gravar, r.desktop)
        "read" -> str(R.string.relay_titulo_ler, r.desktop)
        else -> str(R.string.desbloquear_pc_nome, r.desktop)
    }

    /** Frase principal: quem quer o quê, em qual PC. */
    fun headline(r: RelayProtocol.Request): String {
        val s = r.summary
        return when (r.kind) {
            "write" -> str(R.string.relay_quer_gravar, r.client, s.optString("target").ifBlank { "?" }, r.desktop)
            "read" -> {
                val what = s.optString("query").ifBlank { s.optString("id") }.ifBlank { s.optString("attachment") }
                val tool = s.optString("tool").ifBlank { "?" }
                if (what.isBlank()) str(R.string.relay_quer_ler_sem_alvo, r.client, tool, r.desktop)
                else str(R.string.relay_quer_ler, r.client, what, tool, r.desktop)
            }
            else -> str(R.string.quer_abrir_o_mysecrets, r.desktop)
        }
    }

    /** Linhas de detalhe (campos, arquivos, código, outros pedidos esperando). */
    fun details(r: RelayProtocol.Request): List<String> {
        val lines = mutableListOf<String>()
        when (r.kind) {
            "write" -> lines += writeDetails(r.summary)
            "read" -> lines += if (r.allowWindow) str(R.string.relay_ler_explica, r.windowMinutes) else str(R.string.relay_ler_explica_so_esta)
            else -> lines += str(R.string.codigo_toque_para_aprovar, r.code ?: "")
        }
        val more = r.pending - 1
        if (more == 1) lines += str(R.string.relay_mais_um_pedido)
        if (more > 1) lines += str(R.string.relay_mais_n_pedidos, more)
        return lines
    }

    /**
     * O que vai ser gravado, linha a linha. Valores só do que não é segredo
     * (usuário, URL, tipo de token, campos extras de texto); senha, token,
     * notas e campos extras de senha aparecem só com o tamanho. PC 2.4.0 manda
     * só os nomes ("fields"): aí sai a linha antiga "Campos: ...".
     */
    fun writeDetails(s: JSONObject): List<String> {
        val lines = mutableListOf<String>()
        val tipo = when (s.optString("type")) {
            "login" -> str(R.string.relay_tipo_login)
            "token" -> str(R.string.relay_tipo_token)
            "note" -> str(R.string.relay_tipo_nota)
            else -> ""
        }
        val projeto = s.optString("project")
        if (tipo.isNotBlank()) lines += if (projeto.isNotBlank()) str(R.string.relay_tipo_projeto, tipo, projeto) else str(R.string.relay_tipo, tipo)
        val tags = names(s.optJSONArray("tags")).filter { it != projeto }
        if (tags.isNotEmpty()) lines += str(R.string.relay_tags, tags.joinToString(", "))

        val values = s.optJSONObject("values")
        val lengths = s.optJSONObject("lengths")
        val fields = names(s.optJSONArray("fields"))
        if (values == null && lengths == null) {
            val todos = fields.map(::fieldLabel) + names(s.optJSONArray("customFields"))
            if (todos.isNotEmpty()) lines += str(R.string.relay_campos, todos.joinToString(", "))
        } else {
            fields.forEach { k ->
                val rotulo = fieldLabel(k).replaceFirstChar { it.uppercase() }
                when {
                    values?.has(k) == true -> {
                        val v = values.optString(k)
                        lines += if (v.isBlank()) str(R.string.relay_campo_vazio, rotulo) else str(R.string.relay_campo_valor, rotulo, v)
                    }
                    lengths?.has(k) == true -> {
                        val n = lengths.optInt(k)
                        lines += if (n == 0) str(R.string.relay_campo_vazio, rotulo) else str(R.string.relay_campo_tamanho, rotulo, n)
                    }
                }
            }
            val custom = s.optJSONArray("custom")
            if (custom != null) {
                for (i in 0 until custom.length()) {
                    val c = custom.optJSONObject(i) ?: continue
                    val nome = c.optString("name")
                    if (nome.isBlank()) continue
                    lines += if (c.optBoolean("secret")) str(R.string.relay_campo_tamanho, nome, c.optInt("length"))
                    else str(R.string.relay_campo_valor, nome, c.optString("value"))
                }
            }
        }

        val files = s.optJSONArray("files")
        if (files != null) {
            for (i in 0 until files.length()) {
                val f = files.optJSONObject(i) ?: continue
                lines += str(R.string.relay_arquivo, f.optString("name"), tamanho(f.optLong("size")))
            }
        }
        lines += str(R.string.relay_cria_ou_atualiza)
        return lines
    }

    private fun tamanho(b: Long): String = when {
        b < 1024 -> "$b B"
        b < 1024 * 1024 -> String.format(java.util.Locale.getDefault(), "%.1f KB", b / 1024.0)
        else -> String.format(java.util.Locale.getDefault(), "%.2f MB", b / (1024.0 * 1024.0))
    }

    private fun names(a: JSONArray?): List<String> =
        if (a == null) emptyList() else (0 until a.length()).map { a.optString(it) }.filter { it.isNotBlank() }

    /** Nomes dos campos padrão no idioma do app; os demais como vieram. */
    private fun fieldLabel(name: String): String = when (name) {
        "password" -> str(R.string.senha).lowercase()
        "username" -> str(R.string.usuario).lowercase()
        "notes" -> str(R.string.notas).lowercase()
        "url" -> str(R.string.site).lowercase()
        "token" -> str(R.string.relay_campo_token).lowercase()
        "tokenType" -> str(R.string.tipo_do_token).lowercase()
        else -> name
    }

    private fun build(ctx: Context, r: RelayProtocol.Request): Notification {
        val ask = activityIntent(ctx, r, null)
        val text = headline(r)
        val big = (listOf(text) + details(r)).joinToString("\n")
        val b = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setContentTitle(title(r))
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(big))
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            // Tela bloqueada: só o resumo (os detalhes podem ter usuário e URL)
            .setVisibility(if (r.kind == "write") NotificationCompat.VISIBILITY_PRIVATE else NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(ask)
            .setFullScreenIntent(ask, true)
            .setOnlyAlertOnce(true)
            // Fica até o pedido terminar: cancelar a digital não perde o pedido
            .setOngoing(true)
            .setTimeoutAfter((r.expiresAt - System.currentTimeMillis()).coerceIn(5_000, 31 * 60_000L))
        if (r.kind == "write") {
            b.setPublicVersion(NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_lock_lock)
                .setContentTitle(title(r))
                .setContentText(str(R.string.relay_publico_gravar, r.desktop))
                .build())
        }
        if (r.kind == "read") {
            b.addAction(0, str(R.string.relay_liberar_so_esta), activityIntent(ctx, r, "once"))
            if (r.allowWindow) b.addAction(0, str(R.string.relay_liberar_por, r.windowMinutes), activityIntent(ctx, r, "window"))
        } else {
            b.addAction(0, str(R.string.aprovar), activityIntent(ctx, r, "approve"))
        }
        b.addAction(0, str(R.string.negar), denyIntent(ctx, r))
        return b.build()
    }

    // ===== Liberação de leitura por tempo =====

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences("relay", Context.MODE_PRIVATE)

    private fun loadWindows(ctx: Context): List<Window> = try {
        val arr = JSONArray(prefs(ctx).getString("windows", "[]"))
        val now = System.currentTimeMillis()
        (0 until arr.length()).map { arr.getJSONObject(it) }
            .map { Window(it.getString("reqId"), it.getString("pairId"), it.getString("epk"), it.optString("desktop"), it.getLong("until")) }
            .filter { it.until > now }
    } catch (_: Exception) { emptyList() }

    private fun saveWindows(ctx: Context, list: List<Window>) {
        val arr = JSONArray()
        list.forEach {
            arr.put(JSONObject().put("reqId", it.reqId).put("pairId", it.pairId).put("epk", it.epk)
                .put("desktop", it.desktop).put("until", it.until))
        }
        prefs(ctx).edit { putString("windows", arr.toString()) }
    }

    private fun startWindow(ctx: Context, r: RelayProtocol.Request, minutes: Int) {
        val w = Window(r.reqId, r.pairId, r.epk, r.desktop, System.currentTimeMillis() + minutes * 60_000L)
        synchronized(lock) { saveWindows(ctx, loadWindows(ctx).filter { it.reqId != w.reqId } + w) }
        channels(ctx)
        val end = PendingIntent.getBroadcast(ctx, 0,
            Intent(ctx, ApprovalActionReceiver::class.java)
                .setAction(ApprovalActionReceiver.ACTION_RELAY_END)
                .setData("mysecrets-relay://${w.pairId}/${w.reqId}/end".toUri())
                .putExtra(RelayApprovalActivity.EXTRA_REQ, w.reqId),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val hora = android.text.format.DateFormat.getTimeFormat(ctx).format(Date(w.until))
        val n = NotificationCompat.Builder(ctx, CHANNEL_WINDOW)
            .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
            .setContentTitle(str(R.string.relay_liberada_ate, w.desktop, hora))
            .setContentText(str(R.string.relay_liberada_texto))
            .setStyle(NotificationCompat.BigTextStyle().bigText(str(R.string.relay_liberada_texto)))
            .setWhen(w.until)
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setChronometerCountDown(true)
            .setOngoing(true)
            .setTimeoutAfter(w.until - System.currentTimeMillis())
            .addAction(0, str(R.string.relay_encerrar_agora), end)
            .build()
        nm(ctx).notify(windowTag(w.reqId), ID_WINDOW, n)
    }

    /**
     * "Encerrar agora": manda "end" à escuta "e" + reqId que o PC deixou na caixa
     * postal, cifrado para a epk do pedido original. Bloqueante (rede).
     */
    fun endWindow(context: Context, reqId: String): Result {
        val ctx = context.applicationContext
        val w = loadWindows(ctx).firstOrNull { it.reqId == reqId }
        val pc = w?.let { Pairings.find(it.pairId) }
        val result = if (w == null || pc == null) Result.GONE else try {
            val secret = pc.secret()
            val id = RelayProtocol.endId(w.reqId)
            val msg = RelayProtocol.sealAnswer(secret, w.pairId, id, w.epk, "end")
            when (RelayClient.answer(RelayProtocol.channelId(secret), id, msg)) {
                in 200..299 -> Result.OK
                404, 410 -> Result.GONE // o PC já encerrou (ou venceu)
                else -> Result.ERROR
            }
        } catch (e: Exception) {
            Log.w(TAG, "fim da liberação não enviado: ${e.javaClass.simpleName}")
            Result.ERROR
        }
        if (result != Result.ERROR) {
            synchronized(lock) { saveWindows(ctx, loadWindows(ctx).filter { it.reqId != reqId }) }
            nm(ctx).cancel(windowTag(reqId), ID_WINDOW)
        }
        return result
    }

    /** Aviso curto de qualquer thread (receptor, rede). */
    fun toast(context: Context, msg: String) {
        val ctx = context.applicationContext
        Handler(Looper.getMainLooper()).post { Toast.makeText(ctx, msg, Toast.LENGTH_SHORT).show() }
    }
}
