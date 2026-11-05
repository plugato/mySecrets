package com.mysecrets.app.autofill

import android.app.assist.AssistStructure
import android.text.InputType
import android.view.View
import android.view.autofill.AutofillId
import org.json.JSONObject
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

    /** Domínio "registrável" aproximado: os dois últimos rótulos (ou três em .com.br etc.). */
    fun baseDomain(host: String): String {
        val p = host.removePrefix("www.").split(".")
        if (p.size <= 2) return p.joinToString(".")
        val segundo = p[p.size - 2]
        val take = if (segundo.length <= 3 && p.last().length == 2) 3 else 2
        return p.takeLast(take).joinToString(".")
    }

    /** 0 = não serve; maior = melhor. */
    fun score(entry: JSONObject, form: ParsedForm): Int {
        if (entry.has("deletedAt") && !entry.isNull("deletedAt")) return 0
        val type = entry.optString("type", "login")
        if (type != "login") return 0
        val packages = entry.optJSONArray("androidPackages")
        if (packages != null) for (i in 0 until packages.length()) if (packages.optString(i) == form.packageName) return 100
        val host = hostOf(entry.optString("url")) ?: return 0
        val web = form.webDomain?.removePrefix("www.")
        if (web != null) {
            if (web == host) return 90
            if (web.endsWith(".$host") || host.endsWith(".$web")) return 70
            if (baseDomain(web) == baseDomain(host)) return 50
            return 0
        }
        // App nativo: nome do pacote contém o nome do site (com.netflix.mediaclient ↔ netflix.com)
        val label = baseDomain(host).substringBefore('.')
        if (label.length >= 3 && form.packageName.lowercase().split('.').any { it == label }) return 40
        return 0
    }
}
