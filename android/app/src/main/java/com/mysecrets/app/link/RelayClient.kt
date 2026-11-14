package com.mysecrets.app.link

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Caixa postal do relay no site (Worker): o celular lista os pedidos do canal e
 * publica a resposta. Chamadas bloqueantes: usar fora da thread principal.
 * O Worker só vê o canal (opaco) e dados cifrados.
 */
object RelayClient {
    const val BASE = "https://mysecrets.ancalagon.com.br/relay"

    class Item(val reqId: String, val box: String)

    private val http by lazy {
        OkHttpClient.Builder()
            .connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(8, TimeUnit.SECONDS)
            .callTimeout(10, TimeUnit.SECONDS)
            .build()
    }

    private fun url(channel: String, vararg path: String): HttpUrl =
        BASE.toHttpUrl().newBuilder().addPathSegment(channel).apply { path.forEach { addPathSegment(it) } }.build()

    /** Pedidos sem resposta no canal. Lança [IOException] se não conseguir falar com o site. */
    fun list(channel: String): List<Item> {
        http.newCall(Request.Builder().url(url(channel)).get().build()).execute().use { r ->
            if (r.code == 204 || r.code == 404) return emptyList()
            if (r.code != 200) throw IOException("relay HTTP ${r.code}")
            val arr = JSONObject(r.body?.string().orEmpty()).optJSONArray("items") ?: return emptyList()
            return (0 until arr.length()).mapNotNull { i ->
                val o = arr.optJSONObject(i) ?: return@mapNotNull null
                val id = o.optString("reqId")
                val box = o.optString("box")
                if (id.isBlank() || box.isBlank()) null else Item(id, box)
            }
        }
    }

    /**
     * Publica a resposta `{ epk, box }` do pedido [id]. Devolve o status HTTP
     * (204 = entregue; 410 = o pedido já acabou). Lança [IOException] sem rede.
     */
    fun answer(channel: String, id: String, msg: JSONObject): Int {
        val body = msg.toString().toRequestBody("application/json".toMediaType())
        http.newCall(Request.Builder().url(url(channel, id, "answer")).post(body).build()).execute().use { r ->
            return r.code
        }
    }
}
