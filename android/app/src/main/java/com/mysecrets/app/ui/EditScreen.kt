package com.mysecrets.app.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Casino
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import com.mysecrets.app.otp.Otp
import com.mysecrets.app.vault.Vault
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.security.SecureRandom

fun generatePassword(length: Int = 20): String {
    val sets = listOf("ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#\$%&*-_=+?")
    val all = sets.joinToString("")
    val r = SecureRandom()
    val chars = sets.map { it[r.nextInt(it.length)] }.toMutableList()
    while (chars.size < length) chars += all[r.nextInt(all.length)]
    chars.shuffle(r)
    return chars.joinToString("")
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditScreen(activity: FragmentActivity, id: String?, onDone: (String?) -> Unit) {
    val scope = rememberCoroutineScope()
    val original = id?.let { Vault.find(it) }
    var type by remember { mutableStateOf(original?.optString("type", "login") ?: "login") }
    var title by remember { mutableStateOf(original?.optString("title") ?: "") }
    var url by remember { mutableStateOf(original?.optString("url") ?: "") }
    var username by remember { mutableStateOf(original?.optString("username") ?: "") }
    var password by remember { mutableStateOf(original?.optString("password") ?: "") }
    var mfaSecret by remember { mutableStateOf(original?.optString("mfaSecret") ?: "") }
    var mfaAlgorithm by remember { mutableStateOf(original?.optString("mfaAlgorithm", "totp")?.ifBlank { "totp" } ?: "totp") }
    var mfaDigits by remember { mutableStateOf((original?.optInt("mfaDigits", 6) ?: 6).toString()) }
    var mfaPeriod by remember { mutableStateOf((original?.optInt("mfaPeriod", 30) ?: 30).toString()) }
    var mfaHash by remember { mutableStateOf(original?.optString("mfaHash", "sha1")?.ifBlank { "sha1" } ?: "sha1") }
    var mfaCounter by remember { mutableStateOf((original?.optLong("mfaCounter", 0) ?: 0).toString()) }
    var token by remember { mutableStateOf(original?.optString("token") ?: "") }
    var notes by remember { mutableStateOf(original?.optString("notes") ?: "") }
    var tags by remember {
        mutableStateOf(original?.optJSONArray("tags")?.let { a -> (0 until a.length()).joinToString(", ") { a.optString(it) } } ?: "")
    }
    var favorite by remember { mutableStateOf(original?.optBoolean("favorite") ?: false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun save() {
        if (title.isBlank()) { error = "Digite um título"; return }
        if (type == "mfa" && mfaSecret.isNotBlank()) {
            try { Otp.base32Decode(mfaSecret) } catch (_: Exception) { error = "Segredo MFA inválido (base32)"; return }
        }
        val now = Vault.now()
        // Parte da entrada original (mantém campos que esta tela não edita: anexos, campos extras…)
        val e = original?.let { JSONObject(it.toString()) } ?: JSONObject().put("id", Vault.newId()).put("createdAt", now)
        val oldPass = original?.optString("password") ?: ""
        if (oldPass.isNotEmpty() && oldPass != password) {
            val hist = e.optJSONArray("passwordHistory") ?: JSONArray()
            hist.put(JSONObject().put("password", oldPass).put("changedAt", now))
            val trimmed = JSONArray()
            for (i in maxOf(0, hist.length() - 10) until hist.length()) trimmed.put(hist.get(i))
            e.put("passwordHistory", trimmed)
        }
        e.put("type", type)
            .put("title", title.trim())
            .put("url", url.trim())
            .put("username", username.trim())
            .put("password", password)
            .put("mfaSecret", mfaSecret.trim().replace(" ", ""))
            .put("mfaAlgorithm", mfaAlgorithm)
            .put("mfaDigits", mfaDigits.toIntOrNull() ?: 6)
            .put("mfaPeriod", mfaPeriod.toIntOrNull() ?: 30)
            .put("mfaHash", mfaHash)
            .put("mfaCounter", mfaCounter.toLongOrNull() ?: 0)
            .put("token", token.trim())
            .put("notes", notes.trim())
            .put("tags", JSONArray(tags.split(",").map { it.trim() }.filter { it.isNotEmpty() }))
            .put("favorite", favorite)
            .put("updatedAt", now)
        if (!e.has("linkedMfaId")) e.put("linkedMfaId", "")
        scope.launch {
            Vault.upsert(e)
            onDone(e.getString("id"))
        }
    }

    Scaffold(topBar = {
        TopAppBar(
            title = { Text(if (original == null) "Nova entrada" else "Editar") },
            navigationIcon = { IconButton(onClick = { onDone(id) }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Cancelar") } },
            actions = { IconButton(onClick = ::save) { Icon(Icons.Default.Check, "Salvar") } }
        )
    }) { pad ->
        Column(Modifier.padding(pad).imePadding().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("login", "mfa", "token", "note").forEach { t ->
                    FilterChip(selected = type == t, onClick = { type = t }, label = { Text(typeLabel(t)) })
                }
            }
            if (error != null) Text(error!!, color = androidx.compose.material3.MaterialTheme.colorScheme.error)
            OutlinedTextField(title, { title = it }, label = { Text("Título") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            if (type == "login" || type == "token") {
                OutlinedTextField(url, { url = it }, label = { Text("Site (URL)") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri))
            }
            if (type == "login") {
                OutlinedTextField(username, { username = it }, label = { Text("Usuário / e-mail") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    PasswordField(password, { password = it }, "Senha", Modifier.weight(1f))
                    IconButton(onClick = { password = generatePassword() }) { Icon(Icons.Default.Casino, "Gerar senha") }
                }
            }
            if (type == "mfa") {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(mfaSecret, { mfaSecret = it }, label = { Text("Segredo MFA (base32)") }, singleLine = true, modifier = Modifier.weight(1f))
                    IconButton(onClick = {
                        scope.launch {
                            try {
                                val raw = scanQr(activity) ?: return@launch
                                val o = Otp.parseOtpAuth(raw)
                                if (o == null) { error = "Esse QR code não é de MFA (otpauth://)"; return@launch }
                                mfaSecret = o.secret
                                mfaAlgorithm = o.algorithm
                                mfaDigits = o.digits.toString()
                                mfaPeriod = o.period.toString()
                                mfaHash = o.hash
                                mfaCounter = o.counter.toString()
                                if (title.isBlank()) title = o.issuer.ifBlank { o.label }
                            } catch (e: Exception) { error = e.message }
                        }
                    }) { Icon(Icons.Default.QrCodeScanner, "Ler QR code") }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = mfaAlgorithm == "totp", onClick = { mfaAlgorithm = "totp" }, label = { Text("TOTP") })
                    FilterChip(selected = mfaAlgorithm == "hotp", onClick = { mfaAlgorithm = "hotp" }, label = { Text("HOTP") })
                    listOf("sha1", "sha256", "sha512").forEach { h -> FilterChip(selected = mfaHash == h, onClick = { mfaHash = h }, label = { Text(h.uppercase()) }) }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(mfaDigits, { mfaDigits = it }, label = { Text("Dígitos") }, singleLine = true, modifier = Modifier.weight(1f),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                    if (mfaAlgorithm == "totp") OutlinedTextField(mfaPeriod, { mfaPeriod = it }, label = { Text("Período (s)") }, singleLine = true,
                        modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                    else OutlinedTextField(mfaCounter, { mfaCounter = it }, label = { Text("Contador") }, singleLine = true,
                        modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                }
            }
            if (type == "token") PasswordField(token, { token = it }, "Token")
            OutlinedTextField(notes, { notes = it }, label = { Text("Notas") }, minLines = if (type == "note") 6 else 2, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(tags, { tags = it }, label = { Text("Tags (separadas por vírgula)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(favorite, { favorite = it })
                Text("Favorito")
            }
            if (original?.optJSONArray("attachments")?.length() ?: 0 > 0 || original?.optJSONArray("customFields")?.length() ?: 0 > 0) {
                Text("Anexos e campos extras são mantidos; edite-os no app do PC.", style = androidx.compose.material3.MaterialTheme.typography.bodySmall)
            }
            OutlinedButton(onClick = ::save, modifier = Modifier.fillMaxWidth()) { Text("Salvar") }
        }
    }
}
