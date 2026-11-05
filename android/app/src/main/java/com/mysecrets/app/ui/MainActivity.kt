package com.mysecrets.app.ui

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
                    Text("Dica: em Configurações você pode entrar com Google para sincronizar com o PC.",
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

    if (offerBio && unlocked) {
        val scope = rememberCoroutineScope()
        AlertDialog(
            onDismissRequest = { offerBio = false },
            title = { Text("Desbloquear com a digital?") },
            text = { Text("Na próxima vez você abre o MySecrets (e o preenchimento automático) só encostando o dedo.") },
            confirmButton = {
                Button(onClick = {
                    offerBio = false
                    scope.launch {
                        try { enableBiometric(activity) } catch (e: Exception) { if (e !is Biometric.Cancelled) toast(activity, e.message ?: "Erro") }
                    }
                }) { Text("Ativar") }
            },
            dismissButton = { TextButton(onClick = { offerBio = false; Settings.bioOfferDeclined = true }) { Text("Agora não") } }
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
                title = { Text(if (done) "✅ Pareado" else "Quase lá") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(if (done) "Pronto! Na tela de login do ${s.desktopName}, clique em \"Aprovar pelo celular\"."
                        else "Aguardando o ${s.desktopName} encontrar este celular na rede Wi-Fi… Mantenha o app aberto.")
                        if (!done) {
                            Text("Este celular: ${localIp() ?: "sem Wi-Fi?"} · ${if (LinkServer.listening) "escutando" else "NÃO está escutando"} na porta ${com.mysecrets.app.link.LinkProtocol.PORT}",
                                style = MaterialTheme.typography.bodySmall)
                            Text("Último contato do PC: ${last ?: "nenhum ainda"}", style = MaterialTheme.typography.bodySmall)
                        }
                    }
                },
                confirmButton = { TextButton(onClick = { PairFlow.dismiss() }) { Text(if (done) "OK" else "Fechar") } }
            )
        }
        is PairFlow.State.Error -> AlertDialog(
            onDismissRequest = { PairFlow.dismiss() },
            title = { Text("Pareamento") },
            text = { Text(s.message) },
            confirmButton = { TextButton(onClick = { PairFlow.dismiss() }) { Text("OK") } }
        )
        PairFlow.State.Idle -> {}
    }
}

@Composable
fun ApprovalDialog(activity: FragmentActivity) {
    val req by LinkServer.request.collectAsState()
    val r = req ?: return
    val scope = rememberCoroutineScope()
    var error by remember(r) { mutableStateOf<String?>(null) }
    var busy by remember(r) { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = {},
        title = { Text("Desbloquear o PC?") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("${r.desktopName} quer abrir o MySecrets.")
                Text("Confira se o código é o mesmo da tela do PC:")
                Text(r.code, fontSize = 32.sp, fontWeight = FontWeight.Bold, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
                if (error != null) Text(error!!, color = MaterialTheme.colorScheme.error)
            }
        },
        confirmButton = {
            Button(enabled = !busy, onClick = {
                scope.launch {
                    busy = true
                    error = null
                    try {
                        val pc = Pairings.find(r.pairId) ?: error("Pareamento não encontrado")
                        val cipher = Keys.bioDecryptCipher(Keys.BIO_LINK, pc.unlockSealed)
                        val ok = Biometric.authenticate(activity, cipher, "Aprovar login no ${r.desktopName}", "Código ${r.code}")
                        r.answer.complete(Keys.finishOpen(ok, pc.unlockSealed))
                        toast(activity, "Login aprovado")
                    } catch (e: Biometric.Cancelled) {
                    } catch (e: Keys.InvalidatedException) {
                        error = "As digitais do aparelho mudaram. Remova e pareie este PC de novo."
                    } catch (e: Exception) {
                        error = e.message
                    } finally {
                        busy = false
                    }
                }
            }) { Text("Aprovar com digital") }
        },
        dismissButton = { TextButton(onClick = { r.answer.complete(null) }) { Text("Negar") } }
    )
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
        Text("Senhas, MFA e notas seguras — o mesmo cofre do seu PC.", textAlign = TextAlign.Center)
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
                        if (!DriveSync.connected) DriveSync.saveAccount(GoogleAuth.authorize(activity))
                        val content = DriveSync.downloadExisting()
                        if (content != null) {
                            Vault.importEncrypted(content)
                            onReady()
                        } else {
                            msg = "Nenhum cofre encontrado no Google Drive desta conta. Crie um novo — ele será enviado ao Drive."
                            creating = true
                        }
                    } catch (e: Exception) {
                        msg = e.message
                    } finally {
                        busy = false
                    }
                }
            }) { Text("Entrar com Google e baixar meu cofre") }
            Text("Use a mesma conta do Google que está em Configurações > Sincronização no PC.",
                style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center)
            OutlinedButton(modifier = Modifier.fillMaxWidth(), onClick = { creating = true }) { Text("Criar um cofre novo") }
        } else {
            Text("Crie uma senha mestra", style = MaterialTheme.typography.titleMedium)
            PasswordField(p1, { p1 = it }, "Senha mestra")
            PasswordField(p2, { p2 = it }, "Confirme a senha mestra")
            Text(if (DriveSync.connected) "Use a MESMA senha mestra do PC para sincronizar." else "Mínimo de 8 caracteres.",
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
            }) { Text("Criar cofre") }
            if (GoogleAuth.configured()) TextButton(onClick = { creating = false }) { Text("Voltar") }
        }
    }
}
