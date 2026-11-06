package com.mysecrets.app.link

import com.mysecrets.app.R
import com.mysecrets.app.str
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
import java.net.Inet6Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.Collections
import java.util.concurrent.Semaphore

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
            event(str(R.string.nao_foi_possivel_escutar_na_porta, LinkProtocol.PORT, e.message))
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

    // Conexões atendidas ao mesmo tempo: um PC usa uma; o limite evita que uma
    // enxurrada de conexões crie threads sem fim.
    private val slots = Semaphore(8)

    private fun acceptLoop(s: ServerSocket) {
        while (!s.isClosed) {
            val sock = try { s.accept() } catch (_: Exception) { break }
            // O PC está na mesma rede local. Conexão de fora (dados móveis, IPv6
            // público) é fechada sem ler nada.
            if (!isLocalNetwork(sock.inetAddress) || !slots.tryAcquire()) {
                try { sock.close() } catch (_: Exception) {}
                continue
            }
            Thread({
                try { handle(sock) } finally { slots.release() }
            }, "mysecrets-link-conn").apply { isDaemon = true; start() }
        }
    }

    /** Endereço de rede local: privado (RFC 1918), link-local, loopback ou IPv6 ULA (fc00::/7). */
    internal fun isLocalNetwork(a: InetAddress?): Boolean {
        if (a == null) return false
        if (a.isLoopbackAddress || a.isLinkLocalAddress || a.isSiteLocalAddress) return true
        if (a is Inet6Address) {
            val b = a.address
            // IPv4 mapeado em IPv6 (::ffff:192.168.0.10)
            if (b.size == 16 && (0..9).all { b[it].toInt() == 0 } && b[10].toInt() == -1 && b[11].toInt() == -1) {
                return isLocalNetwork(InetAddress.getByAddress(b.copyOfRange(12, 16)))
            }
            return (b[0].toInt() and 0xfe) == 0xfc
        }
        return false
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
                    event(str(R.string.diag_qr_nao_lido, hello.optString("name").ifBlank { de }, de, pairId.take(6),
                        Pairings.list.value.joinToString { it.pairId.take(6) }.ifBlank { str(R.string.diag_nenhum) }))
                    send(sock, LinkProtocol.error(str(R.string.este_celular_nao_leu_o_qr)))
                    return
                }
                val secret = pc.secret()
                val nonce = hello.optString("nonce")
                if (!LinkProtocol.verifyHello(secret, hello)) {
                    event(str(R.string.diag_pedido_recusado, pc.desktopName, de))
                    send(sock, LinkProtocol.error(str(R.string.pedido_invalido_confira_se_o_relogio)))
                    return
                }
                if (!seenNonces.add(nonce)) {
                    send(sock, LinkProtocol.error(str(R.string.pedido_repetido)))
                    return
                }
                event(str(R.string.diag_pedido, hello.optString("op"), pc.desktopName, de))
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
            send(sock, LinkProtocol.error(str(R.string.ja_existe_um_pedido_aguardando_no)))
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
