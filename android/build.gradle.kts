plugins {
    // AGP 9 já traz o Kotlin (sem o plugin org.jetbrains.kotlin.android)
    id("com.android.application") version "9.5.1" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.21" apply false
}
