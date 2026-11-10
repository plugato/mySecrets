package com.mysecrets.app.link

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.mysecrets.app.Settings

/**
 * Push do Firebase só para ACORDAR o app quando o PC pede aprovação com o app
 * fechado. O push não leva segredo nenhum: ao chegar, o app volta a escutar na
 * rede local ([LinkListenService]) e o pedido segue pelo protocolo de sempre.
 *
 * Sem google-services.json no build (desenvolvimento, forks) o Firebase não
 * existe e tudo continua funcionando com o app aberto.
 */
object Push {
    private const val TAG = "MySecretsPush"

    fun available(context: Context): Boolean = try {
        FirebaseApp.getApps(context).isNotEmpty()
    } catch (_: Throwable) { false }

    /** Busca (ou renova) o token deste aparelho. */
    fun init(context: Context) {
        if (!available(context)) return
        try {
            FirebaseMessaging.getInstance().token
                .addOnSuccessListener { if (!it.isNullOrBlank()) Settings.pushToken = it }
                .addOnFailureListener { Log.w(TAG, "sem token de push: ${it.message}") }
        } catch (e: Throwable) {
            Log.w(TAG, "Firebase indisponível: ${e.message}")
        }
    }

    /** O que o celular manda ao PC: o token, ou "" para o PC esquecer. */
    fun tokenForPc(): String = if (Settings.pushEnabled) Settings.pushToken.orEmpty() else ""

    fun notificationsAllowed(context: Context): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /** Android 14+: a tela cheia (acender a tela com o pedido) pode estar negada. */
    fun fullScreenAllowed(context: Context): Boolean =
        Build.VERSION.SDK_INT < 34 || context.getSystemService(NotificationManager::class.java).canUseFullScreenIntent()

    fun requestNotifications(activity: FragmentActivity) {
        if (Build.VERSION.SDK_INT >= 33 && !notificationsAllowed(activity)) {
            activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4310)
        }
    }

    fun openFullScreenSettings(activity: FragmentActivity) {
        if (Build.VERSION.SDK_INT < 34) return
        try {
            activity.startActivity(Intent(android.provider.Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
                Uri.parse("package:${activity.packageName}")))
        } catch (_: Exception) {
            openNotificationSettings(activity)
        }
    }

    fun openNotificationSettings(activity: FragmentActivity) {
        try {
            activity.startActivity(Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, activity.packageName))
        } catch (_: Exception) {}
    }
}
