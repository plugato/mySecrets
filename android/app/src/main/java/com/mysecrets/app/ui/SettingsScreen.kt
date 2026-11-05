package com.mysecrets.app.ui

import android.content.Intent
import android.net.Uri
import android.provider.Settings as AndroidSettings
import android.view.autofill.AutofillManager
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.mysecrets.app.BuildConfig
import com.mysecrets.app.Settings
import com.mysecrets.app.crypto.Biometric
import com.mysecrets.app.crypto.Keys
import com.mysecrets.app.drive.DriveSync
import com.mysecrets.app.drive.GoogleAuth
import com.mysecrets.app.link.LinkProtocol
import com.mysecrets.app.link.LinkServer
import com.mysecrets.app.link.Pairings
import com.mysecrets.app.vault.Vault
import kotlinx.coroutines.launch

/** IPv4 do Wi-Fi (diagnóstico do pareamento). */
fun localIp(): String? = try {
    java.net.NetworkInterface.getNetworkInterfaces().toList()
        .filter { it.isUp && !it.isLoopback }
        .flatMap { it.inetAddresses.toList() }
        .firstOrNull { it is java.net.Inet4Address && !it.isLoopbackAddress }?.hostAddress
} catch (_: Exception) { null }

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            content()
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(activity: FragmentActivity, onBack: () -> Unit, onWiped: () -> Unit) {
    val scope = rememberCoroutineScope()
    val sync by DriveSync.status.collectAsState()
    val pcs by Pairings.list.collectAsState()
    val confirmed by LinkServer.confirmed.collectAsState()
    var busy by remember { mutableStateOf(false) }
    var msg by remember { mutableStateOf<String?>(null) }
    // Mensagens também em aviso flutuante: o texto do topo some quando a tela está rolada
    androidx.compose.runtime.LaunchedEffect(msg) {
        msg?.let { android.widget.Toast.makeText(activity, it, android.widget.Toast.LENGTH_LONG).show() }
    }
    var bio by remember { mutableStateOf(bioUnlockEnabled()) }
    var autofillOn by remember { mutableStateOf(false) }
    var lockSecs by remember { mutableIntStateOf(Settings.autoLockSeconds) }
    var clipSecs by remember { mutableIntStateOf(Settings.clipboardClearSeconds) }
    var pairingWith by remember { mutableStateOf<Pairings.Pc?>(null) }
    var confirmWipe by remember { mutableStateOf(false) }

    // O status do autofill muda fora do app (tela do sistema)
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val obs = LifecycleEventObserver { _, ev ->
            if (ev == Lifecycle.Event.ON_RESUME) {
                autofillOn = activity.getSystemService(AutofillManager::class.java)?.hasEnabledAutofillServices() == true
            }
        }
        owner.lifecycle.addObserver(obs)
        onDispose { owner.lifecycle.removeObserver(obs) }
    }

    Scaffold(topBar = {
        TopAppBar(title = { Text("Configurações") },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Voltar") } })
    }) { pad ->
        Column(Modifier.padding(pad).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (msg != null) Text(msg!!, color = MaterialTheme.colorScheme.primary)
            if (busy) CircularProgressIndicator()

            Section("Preenchimento automático") {
                Text(if (autofillOn) "✅ O MySecrets preenche logins nos apps e navegadores."
                else "Ative o MySecrets como serviço de preenchimento para usar seus logins em qualquer app ou navegador.")
                if (!autofillOn) Button(onClick = {
                    try {
                        activity.startActivity(Intent(AndroidSettings.ACTION_REQUEST_SET_AUTOFILL_SERVICE, Uri.parse("package:${activity.packageName}")))
                    } catch (_: Exception) {
                        activity.startActivity(Intent(AndroidSettings.ACTION_SETTINGS))
                    }
                }) { Text("Ativar preenchimento automático") }
                Text("No Chrome: Configurações > Preenchimento automático > \"Preencher usando outro serviço\". Firefox, Brave, Edge e Samsung Internet usam o serviço do Android direto.",
                    style = MaterialTheme.typography.bodySmall)
            }

            Section("Desbloqueio") {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Desbloquear com a digital", Modifier.weight(1f))
                    Switch(checked = bio, onCheckedChange = { on ->
                        if (!on) {
                            Settings.bioUnlockBlob = null
                            Keys.delete(Keys.BIO_UNLOCK)
                            bio = false
                        } else if (!Biometric.available(activity)) {
                            msg = Biometric.unavailableReason(activity)
                        } else scope.launch {
                            try { enableBiometric(activity); bio = true } catch (e: Exception) { if (e !is Biometric.Cancelled) msg = e.message }
                        }
                    })
                }
                Text("Bloquear ao sair do app:", style = MaterialTheme.typography.bodyMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf(0 to "Na hora", 60 to "1 min", 300 to "5 min", 900 to "15 min").forEach { (s, l) ->
                        FilterChip(selected = lockSecs == s, onClick = { lockSecs = s; Settings.autoLockSeconds = s }, label = { Text(l) })
                    }
                }
                Text("Limpar área de transferência:", style = MaterialTheme.typography.bodyMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf(0 to "Nunca", 15 to "15 s", 30 to "30 s", 60 to "60 s").forEach { (s, l) ->
                        FilterChip(selected = clipSecs == s, onClick = { clipSecs = s; Settings.clipboardClearSeconds = s }, label = { Text(l) })
                    }
                }
                Text("O cofre também bloqueia quando a tela do celular apaga.", style = MaterialTheme.typography.bodySmall)
            }

            Section("Sincronização (Google Drive)") {
                if (!GoogleAuth.configured()) {
                    Text("Login com Google indisponível nesta versão do app.")
                } else if (sync.connected) {
                    Text("Conectado: ${sync.email.ifBlank { "conta Google" }}")
                    Text(sync.lastError?.let { "⚠️ $it" } ?: sync.lastSyncAt?.let { "Última sincronização: ${it.take(19).replace('T', ' ')} (UTC)" } ?: "Ainda não sincronizado",
                        style = MaterialTheme.typography.bodySmall)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(enabled = !sync.syncing, onClick = { scope.launch { DriveSync.syncNow() } }) { Text(if (sync.syncing) "Sincronizando…" else "Sincronizar agora") }
                        OutlinedButton(onClick = { DriveSync.disconnect() }) { Text("Desconectar") }
                    }
                } else {
                    Text(sync.lastError ?: "Entre com a mesma conta Google do PC para manter os dois com o mesmo cofre.")
                    Button(enabled = !busy, onClick = {
                        scope.launch {
                            busy = true
                            try {
                                DriveSync.saveAccount(GoogleAuth.authorize(activity))
                                DriveSync.syncNow()
                                msg = DriveSync.status.value.lastError?.let { "Conectado, mas: $it" } ?: "✅ Conta Google conectada e cofre sincronizado"
                            } catch (e: Exception) { msg = e.message } finally { busy = false }
                        }
                    }) { Text("Entrar com Google") }
                }
                Text("O cofre vai sempre criptografado; o app só acessa a pasta MySecrets que ele mesmo criou.", style = MaterialTheme.typography.bodySmall)
            }

            Section("Aprovar login no PC") {
                Text("Pareie com o MySecrets do computador. Depois, na tela de login do PC, clique em \"Aprovar pelo celular\" e confirme aqui com a digital.")
                Text("Funciona na mesma rede Wi-Fi, com este app aberto.", style = MaterialTheme.typography.bodySmall)
                pcs.forEach { pc ->
                    ListItem(
                        leadingContent = { Icon(Icons.Default.Computer, null) },
                        headlineContent = { Text(pc.desktopName) },
                        supportingContent = { Text(if (pc.confirmed) "Pareado" + (pc.lastUsedAt?.let { " · usado em ${it.take(10)}" } ?: "") else "Aguardando o PC confirmar") },
                        trailingContent = { TextButton(onClick = { Pairings.remove(pc.pairId) }) { Text("Remover") } }
                    )
                    HorizontalDivider()
                }
                Button(onClick = {
                    scope.launch {
                        try {
                            if (!Biometric.available(activity)) { msg = Biometric.unavailableReason(activity); return@launch }
                            val raw = MainActivity.debugPairQr?.also { MainActivity.debugPairQr = null } ?: scanQr(activity)
                            if (raw == null) { android.util.Log.i("MySecretsPair", "leitura do QR cancelada"); return@launch }
                            val qr = LinkProtocol.parseQr(raw)
                            android.util.Log.i("MySecretsPair", "QR lido: PC ${qr.desktopName}, código ${qr.pairId.take(6)}")
                            val cipher = Keys.bioEncryptCipher(Keys.BIO_LINK)
                            val ok = Biometric.authenticate(activity, cipher, "Parear com ${qr.desktopName}", "Confirme com a digital ou o PIN")
                            LinkServer.clearConfirmed()
                            Pairings.add(qr, ok)
                            android.util.Log.i("MySecretsPair", "pareamento guardado: ${qr.pairId.take(6)}")
                            pairingWith = Pairings.find(qr.pairId)
                        } catch (e: Exception) {
                            android.util.Log.w("MySecretsPair", "pareamento falhou: ${e.javaClass.simpleName}: ${e.message}")
                            msg = if (e is Biometric.Cancelled) "Pareamento cancelado (${e.message})" else (e.message ?: e.javaClass.simpleName)
                        }
                    }
                }) { Text("Parear com PC (ler QR code)") }
                Text("No PC: Configurações > Celular Android > Parear celular.", style = MaterialTheme.typography.bodySmall)
            }

            Section("Cofre neste aparelho") {
                Text("Entradas: ${Vault.entries.value.count { !it.has("deletedAt") }}")
                OutlinedButton(onClick = { confirmWipe = true }) { Text("Apagar o cofre deste celular") }
                Text("Versão ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodySmall)
            }
        }
    }

    pairingWith?.let { pc ->
        val done = confirmed == pc.pairId
        AlertDialog(
            onDismissRequest = { pairingWith = null },
            title = { Text(if (done) "✅ Pareado" else "Quase lá") },
            text = {
                val last by LinkServer.lastEvent.collectAsState()
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(if (done) "Pronto! Na tela de login do ${pc.desktopName}, clique em \"Aprovar pelo celular\"."
                    else "Aguardando o ${pc.desktopName} encontrar este celular na rede Wi-Fi… Mantenha esta tela aberta.")
                    if (!done) {
                        Text("Este celular: ${localIp() ?: "sem Wi-Fi?"} · ${if (LinkServer.listening) "escutando" else "NÃO está escutando"} na porta ${LinkProtocol.PORT}",
                            style = MaterialTheme.typography.bodySmall)
                        Text("Último contato do PC: ${last ?: "nenhum ainda"}", style = MaterialTheme.typography.bodySmall)
                    }
                }
            },
            confirmButton = { TextButton(onClick = { pairingWith = null }) { Text(if (done) "OK" else "Fechar") } }
        )
    }

    if (confirmWipe) {
        AlertDialog(
            onDismissRequest = { confirmWipe = false },
            title = { Text("Apagar o cofre deste celular?") },
            text = { Text("Remove o cofre, a digital e a conta Google só deste aparelho. O cofre no PC e no Google Drive continua intacto.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmWipe = false
                    DriveSync.disconnect()
                    Settings.bioUnlockBlob = null
                    Keys.delete(Keys.BIO_UNLOCK)
                    Vault.wipe()
                    onWiped()
                }) { Text("Apagar") }
            },
            dismissButton = { TextButton(onClick = { confirmWipe = false }) { Text("Cancelar") } }
        )
    }
}
