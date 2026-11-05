package com.mysecrets.app

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
}
