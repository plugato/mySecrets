package com.mysecrets.app.autofill

import android.app.assist.AssistStructure
import android.text.InputType
import android.view.View
import android.view.autofill.AutofillId
import org.json.JSONObject
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.net.URI

/** O que interessa de uma tela para preencher: campos e de onde ela é. */
class ParsedForm(
    val packageName: String,
    val webDomain: String?,
    val username: AutofillId?,
    val password: AutofillId?,
    val otp: AutofillId?,
    val usernameValue: String?,
    val passwordValue: String?
) {
    val ids: List<AutofillId> get() = listOfNotNull(username, password, otp)
    val isEmpty get() = username == null && password == null && otp == null
}

object Structure {
    private val PASS = Regex("pass|senha|pwd|contrase|mot de passe|kennwort", RegexOption.IGNORE_CASE)
    private val USER = Regex("user|email|e-mail|login|usu[aá]rio|account|conta|cpf|phone|celular|identifier|nome de", RegexOption.IGNORE_CASE)
    private val OTP = Regex("otp|one.?time|2fa|totp|verification|verifica|c[oó]digo|token|mfa|authenticator", RegexOption.IGNORE_CASE)
    private val SKIP = Regex("search|pesquis|busca|captcha|coupon|cupom", RegexOption.IGNORE_CASE)

    private class Field(val id: AutofillId, val kind: String?, val value: String?)

    fun parse(structure: AssistStructure): ParsedForm {
        var webDomain: String? = null
        val fields = mutableListOf<Field>()

        fun visit(n: AssistStructure.ViewNode) {
            if (webDomain == null && !n.webDomain.isNullOrBlank()) webDomain = n.webDomain
            val id = n.autofillId
            if (id != null && n.autofillType == View.AUTOFILL_TYPE_TEXT && n.visibility == View.VISIBLE) {
                fields += Field(id, classify(n), realValue(n))
            }
            for (i in 0 until n.childCount) visit(n.getChildAt(i))
        }
        for (i in 0 until structure.windowNodeCount) visit(structure.getWindowNodeAt(i).rootViewNode)

        val pass = fields.firstOrNull { it.kind == "password" }
        var user = fields.firstOrNull { it.kind == "username" }
        // Sem campo de usuário identificado: o campo de texto logo antes da senha
        if (user == null && pass != null) {
            val idx = fields.indexOf(pass)
            user = fields.subList(0, idx).lastOrNull { it.kind == null }
        }
        val otp = fields.firstOrNull { it.kind == "otp" }
        return ParsedForm(structure.activityComponent.packageName, webDomain?.lowercase(), user?.id, pass?.id, otp?.id, user?.value, pass?.value)
    }

    /** Texto digitado no campo — sem confundir com o placeholder (o modo de compatibilidade às vezes o devolve). */
    private fun realValue(n: AssistStructure.ViewNode): String? {
        val v = n.autofillValue?.takeIf { it.isText }?.textValue?.toString()?.takeIf { it.isNotEmpty() } ?: return null
        val placeholder = n.htmlInfo?.attributes?.firstOrNull { it.first.equals("placeholder", true) }?.second
        if (v == n.hint || v == placeholder) return null
        return v
    }

    private fun classify(n: AssistStructure.ViewNode): String? {
        n.autofillHints?.forEach { h ->
            val hint = h.lowercase()
            when {
                hint.contains("password") -> return if (hint.contains("new")) "password" else "password"
                hint.contains("otp") || hint.contains("one-time") || hint.contains("2fa") || hint.contains("sms") -> return "otp"
                hint.contains("user") || hint.contains("email") || hint.contains("phone") -> return "username"
            }
        }
        val html = n.htmlInfo
        if (html != null) {
            val attrs = html.attributes?.associate { it.first.lowercase() to (it.second ?: "") } ?: emptyMap()
            val type = attrs["type"]?.lowercase()
            val ac = attrs["autocomplete"]?.lowercase() ?: ""
            if (type == "password") return "password"
            if (type == "hidden" || type == "submit" || type == "button" || type == "checkbox" || type == "radio") return "skip"
            if (ac.contains("one-time-code")) return "otp"
            if (ac.contains("username") || ac.contains("email") || type == "email") return "username"
            val text = listOf(attrs["name"], attrs["id"], attrs["placeholder"], attrs["aria-label"]).joinToString(" ")
            if (SKIP.containsMatchIn(text)) return "skip"
            if (OTP.containsMatchIn(text)) return "otp"
            if (USER.containsMatchIn(text)) return "username"
            if (PASS.containsMatchIn(text)) return "password"
        }
        val variation = n.inputType and InputType.TYPE_MASK_VARIATION
        val klass = n.inputType and InputType.TYPE_MASK_CLASS
        if (klass == InputType.TYPE_CLASS_TEXT && (variation == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
                variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD || variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD)) return "password"
        if (klass == InputType.TYPE_CLASS_NUMBER && variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD) return "password"
        if (klass == InputType.TYPE_CLASS_TEXT && (variation == InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS ||
                variation == InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS)) return "username"
        val text = listOfNotNull(n.idEntry, n.hint, n.contentDescription?.toString()).joinToString(" ")
        if (text.isNotBlank()) {
            if (SKIP.containsMatchIn(text)) return "skip"
            if (PASS.containsMatchIn(text)) return "password"
            if (OTP.containsMatchIn(text)) return "otp"
            if (USER.containsMatchIn(text)) return "username"
        }
        return null
    }

    // ===== Qual entrada do cofre serve para esta tela =====

    fun hostOf(url: String): String? {
        val u = url.trim()
        if (u.isEmpty()) return null
        return try {
            URI(if (u.contains("://")) u else "https://$u").host?.lowercase()?.removePrefix("www.")
        } catch (_: Exception) { null }
    }

    /**
     * Domínio registrável pela Public Suffix List (a do OkHttp, já usado pelo
     * app): "a.github.io" e "b.github.io" são sites diferentes; "app.exemplo.com.br"
     * e "exemplo.com.br" são o mesmo. Null para IP, localhost e afins.
     */
    fun registrableDomain(host: String): String? =
        "https://${host.removePrefix("www.")}/".toHttpUrlOrNull()?.topPrivateDomain()

    /**
     * Navegadores cujo webDomain é confiável (é o endereço da aba). Qualquer
     * outro app pode declarar o webDomain que quiser, então nele o login é
     * escolhido pelo pacote, como num app nativo.
     */
    val BROWSERS = setOf(
        "com.android.chrome", "com.chrome.beta", "com.chrome.dev", "com.chrome.canary", "org.chromium.chrome",
        "org.mozilla.firefox", "org.mozilla.firefox_beta", "org.mozilla.fenix", "org.mozilla.focus", "org.mozilla.fennec_fdroid",
        "org.mozilla.klar", "us.spotco.fennec_dos", "io.github.forkmaintainers.iceraven",
        "com.brave.browser", "com.brave.browser_beta", "com.microsoft.emmx", "com.microsoft.emmx.beta",
        "com.sec.android.app.sbrowser", "com.sec.android.app.sbrowser.beta",
        "com.opera.browser", "com.opera.browser.beta", "com.opera.mini.native", "com.opera.gx",
        "com.duckduckgo.mobile.android", "com.vivaldi.browser", "com.kiwibrowser.browser", "com.ecosia.android",
        "com.mi.globalbrowser", "com.android.browser", "app.vanadium.browser", "com.yandex.browser",
        "com.cloudmosa.puffin", "mark.via.gp", "com.UCMobile.intl"
    )

    /** Pontuação de app nativo confirmado pelo site (Digital Asset Links). */
    const val APP_VERIFIED = 60
    /** App nativo só pelo nome do pacote: precisa de confirmação antes de preencher. */
    const val APP_UNVERIFIED = 40

    /** O pacote parece ser do site (domínio invertido): netflix.com ↔ com.netflix.mediaclient. */
    fun packageLooksLike(host: String, pkg: String): Boolean {
        val site = registrableDomain(host) ?: return false
        val invertido = site.split('.').reversed().joinToString(".")
        val p = pkg.lowercase()
        return p == invertido || p.startsWith("$invertido.")
    }

    /**
     * 0 = não serve; maior = melhor. [links] diz o que o site respondeu no
     * assetlinks.json para este app (padrão: ainda não se sabe).
     */
    fun score(entry: JSONObject, form: ParsedForm, links: (String) -> AssetLinks.Status = { AssetLinks.Status.UNKNOWN }): Int {
        if (entry.has("deletedAt") && !entry.isNull("deletedAt")) return 0
        val type = entry.optString("type", "login")
        if (type != "login") return 0
        val packages = entry.optJSONArray("androidPackages")
        if (packages != null) for (i in 0 until packages.length()) if (packages.optString(i) == form.packageName) return 100
        val host = hostOf(entry.optString("url")) ?: return 0
        val web = form.webDomain?.lowercase()?.removePrefix("www.")?.trimEnd('.')
        if (web != null && form.packageName in BROWSERS) {
            if (web == host) return 90
            val site = registrableDomain(web)
            if (site == null || site != registrableDomain(host)) return 0
            return if (web.endsWith(".$host") || host.endsWith(".$web")) 70 else 50
        }
        // App nativo: o pacote começa pelo domínio invertido
        // (netflix.com ↔ com.netflix.mediaclient). "com.evil.netflix" não serve.
        // O nome do pacote não prova nada; o site confirma (ou nega) pelo assetlinks.json.
        if (!packageLooksLike(host, form.packageName)) return 0
        return when (links(host)) {
            AssetLinks.Status.VERIFIED -> APP_VERIFIED
            AssetLinks.Status.DENIED -> 0
            AssetLinks.Status.UNKNOWN -> APP_UNVERIFIED
        }
    }
}
