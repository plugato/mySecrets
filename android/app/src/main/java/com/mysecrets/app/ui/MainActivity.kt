package com.mysecrets.app.ui

import com.mysecrets.app.R
import com.mysecrets.app.str
import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.fragment.app.FragmentActivity
import com.mysecrets.app.Settings
import com.mysecrets.app.crypto.Biometric
import com.mysecrets.app.crypto.Keys
import com.mysecrets.app.drive.DriveSync
import com.mysecrets.app.drive.GoogleAuth
import com.mysecrets.app.link.LinkServer
import com.mysecrets.app.link.PairFlow
import com.mysecrets.app.link.Pairings
import com.mysecrets.app.vault.Vault
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

sealed class Screen {
    data object List : Screen()
    data class Detail(val id: String) : Screen()
    data class Edit(val id: String?) : Screen()
    data object Settings : Screen()
}

class MainActivity : FragmentActivity() {
    companion object {
        /** Só no build de debug: QR de pareamento injetado por intent (testes sem câmera). */
        var debugPairQr: String? = null
    }

    private fun takeDebugExtras(i: Intent?) {
        if (com.mysecrets.app.BuildConfig.DEBUG) i?.getStringExtra("debugPairQr")?.let { debugPairQr = it }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        takeDebugExtras(intent)
        // Bloqueia captura de tela e miniatura nos recentes (fora do build de debug)
        if (!com.mysecrets.app.BuildConfig.DEBUG) window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        setContent {
            MySecretsTheme {
                Surface(Modifier.fillMaxSize()) { App(this) }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent) // volta do login com Google: nada a fazer, a tela já está esperando
        takeDebugExtras(intent)
    }
}

@Composable
fun App(activity: FragmentActivity) {
    val unlocked by Vault.unlocked.collectAsState()
    var hasVault by remember { mutableStateOf(Vault.exists()) }
    var screen by remember { mutableStateOf<Screen>(Screen.List) }
    var offerBio by remember { mutableStateOf(false) }

    LaunchedEffect(unlocked) { if (!unlocked) screen = Screen.List }

    Box(activity) {
        when {
            !unlocked && !hasVault -> SetupScreen(activity) { hasVault = Vault.exists() }
            !unlocked -> Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding(), verticalArrangement = Arrangement.Center) {
                UnlockPanel(activity) {
                    offerBio = !bioUnlockEnabled() && !Settings.bioOfferDeclined && Biometric.available(activity)
                    DriveSync.schedule(300)
                }
                if (DriveSync.connected.not() && GoogleAuth.configured()) {
                    Text(str(R.string.dica_em_configuracoes_voce_pode_entrar),
                        style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(24.dp))
                }
            }
            else -> {
                BackHandler(enabled = screen != Screen.List) { screen = Screen.List }
                when (val s = screen) {
                    Screen.List -> ListScreen(onOpen = { screen = Screen.Detail(it) }, onNew = { screen = Screen.Edit(null) }, onSettings = { screen = Screen.Settings })
                    is Screen.Detail -> DetailScreen(s.id, onBack = { screen = Screen.List }, onEdit = { screen = Screen.Edit(s.id) })
                    is Screen.Edit -> EditScreen(activity, s.id, onDone = { id -> screen = if (id != null) Screen.Detail(id) else Screen.List })
                    Screen.Settings -> SettingsScreen(activity, onBack = { screen = Screen.List }, onWiped = { hasVault = false })
                }
            }
        }
    }

    // Fora do if: o diálogo some ao tocar em "Ativar" e o escopo não pode sair junto
    // (cancelaria o prompt da digital com "The coroutine scope left the composition").
    val bioScope = rememberCoroutineScope()
    if (offerBio && unlocked) {
        AlertDialog(
            onDismissRequest = { offerBio = false },
            title = { Text(str(R.string.desbloquear_com_a_digital)) },
            text = { Text(str(R.string.na_proxima_vez_voce_abre_o)) },
            confirmButton = {
                Button(onClick = {
                    offerBio = false
                    bioScope.launch {
                        try { enableBiometric(activity) } catch (e: Exception) { if (e !is Biometric.Cancelled) toast(activity, e.message ?: str(R.string.erro)) }
                    }
                }) { Text(str(R.string.ativar)) }
            },
            dismissButton = { TextButton(onClick = { offerBio = false; Settings.bioOfferDeclined = true }) { Text(str(R.string.agora_nao)) } }
        )
    }
}

/** Conteúdo + diálogo de aprovação do PC por cima de qualquer tela. */
@Composable
private fun Box(activity: FragmentActivity, content: @Composable () -> Unit) {
    content()
    PairFlowHost(activity)
    ApprovalDialog(activity)
}

/** Pareamento com o PC: confirmação com a digital e espera, em qualquer tela. */
@Composable
fun PairFlowHost(activity: FragmentActivity) {
    val st by PairFlow.state.collectAsState()
    val confirmed by LinkServer.confirmed.collectAsState()
    val last by LinkServer.lastEvent.collectAsState()
    when (val s = st) {
        is PairFlow.State.Scanned -> LaunchedEffect(s) {
            // Só pede com a tela visível (ao voltar de outro app ou de uma tela recriada)
            activity.lifecycle.currentStateFlow.first { it.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED) }
            kotlinx.coroutines.delay(300)
            PairFlow.confirm(activity, s)
        }
        is PairFlow.State.Waiting -> {
            val done = confirmed == s.pairId
            AlertDialog(
                onDismissRequest = {},
                title = { Text(if (done) str(R.string.pareado) else str(R.string.quase_la)) },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(if (done) str(R.string.pronto_na_tela_de_login_do, s.desktopName)
                        else str(R.string.aguardando_o_encontrar_este_celular_na, s.desktopName))
                        if (!done) {
                            Text(str(R.string.diag_este_celular, localIp() ?: str(R.string.diag_sem_wifi), str(if (LinkServer.listening) R.string.diag_escutando else R.string.diag_nao_escutando), com.mysecrets.app.link.LinkProtocol.PORT),
                                style = MaterialTheme.typography.bodySmall)
                            Text(str(R.string.diag_ultimo_contato, last ?: str(R.string.diag_nenhum_ainda)), style = MaterialTheme.typography.bodySmall)
                        }
                    }
                },
                confirmButton = { TextButton(onClick = {
                    // Pareado: já pede a notificação (aviso do PC com o app fechado)
                    if (done && com.mysecrets.app.Settings.pushEnabled && com.mysecrets.app.link.Push.available(activity)) {
                        com.mysecrets.app.link.Push.requestNotifications(activity)
                    }
                    PairFlow.dismiss()
                }) { Text(if (done) str(R.string.ok) else str(R.string.fechar)) } }
            )
        }
        is PairFlow.State.Error -> AlertDialog(
            onDismissRequest = { PairFlow.dismiss() },
            title = { Text(str(R.string.pareamento)) },
            text = { Text(s.message) },
            confirmButton = { TextButton(onClick = { PairFlow.dismiss() }) { Text(str(R.string.ok)) } }
        )
        PairFlow.State.Idle -> {}
    }
}

/** Primeiro uso: baixar o cofre do Google Drive ou criar um novo. */
@Composable
fun SetupScreen(activity: FragmentActivity, onReady: () -> Unit) {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var msg by remember { mutableStateOf<String?>(null) }
    var creating by remember { mutableStateOf(!GoogleAuth.configured()) }
    var p1 by remember { mutableStateOf("") }
    var p2 by remember { mutableStateOf("") }

    Column(
        Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text("🔐 MySecrets", style = MaterialTheme.typography.headlineLarge)
        Text(str(R.string.senhas_mfa_e_notas_seguras_o), textAlign = TextAlign.Center)
        if (msg != null) Text(msg!!, color = MaterialTheme.colorScheme.primary, textAlign = TextAlign.Center)
        if (busy) {
            CircularProgressIndicator()
            return@Column
        }
        if (GoogleAuth.configured() && !creating) {
            Button(modifier = Modifier.fillMaxWidth(), onClick = {
                scope.launch {
                    busy = true
                    msg = null
                    try {
                        if (!DriveSync.connected) GoogleAuth.connect(activity)
                        val content = DriveSync.downloadExisting()
                        if (content != null) {
                            Vault.importEncrypted(content)
                            onReady()
                        } else {
                            msg = str(R.string.nenhum_cofre_encontrado_no_google_drive)
                            creating = true
                        }
                    } catch (e: Exception) {
                        msg = e.message
                    } finally {
                        busy = false
                    }
                }
            }) { Text(str(R.string.entrar_com_google_e_baixar_meu)) }
            Text(str(R.string.use_a_mesma_conta_do_google),
                style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center)
            OutlinedButton(modifier = Modifier.fillMaxWidth(), onClick = { creating = true }) { Text(str(R.string.criar_um_cofre_novo)) }
        } else {
            Text(str(R.string.crie_uma_senha_mestra), style = MaterialTheme.typography.titleMedium)
            PasswordField(p1, { p1 = it }, str(R.string.senha_mestra))
            PasswordField(p2, { p2 = it }, str(R.string.confirme_a_senha_mestra))
            Text(if (DriveSync.connected) str(R.string.use_a_mesma_senha_mestra_do) else str(R.string.minimo_de_8_caracteres),
                style = MaterialTheme.typography.bodySmall)
            Button(modifier = Modifier.fillMaxWidth(), enabled = p1.length >= 8 && p1 == p2, onClick = {
                scope.launch {
                    busy = true
                    try {
                        Vault.create(p1)
                        p1 = ""; p2 = ""
                        onReady()
                    } catch (e: Exception) {
                        msg = e.message
                    } finally {
                        busy = false
                    }
                }
            }) { Text(str(R.string.criar_cofre)) }
            if (GoogleAuth.configured()) TextButton(onClick = { creating = false }) { Text(str(R.string.voltar)) }
        }
    }
}
