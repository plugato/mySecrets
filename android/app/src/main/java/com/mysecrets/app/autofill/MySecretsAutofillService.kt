package com.mysecrets.app.autofill

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.app.slice.Slice
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.Dataset
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.InlinePresentation
import android.service.autofill.SaveCallback
import android.service.autofill.SaveInfo
import android.service.autofill.SaveRequest
import android.view.autofill.AutofillId
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import android.widget.inline.InlinePresentationSpec
import androidx.annotation.RequiresApi
import androidx.autofill.inline.v1.InlineSuggestionUi
import com.mysecrets.app.R
import com.mysecrets.app.otp.Otp
import com.mysecrets.app.vault.Vault
import org.json.JSONObject

/**
 * Preenchimento automático no Android inteiro (apps e navegadores) — faz no
 * celular o que a extensão faz no navegador do PC: sugerir logins do site/app,
 * preencher usuário, senha e código MFA, e oferecer salvar logins novos.
 */
class MySecretsAutofillService : AutofillService() {

    override fun onFillRequest(request: FillRequest, cancellationSignal: CancellationSignal, callback: FillCallback) {
        val structure = request.fillContexts.lastOrNull()?.structure ?: return callback.onSuccess(null)
        val form = Structure.parse(structure)
        if (form.isEmpty || form.packageName == packageName) return callback.onSuccess(null)

        val inline = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) request.inlineSuggestionsRequest else null
        val specs = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) inline?.inlinePresentationSpecs ?: emptyList() else emptyList()
        val maxInline = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) inline?.maxSuggestionCount ?: 0 else 0

        val response = FillResponse.Builder()
        if (!Vault.isUnlocked) {
            // Cofre bloqueado: um item "Desbloquear o MySecrets" que abre a digital
            val sender = AutofillActivity.intentSender(this, AutofillActivity.MODE_UNLOCK, form, request.id)
            val p = presentation(this, getString(R.string.autofill_unlock), form.webDomain ?: appLabel(form.packageName))
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && specs.isNotEmpty()) {
                inlinePresentation(this, specs[0], getString(R.string.autofill_unlock), null, sender)?.let {
                    response.setAuthentication(form.ids.toTypedArray(), sender, p, it)
                } ?: response.setAuthentication(form.ids.toTypedArray(), sender, p)
            } else {
                response.setAuthentication(form.ids.toTypedArray(), sender, p)
            }
        } else {
            val datasets = buildDatasets(this, form, specs, maxInline)
            datasets.forEach { response.addDataset(it) }
        }
        saveInfo(form)?.let { response.setSaveInfo(it) }
        callback.onSuccess(response.build())
    }

    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
        val structure = request.fillContexts.lastOrNull()?.structure ?: return callback.onSuccess()
        val form = Structure.parse(structure)
        val pass = form.passwordValue
        if (pass.isNullOrEmpty()) return callback.onSuccess()
        AutofillActivity.pendingSave = AutofillActivity.PendingSave(form.webDomain, form.packageName, form.usernameValue ?: "", pass)
        callback.onSuccess(AutofillActivity.intentSender(this, AutofillActivity.MODE_SAVE, form, 0))
    }

    private fun saveInfo(form: ParsedForm): SaveInfo? {
        val pass = form.password ?: return null
        val type = SaveInfo.SAVE_DATA_TYPE_PASSWORD or (if (form.username != null) SaveInfo.SAVE_DATA_TYPE_USERNAME else 0)
        return SaveInfo.Builder(type, arrayOf(pass))
            .apply { form.username?.let { setOptionalIds(arrayOf(it)) } }
            // Páginas web e apps de uma tela só: o formulário "some" ao enviar
            .setFlags(SaveInfo.FLAG_SAVE_ON_ALL_VIEWS_INVISIBLE)
            .build()
    }

    private fun appLabel(pkg: String): String = try {
        packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
    } catch (_: Exception) { pkg }

    companion object {
        /** Datasets das entradas que combinam com a tela + "Procurar no MySecrets". */
        fun buildDatasets(ctx: Context, form: ParsedForm, specs: List<InlinePresentationSpec>, maxInline: Int): List<Dataset> {
            val matches = Vault.entries.value
                .map { it to Structure.score(it, form) }
                .filter { it.second > 0 }
                .sortedWith(compareByDescending<Pair<JSONObject, Int>> { it.second }.thenByDescending { it.first.optBoolean("favorite") })
                .map { it.first }
                .take(8)
            val out = mutableListOf<Dataset>()
            matches.forEachIndexed { i, e ->
                val title = e.optString("title").ifBlank { Structure.hostOf(e.optString("url")) ?: "Login" }
                val sub = e.optString("username")
                val spec = if (i < maxInline - 1) specs.getOrNull(minOf(i, specs.size - 1)) else null
                out += dataset(ctx, form, e, title, sub, spec)
            }
            // Item para escolher qualquer entrada do cofre
            val sender = AutofillActivity.intentSender(ctx, AutofillActivity.MODE_PICK, form, 0)
            val b = Dataset.Builder(presentation(ctx, ctx.getString(R.string.autofill_search), form.webDomain ?: ""))
            form.ids.forEach { b.setValue(it, null) }
            b.setAuthentication(sender)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && specs.isNotEmpty() && maxInline > 0) {
                inlinePresentation(ctx, specs.last(), ctx.getString(R.string.autofill_search), null, sender)?.let { b.setInlinePresentation(it) }
            }
            out += b.build()
            return out
        }

        @SuppressLint("NewApi")
        fun dataset(ctx: Context, form: ParsedForm, e: JSONObject, title: String, sub: String, spec: InlinePresentationSpec?): Dataset {
            val b = Dataset.Builder(presentation(ctx, title, sub))
            if (spec != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                inlinePresentation(ctx, spec, title, sub, null)?.let { b.setInlinePresentation(it) }
            }
            form.username?.let { b.setValue(it, AutofillValue.forText(e.optString("username"))) }
            form.password?.let { b.setValue(it, AutofillValue.forText(e.optString("password"))) }
            form.otp?.let { id -> otpFor(e)?.let { b.setValue(id, AutofillValue.forText(it)) } }
            return b.build()
        }

        /** Código MFA da entrada (MFA vinculado ou o próprio segredo). */
        fun otpFor(e: JSONObject): String? {
            val linked = e.optString("linkedMfaId")
            val mfa = if (linked.isNotEmpty()) Vault.find(linked) else e
            return mfa?.let { Otp.forEntry(it)?.code }
        }

        fun presentation(ctx: Context, title: String, sub: String): RemoteViews =
            RemoteViews(ctx.packageName, R.layout.autofill_item).apply {
                setTextViewText(R.id.title, title)
                setTextViewText(R.id.subtitle, sub)
            }

        @RequiresApi(Build.VERSION_CODES.R)
        // content.slice é o uso documentado do androidx.autofill para sugestões
        // inline; o lint marca RestrictedApi por engano (falso positivo conhecido).
        @android.annotation.SuppressLint("RestrictedApi")
        fun inlinePresentation(ctx: Context, spec: InlinePresentationSpec, title: String, sub: String?, auth: android.content.IntentSender?): InlinePresentation? {
            val style = spec.style
            if (!androidx.autofill.inline.UiVersions.getVersions(style).contains(androidx.autofill.inline.UiVersions.INLINE_UI_VERSION_1)) return null
            val attribution = PendingIntent.getActivity(ctx, 0, Intent(ctx, com.mysecrets.app.ui.MainActivity::class.java),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val content = InlineSuggestionUi.newContentBuilder(attribution)
                .setTitle(title)
                .apply { if (!sub.isNullOrBlank()) setSubtitle(sub) }
                .setStartIcon(Icon.createWithResource(ctx, R.mipmap.ic_launcher))
                .build()
            val slice: Slice = content.slice
            return InlinePresentation(slice, spec, false)
        }

        fun ids(form: ParsedForm): Array<AutofillId> = form.ids.toTypedArray()
    }
}
