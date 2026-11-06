package com.mysecrets.app.ui

import com.mysecrets.app.R
import com.mysecrets.app.str
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
import com.mysecrets.app.link.PairFlow
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
    val entradas by Vault.entries.collectAsState()
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
        TopAppBar(title = { Text(str(R.string.configuracoes)) },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, str(R.string.voltar)) } })
    }) { pad ->
        Column(Modifier.padding(pad).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (msg != null) Text(msg!!, color = MaterialTheme.colorScheme.primary)
            if (busy) CircularProgressIndicator()

            Section(str(R.string.preenchimento_automatico)) {
                Text(if (autofillOn) str(R.string.o_mysecrets_preenche_logins_nos_apps)
                else str(R.string.ative_o_mysecrets_como_servico_de))
                if (!autofillOn) Button(onClick = {
                    try {
                        activity.startActivity(Intent(AndroidSettings.ACTION_REQUEST_SET_AUTOFILL_SERVICE, Uri.parse("package:${activity.packageName}")))
                    } catch (_: Exception) {
                        activity.startActivity(Intent(AndroidSettings.ACTION_SETTINGS))
                    }
                }) { Text(str(R.string.ativar_preenchimento_automatico)) }
                Text(str(R.string.no_chrome_configuracoes_preenchimento_automatico_preencher),
                    style = MaterialTheme.typography.bodySmall)
            }

            Section(str(R.string.desbloqueio)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(str(R.string.desbloquear_com_a_digital_2), Modifier.weight(1f))
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
                Text(str(R.string.bloquear_ao_sair_do_app), style = MaterialTheme.typography.bodyMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf(0 to str(R.string.na_hora), 60 to str(R.string.n_1_min), 300 to str(R.string.n_5_min), 900 to str(R.string.n_15_min)).forEach { (s, l) ->
                        FilterChip(selected = lockSecs == s, onClick = { lockSecs = s; Settings.autoLockSeconds = s }, label = { Text(l) })
                    }
                }
                Text(str(R.string.limpar_area_de_transferencia), style = MaterialTheme.typography.bodyMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf(0 to str(R.string.nunca), 15 to "15 s", 30 to "30 s", 60 to "60 s").forEach { (s, l) ->
                        FilterChip(selected = clipSecs == s, onClick = { clipSecs = s; Settings.clipboardClearSeconds = s }, label = { Text(l) })
                    }
                }
                Text(str(R.string.o_cofre_tambem_bloqueia_quando_a), style = MaterialTheme.typography.bodySmall)
            }

            Section(str(R.string.sincronizacao_google_drive)) {
                if (!GoogleAuth.configured()) {
                    Text(str(R.string.login_com_google_indisponivel_nesta_versao))
                } else if (sync.connected) {
                    Text(str(R.string.conectado_conta, sync.email.ifBlank { str(R.string.conta_google) }))
                    Text(sync.lastError?.let { "⚠️ $it" } ?: sync.lastSyncAt?.let { str(R.string.ultima_sincronizacao_utc, it.take(19).replace('T', ' ')) } ?: str(R.string.ainda_nao_sincronizado),
                        style = MaterialTheme.typography.bodySmall)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(enabled = !sync.syncing, onClick = { scope.launch { DriveSync.syncNow() } }) { Text(if (sync.syncing) str(R.string.sincronizando) else str(R.string.sincronizar_agora)) }
                        OutlinedButton(onClick = { DriveSync.disconnect() }) { Text(str(R.string.desconectar)) }
                    }
                } else {
                    Text(sync.lastError ?: str(R.string.entre_com_a_mesma_conta_google))
                    Button(enabled = !busy, onClick = {
                        scope.launch {
                            busy = true
                            try {
                                GoogleAuth.connect(activity)
                                DriveSync.syncNow()
                                msg = DriveSync.status.value.lastError?.let { str(R.string.conectado_mas, it) } ?: str(R.string.conta_google_conectada_e_cofre_sincronizado)
                            } catch (e: Exception) { msg = e.message } finally { busy = false }
                        }
                    }) { Text(str(R.string.entrar_com_google)) }
                }
                Text(str(R.string.o_cofre_vai_sempre_criptografado_o), style = MaterialTheme.typography.bodySmall)
            }

            Section(str(R.string.aprovar_login_no_pc)) {
                Text(str(R.string.pareie_com_o_mysecrets_do_computador))
                Text(str(R.string.funciona_na_mesma_rede_wi_fi), style = MaterialTheme.typography.bodySmall)
                pcs.forEach { pc ->
                    ListItem(
                        leadingContent = { Icon(Icons.Default.Computer, null) },
                        headlineContent = { Text(pc.desktopName) },
                        supportingContent = { Text(if (pc.confirmed) str(R.string.pareado_2) + (pc.lastUsedAt?.let { str(R.string.usado_em, it.take(10)) } ?: "") else str(R.string.aguardando_o_pc_confirmar)) },
                        trailingContent = { TextButton(onClick = { Pairings.remove(pc.pairId) }) { Text(str(R.string.remover)) } }
                    )
                    HorizontalDivider()
                }
                Button(onClick = {
                    val debugQr = MainActivity.debugPairQr?.also { MainActivity.debugPairQr = null }
                    if (debugQr != null) PairFlow.accept(debugQr) else PairFlow.scan(activity)
                }) { Text(str(R.string.parear_com_pc_ler_qr_code)) }
                Text(str(R.string.no_pc_configuracoes_celular_android_parear), style = MaterialTheme.typography.bodySmall)
            }

            Section(str(R.string.cofre_neste_aparelho)) {
                Text(str(R.string.entradas_n, entradas.count { !it.has("deletedAt") }))
                OutlinedButton(onClick = { confirmWipe = true }) { Text(str(R.string.apagar_o_cofre_deste_celular)) }
                Text(str(R.string.versao, BuildConfig.VERSION_NAME), style = MaterialTheme.typography.bodySmall)
            }
        }
    }

    if (confirmWipe) {
        AlertDialog(
            onDismissRequest = { confirmWipe = false },
            title = { Text(str(R.string.apagar_o_cofre_deste_celular_2)) },
            text = { Text(str(R.string.remove_o_cofre_a_digital_os)) },
            confirmButton = {
                TextButton(onClick = {
                    confirmWipe = false
                    DriveSync.disconnect()
                    Settings.bioUnlockBlob = null
                    Keys.delete(Keys.BIO_UNLOCK)
                    // Sem isto o celular continuaria aprovando o login dos PCs
                    Pairings.clear()
                    Keys.delete(Keys.BIO_LINK)
                    // Quais apps e sites foram consultados no preenchimento
                    com.mysecrets.app.autofill.AssetLinks.clear(activity)
                    Vault.wipe()
                    onWiped()
                }) { Text(str(R.string.apagar)) }
            },
            dismissButton = { TextButton(onClick = { confirmWipe = false }) { Text(str(R.string.cancelar)) } }
        )
    }
}
