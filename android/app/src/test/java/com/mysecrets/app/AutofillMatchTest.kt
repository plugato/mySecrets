package com.mysecrets.app

import com.mysecrets.app.autofill.AssetLinks
import com.mysecrets.app.autofill.AssetLinks.Status
import com.mysecrets.app.autofill.ParsedForm
import com.mysecrets.app.autofill.Structure
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class AutofillMatchTest {
    private fun login(url: String, vararg pkgs: String) = JSONObject().put("type", "login").put("url", url).apply {
        if (pkgs.isNotEmpty()) put("androidPackages", JSONArray(pkgs.toList()))
    }
    private fun form(pkg: String, web: String? = null) = ParsedForm(pkg, web, null, null, null, null, null)
    private val chrome = "com.android.chrome"

    @Test fun navegadorConhecidoUsaWebDomain() {
        assertEquals(90, Structure.score(login("https://github.com"), form(chrome, "github.com")))
        assertEquals(90, Structure.score(login("https://github.com"), form(chrome, "www.github.com")))
        assertEquals(70, Structure.score(login("https://github.com"), form(chrome, "gist.github.com")))
        assertEquals(50, Structure.score(login("https://accounts.google.com"), form(chrome, "mail.google.com")))
        assertEquals(70, Structure.score(login("https://app.exemplo.com.br"), form("org.mozilla.firefox", "exemplo.com.br")))
    }

    @Test fun dominiosParecidosNaoCasam() {
        assertEquals(0, Structure.score(login("https://github.com"), form(chrome, "hub.com")))
        assertEquals(0, Structure.score(login("https://github.com"), form(chrome, "github.com.evil.io")))
        assertEquals(0, Structure.score(login("https://a.github.io"), form(chrome, "b.github.io")))
        assertEquals(0, Structure.score(login("https://exemplo.com.br"), form(chrome, "outro.com.br")))
    }

    @Test fun appQualquerNaoGanhaLoginPeloWebDomain() {
        // App malicioso declara webDomain do banco
        assertEquals(0, Structure.score(login("https://banco.com.br"), form("com.evil.app", "banco.com.br")))
    }

    @Test fun appNativoPeloPacote() {
        assertEquals(40, Structure.score(login("https://www.netflix.com"), form("com.netflix.mediaclient")))
        assertEquals(0, Structure.score(login("https://www.netflix.com"), form("com.evil.netflix")))
        assertEquals(0, Structure.score(login("https://netflix.com"), form("com.netflixfake.app")))
        assertEquals(100, Structure.score(login("https://x.com", "com.meu.app"), form("com.meu.app")))
    }

    // ===== Digital Asset Links =====

    private val certNetflix = "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99"
    private val certOutro = "11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF:11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF"
    private val assetlinks = """[
      {"relation": ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
       "target": {"namespace": "android_app", "package_name": "com.netflix.mediaclient",
                  "sha256_cert_fingerprints": ["$certNetflix"]}},
      {"relation": ["delegate_permission/common.get_login_creds"],
       "target": {"namespace": "web", "site": "https://www.netflix.com"}}
    ]"""

    @Test fun assetLinksConfirmaPacoteECertificado() {
        assertEquals(Status.VERIFIED, AssetLinks.evaluate(assetlinks, "com.netflix.mediaclient", setOf(certNetflix)))
        // Mesmo certificado em minúsculas e sem ":" (como alguns sites publicam)
        assertEquals(Status.VERIFIED, AssetLinks.evaluate(assetlinks, "com.netflix.mediaclient", setOf(certNetflix.replace(":", "").lowercase())))
        // App com o nome certo, mas assinado por outra pessoa
        assertEquals(Status.DENIED, AssetLinks.evaluate(assetlinks, "com.netflix.mediaclient", setOf(certOutro)))
        // Outro pacote com o certificado certo
        assertEquals(Status.DENIED, AssetLinks.evaluate(assetlinks, "com.netflix.falso", setOf(certNetflix)))
    }

    @Test fun assetLinksSemAppsOuInvalidoNaoDecide() {
        assertEquals(Status.UNKNOWN, AssetLinks.evaluate("""[{"relation":["delegate_permission/common.get_login_creds"],"target":{"namespace":"web","site":"https://x.com"}}]""", "com.x", setOf(certNetflix)))
        assertEquals(Status.UNKNOWN, AssetLinks.evaluate("<html>404</html>", "com.x", setOf(certNetflix)))
        assertEquals(Status.UNKNOWN, AssetLinks.evaluate("{}", "com.x", setOf(certNetflix)))
        // Relação que não tem a ver com login não conta
        val outraRelacao = """[{"relation":["delegate_permission/common.use_as_origin"],"target":{"namespace":"android_app","package_name":"com.x","sha256_cert_fingerprints":["$certNetflix"]}}]"""
        assertEquals(Status.UNKNOWN, AssetLinks.evaluate(outraRelacao, "com.x", setOf(certNetflix)))
    }

    @Test fun appNativoComAssetLinks() {
        val netflix = login("https://www.netflix.com")
        val app = form("com.netflix.mediaclient")
        assertEquals(Structure.APP_VERIFIED, Structure.score(netflix, app) { Status.VERIFIED })
        assertEquals(0, Structure.score(netflix, app) { Status.DENIED })
        assertEquals(Structure.APP_UNVERIFIED, Structure.score(netflix, app) { Status.UNKNOWN })
        // A consulta é feita pelo host da entrada
        var consultado: String? = null
        Structure.score(netflix, app) { consultado = it; Status.UNKNOWN }
        assertEquals("netflix.com", consultado)
        // Pacote ligado à entrada vale mais que tudo, mesmo se o site negar
        assertEquals(100, Structure.score(login("https://netflix.com", "com.netflix.mediaclient"), app) { Status.DENIED })
        // Navegador não consulta assetlinks
        assertEquals(90, Structure.score(netflix, form(chrome, "netflix.com")) { Status.DENIED })
    }

    @Test fun ondeProcurarOAssetLinks() {
        assertEquals(listOf("netflix.com", "www.netflix.com"), AssetLinks.candidates("netflix.com"))
        assertEquals(listOf("app.exemplo.com.br", "exemplo.com.br", "www.exemplo.com.br"), AssetLinks.candidates("app.exemplo.com.br"))
        assertEquals(emptyList<String>(), AssetLinks.candidates("localhost"))
    }

    @Test fun impressaoDigitalDoCertificado() {
        // SHA-256 de "abc"
        assertEquals("BA:78:16:BF:8F:01:CF:EA:41:41:40:DE:5D:AE:22:23:B0:03:61:A3:96:17:7A:9C:B4:10:FF:61:F2:00:15:AD",
            AssetLinks.fingerprint("abc".toByteArray()))
    }
}
