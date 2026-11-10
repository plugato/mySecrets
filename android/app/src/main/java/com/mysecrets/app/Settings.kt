package com.mysecrets.app

import android.content.Context
import android.content.SharedPreferences

/** Preferências simples do app (nada sensível em texto puro). */
object Settings {
    private lateinit var prefs: SharedPreferences

    fun init(context: Context) {
        prefs = context.getSharedPreferences("settings", Context.MODE_PRIVATE)
    }

    /** Bloquear depois de X segundos fora do app (0 = ao sair). */
    var autoLockSeconds: Int
        get() = prefs.getInt("autoLockSeconds", 60)
        set(v) = prefs.edit().putInt("autoLockSeconds", v).apply()

    var clipboardClearSeconds: Int
        get() = prefs.getInt("clipboardClearSeconds", 30)
        set(v) = prefs.edit().putInt("clipboardClearSeconds", v).apply()

    /** Senha mestra cifrada com a chave biométrica (desbloqueio por digital). */
    var bioUnlockBlob: String?
        get() = prefs.getString("bioUnlockBlob", null)
        set(v) = prefs.edit().putString("bioUnlockBlob", v).apply()

    var bioOfferDeclined: Boolean
        get() = prefs.getBoolean("bioOfferDeclined", false)
        set(v) = prefs.edit().putBoolean("bioOfferDeclined", v).apply()

    /** O PC pode acordar o app por push (Firebase) para pedir aprovação com o app fechado. */
    var pushEnabled: Boolean
        get() = prefs.getBoolean("pushEnabled", true)
        set(v) = prefs.edit().putBoolean("pushEnabled", v).apply()

    /** Token do Firebase Cloud Messaging deste aparelho (o PC recebe pela rede local). */
    var pushToken: String?
        get() = prefs.getString("pushToken", null)
        set(v) = prefs.edit().putString("pushToken", v).apply()
}
