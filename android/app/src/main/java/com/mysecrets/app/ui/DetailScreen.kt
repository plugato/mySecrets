package com.mysecrets.app.ui

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DeleteForever
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.RestoreFromTrash
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mysecrets.app.otp.Otp
import com.mysecrets.app.vault.Vault
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.Base64

@Composable
private fun Field(label: String, value: String, secret: Boolean = false, mono: Boolean = false, extra: (@Composable () -> Unit)? = null) {
    if (value.isBlank()) return
    val ctx = LocalContext.current
    var show by remember { mutableStateOf(!secret) }
    Card(Modifier.fillMaxWidth()) {
        Row(Modifier.padding(start = 16.dp, end = 4.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                SelectionContainer {
                    Text(if (show) value else "••••••••••", fontFamily = if (mono || secret) FontFamily.Monospace else null)
                }
            }
            extra?.invoke()
            if (secret) IconButton(onClick = { show = !show }) { Icon(if (show) Icons.Default.VisibilityOff else Icons.Default.Visibility, "Mostrar") }
            IconButton(onClick = { copySecret(ctx, label, value) }) { Icon(Icons.Default.ContentCopy, "Copiar") }
        }
    }
}

@Composable
private fun OtpCard(label: String, mfa: JSONObject) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val now = rememberNow()
    val code = Otp.forEntry(mfa, now)
    Card(Modifier.fillMaxWidth()) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                if (code == null) {
                    Text("Segredo MFA inválido", color = MaterialTheme.colorScheme.error)
                } else {
                    Text(code.code.chunked(3).joinToString(" "), fontSize = 28.sp, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold)
                    if (code.period > 0) Text("Expira em ${code.remaining}s", style = MaterialTheme.typography.labelSmall)
                }
            }
            if (mfa.optString("mfaAlgorithm") == "hotp") {
                IconButton(onClick = {
                    scope.launch {
                        val e = JSONObject(mfa.toString())
                        e.put("mfaCounter", e.optLong("mfaCounter", 0) + 1).put("updatedAt", Vault.now())
                        Vault.upsert(e)
                    }
                }) { Icon(Icons.Default.Refresh, "Próximo código") }
            }
            if (code != null) IconButton(onClick = { copySecret(ctx, "Código", code.code) }) { Icon(Icons.Default.ContentCopy, "Copiar") }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DetailScreen(id: String, onBack: () -> Unit, onEdit: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val entries by Vault.entries.collectAsState()
    val e = entries.firstOrNull { it.optString("id") == id }
    if (e == null) {
        androidx.compose.runtime.LaunchedEffect(Unit) { onBack() }
        return
    }
    val trashed = e.has("deletedAt") && !e.isNull("deletedAt")
    val type = e.optString("type", "login")
    var confirmDelete by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf<JSONObject?>(null) }

    val saveLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val att = saving
        saving = null
        if (uri != null && att != null) {
            try {
                ctx.contentResolver.openOutputStream(uri)?.use { it.write(Base64.getDecoder().decode(att.optString("data"))) }
                toast(ctx, "Arquivo salvo")
            } catch (ex: Exception) {
                toast(ctx, "Erro ao salvar: ${ex.message}")
            }
        }
    }

    Scaffold(topBar = {
        TopAppBar(
            title = { Text(entryTitle(e), maxLines = 1) },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Voltar") } },
            actions = {
                if (!trashed) {
                    IconButton(onClick = {
                        scope.launch {
                            val c = JSONObject(e.toString())
                            c.put("favorite", !e.optBoolean("favorite")).put("updatedAt", Vault.now())
                            Vault.upsert(c)
                        }
                    }) { Icon(if (e.optBoolean("favorite")) Icons.Default.Star else Icons.Default.StarBorder, "Favorito") }
                    IconButton(onClick = onEdit) { Icon(Icons.Default.Edit, "Editar") }
                    IconButton(onClick = { confirmDelete = true }) { Icon(Icons.Default.Delete, "Mover para a lixeira") }
                } else {
                    IconButton(onClick = { scope.launch { Vault.restore(id) } }) { Icon(Icons.Default.RestoreFromTrash, "Restaurar") }
                    IconButton(onClick = { confirmDelete = true }) { Icon(Icons.Default.DeleteForever, "Excluir definitivamente") }
                }
            }
        )
    }) { pad ->
        Column(Modifier.padding(pad).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(typeLabel(type), style = MaterialTheme.typography.labelLarge)
            if (trashed) Text("Esta entrada está na lixeira.", color = MaterialTheme.colorScheme.error)
            val url = e.optString("url")
            Field("Site", url, extra = {
                IconButton(onClick = {
                    try { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(if (url.contains("://")) url else "https://$url"))) } catch (_: Exception) {}
                }) { Icon(Icons.AutoMirrored.Filled.OpenInNew, "Abrir") }
            })
            Field("Usuário", e.optString("username"))
            Field("Senha", e.optString("password"), secret = true)
            val linked = e.optString("linkedMfaId").takeIf { it.isNotEmpty() }?.let { Vault.find(it) }
            if (type == "login" && linked != null && linked.optString("mfaSecret").isNotBlank()) OtpCard("MFA (${entryTitle(linked)})", linked)
            if (type == "mfa" && e.optString("mfaSecret").isNotBlank()) OtpCard("Código MFA", e)
            if (type == "mfa") Field("Segredo MFA", e.optString("mfaSecret"), secret = true)
            Field("Token", e.optString("token"), secret = true)
            Field("Tipo do token", e.optString("tokenType").takeIf { type == "token" } ?: "")
            Field("Expira em", e.optString("tokenExpires"))
            e.optJSONArray("customFields")?.let { arr ->
                for (i in 0 until arr.length()) {
                    val f = arr.optJSONObject(i) ?: continue
                    Field(f.optString("name"), f.optString("value"), secret = f.optString("type") == "password" || f.optString("type") == "hidden")
                }
            }
            Field("Notas", e.optString("notes"))
            e.optJSONArray("attachments")?.let { arr ->
                for (i in 0 until arr.length()) {
                    val a = arr.optJSONObject(i) ?: continue
                    Card(Modifier.fillMaxWidth()) {
                        Row(Modifier.padding(start = 16.dp, end = 4.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text("Anexo", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                                Text(a.optString("name"))
                                Text("${a.optLong("size") / 1024} KB", style = MaterialTheme.typography.labelSmall)
                            }
                            IconButton(onClick = { saving = a; saveLauncher.launch(a.optString("name", "anexo")) }) { Icon(Icons.Default.Download, "Salvar arquivo") }
                        }
                    }
                }
            }
            val tags = e.optJSONArray("tags")
            if (tags != null && tags.length() > 0) Text("Tags: " + (0 until tags.length()).joinToString(", ") { tags.optString(it) }, style = MaterialTheme.typography.bodySmall)
            val hist = e.optJSONArray("passwordHistory")?.length() ?: 0
            if (hist > 0) Text("$hist senha(s) anterior(es) no histórico", style = MaterialTheme.typography.bodySmall)
            Text("Atualizado em ${e.optString("updatedAt").take(16).replace('T', ' ')}", style = MaterialTheme.typography.bodySmall)
        }
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text(if (trashed) "Excluir definitivamente?" else "Mover para a lixeira?") },
            text = { Text(if (trashed) "Esta ação não pode ser desfeita e vale para todos os aparelhos." else "Você pode restaurar depois pela Lixeira.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = false
                    scope.launch { if (trashed) Vault.deleteForever(id) else Vault.moveToTrash(id) }
                    onBack()
                }) { Text(if (trashed) "Excluir" else "Mover") }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancelar") } }
        )
    }
}
