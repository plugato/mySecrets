import groovy.json.JsonSlurper
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Mesma versão do app desktop (package.json na raiz do repositório)
@Suppress("UNCHECKED_CAST")
val pkg = JsonSlurper().parse(rootProject.file("../package.json")) as Map<String, Any>
val appVersion = pkg["version"] as String
val (vMajor, vMinor, vPatch) = appVersion.split(".").map { it.takeWhile(Char::isDigit).toInt() }

// Login com Google: o mesmo OAuth client do desktop (tipo "app para computador",
// redirecionamento loopback). No CI vem dos secrets GOOGLE_CLIENT_*; em
// desenvolvimento, do src/google-oauth.json gerado para o desktop.
fun googleOAuth(): Pair<String, String> {
    val id = System.getenv("GOOGLE_CLIENT_ID")
    val secret = System.getenv("GOOGLE_CLIENT_SECRET")
    if (!id.isNullOrBlank() && !secret.isNullOrBlank()) return id to secret
    val f = rootProject.file("../src/google-oauth.json")
    if (f.exists()) {
        @Suppress("UNCHECKED_CAST")
        val cfg = JsonSlurper().parse(f) as Map<String, Any>
        return (cfg["clientId"] as? String ?: "") to (cfg["clientSecret"] as? String ?: "")
    }
    return "" to ""
}
val (googleClientId, googleClientSecret) = googleOAuth()

// Assinatura de release: variáveis ANDROID_KEYSTORE_* (CI) ou keystore.properties (local)
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun signingValue(env: String, prop: String): String? =
    System.getenv(env)?.takeIf { it.isNotBlank() } ?: keystoreProps.getProperty(prop)
val releaseStoreFile = signingValue("ANDROID_KEYSTORE_FILE", "storeFile")

fun String.quoted() = "\"" + replace("\\", "\\\\").replace("\"", "\\\"") + "\""

android {
    namespace = "com.mysecrets.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.mysecrets.app"
        minSdk = 28
        targetSdk = 35
        versionCode = vMajor * 10000 + vMinor * 100 + vPatch
        versionName = appVersion
        buildConfigField("String", "GOOGLE_CLIENT_ID", googleClientId.quoted())
        buildConfigField("String", "GOOGLE_CLIENT_SECRET", googleClientSecret.quoted())
    }

    signingConfigs {
        if (releaseStoreFile != null) {
            create("release") {
                storeFile = file(releaseStoreFile)
                storePassword = signingValue("ANDROID_KEYSTORE_PASSWORD", "storePassword")
                keyAlias = signingValue("ANDROID_KEY_ALIAS", "keyAlias")
                keyPassword = signingValue("ANDROID_KEY_PASSWORD", "keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

kotlin {
    jvmToolchain(17)
}

base {
    archivesName.set("MySecrets-$appVersion")
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.05.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("androidx.core:core-ktx:1.19.1")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.fragment:fragment-ktx:1.8.6")
    implementation("androidx.lifecycle:lifecycle-process:2.9.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.0")
    implementation("androidx.biometric:biometric:1.1.0")
    implementation("androidx.autofill:autofill:1.3.0")
    implementation("androidx.browser:browser:1.8.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
}
