package com.mysecrets.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/** Português (values) e inglês (values-en): mesmas chaves e mesmos argumentos. */
class StringsTest {
    private fun ler(pasta: String): Map<String, String> {
        val doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(File("src/main/res/$pasta/strings.xml"))
        val nos = doc.getElementsByTagName("string")
        return (0 until nos.length).associate { i -> nos.item(i).attributes.getNamedItem("name").nodeValue to nos.item(i).textContent }
    }

    private fun args(s: String) = Regex("%\\d+\\$[sd]").findAll(s).map { it.value }.sorted().toList()

    @Test fun mesmasChavesEArgumentos() {
        val pt = ler("values")
        val en = ler("values-en")
        assertEquals("chaves só em um dos idiomas", pt.keys.sorted(), en.keys.sorted())
        for ((k, v) in pt) {
            assertEquals("argumentos de $k", args(v), args(en.getValue(k)))
            assertTrue("tradução vazia: $k", en.getValue(k).isNotBlank())
        }
    }
}
