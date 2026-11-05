package com.mysecrets.app.ui

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import android.widget.Toast
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.mysecrets.app.Settings
import com.mysecrets.app.crypto.Biometric
import com.mysecrets.app.crypto.Keys
import com.mysecrets.app.vault.Vault
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

private val Purple = Color(0xFF6D4AE0)

@Composable
fun MySecretsTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val ctx = LocalContext.current
    val scheme: ColorScheme = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> if (dark) dynamicDarkColorScheme(ctx) else dynamicLightColorScheme(ctx)
        dark -> darkColorScheme(primary = Color(0xFFCBBEFF), secondary = Color(0xFFCAC3DC))
        else -> lightColorScheme(primary = Purple, secondary = Color(0xFF625B71))
    }
    MaterialTheme(colorScheme = scheme, content = content)
}

fun toast(ctx: Context, msg: String) = Toast.makeText(ctx, msg, Toast.LENGTH_SHORT).show()

/** Copia marcando como sensível e limpa depois do tempo configurado. */
fun copySecret(ctx: Context, label: String, text: String) {
    val cm = ctx.getSystemService(ClipboardManager::class.java)
    val clip = ClipData.newPlainText(label, text)
    clip.description.extras = PersistableBundle().apply {
        putBoolean(if (Build.VERSION.SDK_INT >= 33) ClipDescription.EXTRA_IS_SENSITIVE else "android.content.extra.IS_SENSITIVE", true)
    }
    cm.setPrimaryClip(clip)
    if (Build.VERSION.SDK_INT < 33) toast(ctx, "$label copiado")
    val segundos = Settings.clipboardClearSeconds
    if (segundos > 0) {
        Handler(Looper.getMainLooper()).postDelayed({
            try {
                val atual = cm.primaryClip?.getItemAt(0)?.text?.toString()
                if (atual == null || atual == text) cm.clearPrimaryClip()
            } catch (_: Exception) {}
        }, segundos * 1000L)
    }
}

/** Lê um QR code pela câmera (scanner do Google Play Services, sem permissão de câmera). */
suspend fun scanQr(ctx: Context): String? = com.mysecrets.app.MySecretsApp.duringExternalFlow { scanQrRaw(ctx) }

private suspend fun scanQrRaw(ctx: Context): String? = suspendCancellableCoroutine { cont ->
    val opts = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
    GmsBarcodeScanning.getClient(ctx, opts).startScan()
        .addOnSuccessListener { cont.resume(it.rawValue) }
        .addOnCanceledListener { cont.resume(null) }
        .addOnFailureListener { cont.resumeWithException(Exception("Não foi possível abrir o leitor de QR code: ${it.message}")) }
}

fun bioUnlockEnabled(): Boolean = Settings.bioUnlockBlob != null

/** Desbloqueia com a digital (senha mestra guardada sob a chave biométrica). */
suspend fun unlockWithBiometric(activity: FragmentActivity) {
    val blob = Settings.bioUnlockBlob ?: error("Digital não configurada")
    val cipher = try {
        Keys.bioDecryptCipher(Keys.BIO_UNLOCK, blob)
    } catch (e: Keys.InvalidatedException) {
        Settings.bioUnlockBlob = null
        throw e
    }
    val ok = Biometric.authenticate(activity, cipher, "Desbloquear o MySecrets")
    val pass = String(Keys.finishOpen(ok, blob), Charsets.UTF_8)
    try {
        Vault.unlock(pass)
    } catch (e: Vault.WrongPassword) {
        Settings.bioUnlockBlob = null
        throw Exception("A senha guardada para a digital não abre mais o cofre. Entre com a senha mestra.")
    }
}

/** Ativa a digital: cifra a senha mestra atual com a chave biométrica. */
suspend fun enableBiometric(activity: FragmentActivity) {
    val pass = Vault.currentPassword() ?: error("Cofre bloqueado")
    val cipher = Keys.bioEncryptCipher(Keys.BIO_UNLOCK)
    val ok = Biometric.authenticate(activity, cipher, "Ativar desbloqueio por digital")
    Settings.bioUnlockBlob = Keys.finishSeal(ok, pass.toByteArray(Charsets.UTF_8))
}

@Composable
fun PasswordField(value: String, onChange: (String) -> Unit, label: String, modifier: Modifier = Modifier, onDone: (() -> Unit)? = null) {
    var show by remember { mutableStateOf(false) }
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label) },
        singleLine = true,
        visualTransformation = if (show) VisualTransformation.None else PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = if (onDone != null) ImeAction.Done else ImeAction.Next),
        keyboardActions = KeyboardActions(onDone = { onDone?.invoke() }),
        trailingIcon = {
            IconButton(onClick = { show = !show }) {
                Icon(if (show) Icons.Default.VisibilityOff else Icons.Default.Visibility, contentDescription = if (show) "Ocultar" else "Mostrar")
            }
        },
        modifier = modifier.fillMaxWidth()
    )
}

/** Painel de desbloqueio (senha mestra ou digital), usado no app e no autofill. */
@Composable
fun UnlockPanel(activity: FragmentActivity, autoBiometric: Boolean = true, onUnlocked: () -> Unit) {
    val scope = rememberCoroutineScope()
    var pass by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun bio() {
        if (busy) return
        scope.launch {
            busy = true
            error = null
            try {
                unlockWithBiometric(activity)
                onUnlocked()
            } catch (e: Biometric.Cancelled) {
            } catch (e: Exception) {
                error = e.message
            } finally {
                busy = false
            }
        }
    }

    fun submit() {
        if (busy || pass.isEmpty()) return
        scope.launch {
            busy = true
            error = null
            try {
                Vault.unlock(pass)
                pass = ""
                onUnlocked()
            } catch (e: Exception) {
                error = e.message
            } finally {
                busy = false
            }
        }
    }

    LaunchedEffect(Unit) { if (autoBiometric && bioUnlockEnabled() && Biometric.available(activity)) bio() }

    Column(Modifier.fillMaxWidth().padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text("🔐 MySecrets", style = MaterialTheme.typography.headlineMedium)
        Text("Digite sua senha mestra", style = MaterialTheme.typography.bodyMedium)
        PasswordField(pass, { pass = it }, "Senha mestra", onDone = ::submit)
        if (error != null) Text(error!!, color = MaterialTheme.colorScheme.error)
        if (busy) {
            CircularProgressIndicator()
        } else {
            Button(onClick = ::submit, modifier = Modifier.fillMaxWidth(), enabled = pass.isNotEmpty()) { Text("Desbloquear") }
            if (bioUnlockEnabled()) {
                OutlinedButton(onClick = ::bio, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Default.Fingerprint, null)
                    Spacer(Modifier.padding(4.dp))
                    Text("Usar digital")
                }
            }
        }
        Spacer(Modifier.height(8.dp))
    }
}

fun entryTitle(e: org.json.JSONObject): String =
    e.optString("title").ifBlank { com.mysecrets.app.autofill.Structure.hostOf(e.optString("url")) ?: "(sem título)" }

fun typeLabel(type: String) = when (type) {
    "login" -> "Login"
    "mfa" -> "MFA"
    "token" -> "Token"
    "note" -> "Nota segura"
    else -> type
}
