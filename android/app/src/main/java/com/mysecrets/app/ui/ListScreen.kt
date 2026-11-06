package com.mysecrets.app.ui

import com.mysecrets.app.R
import com.mysecrets.app.str
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Password
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.automirrored.filled.StickyNote2
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.Token
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.mysecrets.app.drive.DriveSync
import com.mysecrets.app.otp.Otp
import com.mysecrets.app.vault.Vault
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

/** Relógio que muda a cada segundo (códigos MFA). */
@Composable
fun rememberNow(): Long {
    var now by androidx.compose.runtime.remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            now = System.currentTimeMillis()
            delay(1000 - now % 1000)
        }
    }
    return now
}

fun typeIcon(type: String): ImageVector = when (type) {
    "mfa" -> Icons.Default.Password
    "token" -> Icons.Default.Token
    "note" -> Icons.AutoMirrored.Filled.StickyNote2
    else -> Icons.Default.Key
}

// Calculado a cada uso: acompanha o idioma do app
private val FILTERS get() = listOf("all" to str(R.string.filtro_todos), "fav" to str(R.string.filtro_favoritos), "login" to str(R.string.filtro_logins), "mfa" to "MFA", "token" to str(R.string.filtro_tokens), "note" to str(R.string.notas), "trash" to str(R.string.filtro_lixeira))

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ListScreen(onOpen: (String) -> Unit, onNew: () -> Unit, onSettings: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val entries by Vault.entries.collectAsState()
    val sync by DriveSync.status.collectAsState()
    var q by rememberSaveable { mutableStateOf("") }
    var filter by rememberSaveable { mutableStateOf("all") }
    val now = rememberNow()

    val list = entries.filter { e ->
        val trashed = e.has("deletedAt") && !e.isNull("deletedAt")
        val type = e.optString("type", "login")
        when (filter) {
            "trash" -> trashed
            "fav" -> !trashed && e.optBoolean("favorite")
            "all" -> !trashed
            else -> !trashed && type == filter
        }
    }.filter { e ->
        q.isBlank() || listOf(e.optString("title"), e.optString("url"), e.optString("username"), e.optString("notes"))
            .any { it.contains(q, true) } || (e.optJSONArray("tags")?.toString()?.contains(q, true) ?: false)
    }.sortedWith(compareByDescending<JSONObject> { it.optBoolean("favorite") }.thenBy { entryTitle(it).lowercase() })

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("MySecrets") },
                actions = {
                    if (sync.connected) IconButton(onClick = { scope.launch { DriveSync.syncNow() } }) { Icon(Icons.Default.Sync, str(R.string.sincronizar)) }
                    IconButton(onClick = onSettings) { Icon(Icons.Default.Settings, str(R.string.configuracoes)) }
                    IconButton(onClick = { Vault.lock() }) { Icon(Icons.Default.Lock, str(R.string.bloquear)) }
                }
            )
        },
        floatingActionButton = {
            if (filter != "trash") FloatingActionButton(onClick = onNew) { Icon(Icons.Default.Add, str(R.string.nova_entrada)) }
        }
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            if (sync.syncing) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (sync.lastError != null) {
                Text(str(R.string.sincronizacao, sync.lastError), color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
            }
            OutlinedTextField(
                value = q, onValueChange = { q = it }, singleLine = true,
                leadingIcon = { Icon(Icons.Default.Search, null) },
                placeholder = { Text(str(R.string.pesquisar)) },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)
            )
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FILTERS.forEach { (k, label) -> FilterChip(selected = filter == k, onClick = { filter = k }, label = { Text(label) }) }
            }
            if (list.isEmpty()) {
                Text(if (entries.isEmpty()) str(R.string.cofre_vazio_toque_em_para_adicionar) else str(R.string.nada_encontrado),
                    modifier = Modifier.padding(24.dp), style = MaterialTheme.typography.bodyMedium)
            }
            LazyColumn(Modifier.weight(1f)) {
                items(list, key = { it.optString("id") }) { e ->
                    val type = e.optString("type", "login")
                    val code = if (type == "mfa") Otp.forEntry(e, now) else null
                    ListItem(
                        leadingContent = { Icon(typeIcon(type), null) },
                        headlineContent = {
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text(entryTitle(e), maxLines = 1)
                                if (e.optBoolean("favorite")) Icon(Icons.Default.Star, null, tint = MaterialTheme.colorScheme.primary)
                            }
                        },
                        supportingContent = {
                            val sub = when (type) {
                                "login" -> e.optString("username").ifBlank { e.optString("url") }
                                "note" -> e.optString("notes").take(60)
                                else -> typeLabel(type)
                            }
                            if (sub.isNotBlank()) Text(sub, maxLines = 1)
                        },
                        trailingContent = {
                            if (code != null) {
                                Column(Modifier.clickable { copySecret(ctx, str(R.string.codigo_2), code.code) }) {
                                    Text(code.code.chunked(3).joinToString(" "), fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold)
                                    if (code.period > 0) Text("${code.remaining}s", style = MaterialTheme.typography.labelSmall)
                                }
                            }
                        },
                        modifier = Modifier.clickable { onOpen(e.optString("id")) }
                    )
                    HorizontalDivider()
                }
            }
        }
    }
}
