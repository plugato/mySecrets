package com.mysecrets.app.link

import android.os.Build
import android.util.Log
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.Collections

/**
 * Escuta pedidos do PC na rede local enquanto o app está aberto.
 *  - op "pair": o PC confirma o pareamento recém-lido do QR.
 *  - op "unlock": o PC pede para desbloquear; a tela mostra Aprovar/Negar e a
 *    aprovação exige a digital (ver [ApprovalRequest]).
 * Nada é respondido a quem não prova conhecer o segredo do pareamento.
 */
object LinkServer {
    private const val TAG = "LinkServer"
    private const val APPROVAL_TIMEOUT_MS = 85_000L

    /** Pedido de desbloqueio aguardando o usuário. */
    class ApprovalRequest(val pairId: String, val desktopName: String, val code: String) {
        /** null = negado; senão a K_d liberada pela digital. */
        val answer = CompletableDeferred<ByteArray?>()
    }

    private val _request = MutableStateFlow<ApprovalRequest?>(null)
    val request: StateFlow<ApprovalRequest?> = _request

    /** Último contato de um PC (aparece na tela de pareamento, para diagnóstico). */
    private val _lastEvent = MutableStateFlow<String?>(null)
    val lastEvent: StateFlow<String?> = _lastEvent

    private fun event(msg: String) {
        Log.i(TAG, msg)
        _lastEvent.value = msg
    }

    /** O servidor está escutando? (tela de pareamento) */
    val listening: Boolean get() = server?.isClosed == false

    /** pairId do último PC que confirmou o pareamento (a tela de pareamento escuta). */
    private val _confirmed = MutableStateFlow<String?>(null)
    val confirmed: StateFlow<String?> = _confirmed

    private var server: ServerSocket? = null
    private var thread: Thread? = null
    private val seenNonces = Collections.synchronizedSet(LinkedHashSet<String>())

    val phoneName: String get() = (Build.MANUFACTURER.replaceFirstChar { it.uppercase() } + " " + Build.MODEL).trim()

    @Synchronized
    fun start() {
        if (server != null) return
        try {
            val s = ServerSocket()
            s.reuseAddress = true
            s.bind(InetSocketAddress(LinkProtocol.PORT))
            server = s
            thread = Thread({ acceptLoop(s) }, "mysecrets-link").apply { isDaemon = true; start() }
            Log.i(TAG, "Escutando na porta ${LinkProtocol.PORT}")
        } catch (e: Exception) {
            event("Não foi possível escutar na porta ${LinkProtocol.PORT}: ${e.message}")
        }
    }

    @Synchronized
    fun stop() {
        try { server?.close() } catch (_: Exception) {}
        server = null
        thread = null
        _request.value?.answer?.complete(null)
        _request.value = null
    }

    private fun acceptLoop(s: ServerSocket) {
        while (!s.isClosed) {
            val sock = try { s.accept() } catch (_: Exception) { break }
            Thread({ handle(sock) }, "mysecrets-link-conn").apply { isDaemon = true; start() }
        }
    }

    private fun send(sock: Socket, o: JSONObject) {
        sock.getOutputStream().write((o.toString() + "\n").toByteArray(Charsets.UTF_8))
        sock.getOutputStream().flush()
    }

    private fun readLine(reader: BufferedReader): String? {
        val sb = StringBuilder()
        while (true) {
            val c = reader.read()
            if (c < 0) return if (sb.isEmpty()) null else sb.toString()
            if (c == '\n'.code) return sb.toString()
            sb.append(c.toChar())
            if (sb.length > 16 * 1024) return null
        }
    }

    private fun handle(sock: Socket) {
        sock.use {
            try {
                sock.soTimeout = 8000
                val reader = BufferedReader(InputStreamReader(sock.getInputStream(), Charsets.UTF_8))
                val line = readLine(reader) ?: return
                val hello = try { JSONObject(line) } catch (_: Exception) { return }
                val de = sock.inetAddress?.hostAddress ?: "?"
                val pairId = hello.optString("pair")
                val pc = Pairings.find(pairId)
                if (pc == null) {
                    event("PC ${hello.optString("name").ifBlank { de }} ($de) chamou com um QR que este celular não leu " +
                        "(código ${pairId.take(6)}; lidos: ${Pairings.list.value.joinToString { it.pairId.take(6) }.ifBlank { "nenhum" }})")
                    send(sock, LinkProtocol.error("Este celular não leu o QR code que está na tela do PC agora. Leia o QR de novo."))
                    return
                }
                val secret = pc.secret()
                val nonce = hello.optString("nonce")
                if (!LinkProtocol.verifyHello(secret, hello)) {
                    event("Pedido de ${pc.desktopName} ($de) recusado: assinatura ou horário inválido")
                    send(sock, LinkProtocol.error("Pedido inválido (confira se o relógio do PC e do celular estão certos)"))
                    return
                }
                if (!seenNonces.add(nonce)) {
                    send(sock, LinkProtocol.error("Pedido repetido"))
                    return
                }
                event("Pedido \"${hello.optString("op")}\" de ${pc.desktopName} ($de)")
                if (seenNonces.size > 500) synchronized(seenNonces) { seenNonces.remove(seenNonces.first()) }

                when (hello.optString("op")) {
                    "pair" -> {
                        send(sock, LinkProtocol.reply("paired", secret, nonce, phoneName))
                        Pairings.markConfirmed(pc.pairId)
                        _confirmed.value = pc.pairId
                    }
                    "unlock" -> handleUnlock(sock, reader, pc, secret, nonce, hello.optString("name").ifBlank { pc.desktopName })
                }
            } catch (e: Exception) {
                Log.w(TAG, "Conexão encerrada: ${e.message}")
            }
        }
    }

    private fun handleUnlock(sock: Socket, reader: BufferedReader, pc: Pairings.Pc, secret: ByteArray, nonce: String, desktopName: String) {
        if (_request.value != null) {
            send(sock, LinkProtocol.error("Já existe um pedido aguardando no celular"))
            return
        }
        send(sock, LinkProtocol.reply("pending", secret, nonce, phoneName))
        val req = ApprovalRequest(pc.pairId, desktopName, LinkProtocol.verificationCode(secret, nonce))
        _request.value = req

        // Se o PC desistir (cancelar/fechar), a conexão cai: some o pedido da tela
        val watcher = Thread {
            try {
                sock.soTimeout = 0
                while (!req.answer.isCompleted) {
                    if (sock.getInputStream().read() < 0) { req.answer.complete(null); break }
                }
            } catch (_: Exception) {
                req.answer.complete(null)
            }
        }.apply { isDaemon = true; start() }

        try {
            val key = runBlocking { withTimeoutOrNull(APPROVAL_TIMEOUT_MS) { req.answer.await() } }
            if (sock.isClosed) return
            if (key == null) {
                send(sock, LinkProtocol.deny(secret, nonce))
            } else {
                send(sock, LinkProtocol.approval(secret, pc.pairId, nonce, key))
                key.fill(0)
                Pairings.markUsed(pc.pairId)
            }
            sock.soTimeout = 3000
            try { readLine(reader) } catch (_: SocketTimeoutException) {}
        } catch (_: Exception) {
        } finally {
            req.answer.complete(null)
            watcher.interrupt()
            if (_request.value === req) _request.value = null
        }
    }

    fun clearConfirmed() { _confirmed.value = null }
}
