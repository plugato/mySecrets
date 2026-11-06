package com.mysecrets.app.autofill

import com.mysecrets.app.R
import com.mysecrets.app.str
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.IntentSender
import android.os.Build
import android.os.Bundle
import android.service.autofill.FillResponse
import android.view.WindowManager
import android.view.autofill.AutofillId
import android.view.autofill.AutofillManager
import android.view.inputmethod.InlineSuggestionsRequest
import androidx.activity.compose.setContent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import com.mysecrets.app.ui.MySecretsTheme
import com.mysecrets.app.ui.UnlockPanel
import com.mysecrets.app.ui.entryTitle
import com.mysecrets.app.vault.Vault
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/**
 * Telas do preenchimento automático:
 *  - UNLOCK: desbloqueia e devolve as sugestões da tela;
 *  - PICK:   escolher qualquer entrada do cofre (busca);
 *  - SAVE:   salvar/atualizar o login que o usuário acabou de digitar.
 */
class AutofillActivity : FragmentActivity() {

    data class PendingSave(val webDomain: String?, val packageName: String, val username: String, val password: String)

    companion object {
        const val MODE_UNLOCK = "unlock"
        const val MODE_PICK = "pick"
        const val MODE_SAVE = "save"
        @Volatile var pendingSave: PendingSave? = null

        private var requestCode = 1

        fun intentSender(ctx: Context, mode: String, form: ParsedForm, fillRequestId: Int): IntentSender {
            val i = Intent(ctx, AutofillActivity::class.java)
                .putExtra("mode", mode)
                .putExtra("pkg", form.packageName)
                .putExtra("web", form.webDomain)
                .putExtra("user", form.username)
                .putExtra("pass", form.password)
                .putExtra("otp", form.otp)
            return PendingIntent.getActivity(ctx, requestCode++, i,
                PendingIntent.FLAG_CANCEL_CURRENT or PendingIntent.FLAG_MUTABLE).intentSender
        }
    }

    private lateinit var form: ParsedForm

    @Suppress("DEPRECATION")
    private fun id(key: String): AutofillId? = intent.getParcelableExtra(key)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Bloqueia captura de tela e miniatura nos recentes (fora do build de debug)
        if (!com.mysecrets.app.BuildConfig.DEBUG) window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        form = ParsedForm(intent.getStringExtra("pkg") ?: "", intent.getStringExtra("web"), id("user"), id("pass"), id("otp"), null, null)
        val mode = intent.getStringExtra("mode") ?: MODE_PICK

        setContent {
            MySecretsTheme {
                Surface(Modifier.fillMaxSize().safeDrawingPadding().imePadding()) {
                    val unlocked by Vault.unlocked.collectAsState()
                    if (!unlocked) {
                        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center) {
                            UnlockPanel(this@AutofillActivity) {
                                if (mode == MODE_UNLOCK) finishUnlock()
                            }
                        }
                    } else when (mode) {
                        MODE_UNLOCK -> androidx.compose.runtime.LaunchedEffect(Unit) { finishUnlock() }
                        MODE_SAVE -> SaveScreen()
                        else -> PickScreen()
                    }
                }
            }
        }
    }

    private var finished = false

    private fun finishUnlock() {
        if (finished) return
        finished = true
        val specs = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra<InlineSuggestionsRequest>(AutofillManager.EXTRA_INLINE_SUGGESTIONS_REQUEST)
        } else null
        val inlineSpecs = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) specs?.inlinePresentationSpecs ?: emptyList() else emptyList()
        val max = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) specs?.maxSuggestionCount ?: 0 else 0
        val response = FillResponse.Builder()
        MySecretsAutofillService.buildDatasets(this, form, inlineSpecs, max).forEach { response.addDataset(it) }
        setResult(RESULT_OK, Intent().putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, response.build()))
        finish()
    }

    private fun pick(e: JSONObject) {
        val ds = MySecretsAutofillService.dataset(this, form, e, entryTitle(e), e.optString("username"), null)
        setResult(RESULT_OK, Intent().putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, ds))
        finish()
    }

    @androidx.compose.runtime.Composable
    private fun PickScreen() {
        val all by Vault.entries.collectAsState()
        var q by remember { mutableStateOf(form.webDomain?.let { (Structure.registrableDomain(it) ?: it).substringBefore('.') } ?: "") }
        val list = all.filter { it.optString("type", "login") == "login" && !it.has("deletedAt") }
            .filter { e ->
                q.isBlank() || listOf(e.optString("title"), e.optString("url"), e.optString("username")).any { it.contains(q, true) }
            }
            .sortedBy { entryTitle(it).lowercase() }
        Column(Modifier.fillMaxSize()) {
            OutlinedTextField(q, { q = it }, label = { Text(str(R.string.procurar_login)) }, singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(16.dp))
            LazyColumn(Modifier.weight(1f)) {
                items(list, key = { it.optString("id") }) { e ->
                    ListItem(
                        headlineContent = { Text(entryTitle(e)) },
                        supportingContent = { Text(e.optString("username")) },
                        modifier = Modifier.clickable { pick(e) }
                    )
                    HorizontalDivider()
                }
            }
            TextButton(onClick = { finish() }, modifier = Modifier.padding(8.dp)) { Text(str(R.string.cancelar)) }
        }
    }

    @androidx.compose.runtime.Composable
    private fun SaveScreen() {
        val p = pendingSave
        if (p == null) { androidx.compose.runtime.LaunchedEffect(Unit) { finish() }; return }
        val scope = rememberCoroutineScope()
        val host = p.webDomain?.removePrefix("www.")
        val entries by Vault.entries.collectAsState()
        val existing = entries.firstOrNull { e ->
            !e.has("deletedAt") && e.optString("type", "login") == "login" &&
                Structure.score(e, form.copyFor(p)) > 0 && e.optString("username").equals(p.username, true)
        }
        Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(if (existing != null) str(R.string.atualizar_senha_no_mysecrets) else str(R.string.salvar_login_no_mysecrets), style = MaterialTheme.typography.headlineSmall)
            Text(host ?: p.packageName)
            if (p.username.isNotBlank()) Text(str(R.string.usuario_2, p.username))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                TextButton(onClick = { pendingSave = null; finish() }) { Text(str(R.string.agora_nao)) }
                Button(onClick = {
                    scope.launch {
                        save(p, existing)
                        pendingSave = null
                        finish()
                    }
                }) { Text(if (existing != null) str(R.string.atualizar) else str(R.string.salvar)) }
            }
        }
    }

    private fun ParsedForm.copyFor(p: PendingSave) = ParsedForm(p.packageName, p.webDomain, username, password, otp, null, null)

    /** Mesmo formato do "salvar login" da extensão (saveLoginFromExtension no desktop). */
    private suspend fun save(p: PendingSave, existing: JSONObject?) {
        val now = Vault.now()
        if (existing != null) {
            val e = JSONObject(existing.toString())
            val old = e.optString("password")
            if (old.isNotEmpty() && old != p.password) {
                val hist = e.optJSONArray("passwordHistory") ?: JSONArray()
                hist.put(JSONObject().put("password", old).put("changedAt", now))
                val trimmed = JSONArray()
                for (i in maxOf(0, hist.length() - 10) until hist.length()) trimmed.put(hist.get(i))
                e.put("passwordHistory", trimmed)
            }
            e.put("password", p.password).put("updatedAt", now)
            Vault.upsert(e)
            return
        }
        val host = p.webDomain?.removePrefix("www.")
        val e = JSONObject()
            .put("id", Vault.newId())
            .put("type", "login")
            .put("title", host ?: appName(p.packageName))
            .put("url", if (host != null) "https://$host" else "")
            .put("username", p.username)
            .put("password", p.password)
            .put("notes", "")
            .put("tags", JSONArray().put("android"))
            .put("favorite", false)
            .put("createdAt", now)
            .put("updatedAt", now)
        if (host == null) e.put("androidPackages", JSONArray().put(p.packageName))
        Vault.upsert(e)
    }

    private fun appName(pkg: String) = try {
        packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
    } catch (_: Exception) { pkg }
}
