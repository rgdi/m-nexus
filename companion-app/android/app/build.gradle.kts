// M-NEXUS Installer — Android build config.
// v0.29.1: pin Kotlin plugin to 1.9.22 to match shared_preferences_android
// and other plugins compiled with newer Kotlin metadata.
// v0.32: use a fixed release keystore (key.properties) so that the
// APK is recognized as an UPDATE, not a new app, on user devices.

import java.util.Properties
import java.io.FileInputStream

buildscript {
    ext.kotlin_version = "1.9.22"
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath "org.jetbrains.kotlin:kotlin-gradle-plugin:$kotlin_version"
    }
}

plugins {
    id "com.android.application"
    id "kotlin-android"
    id "dev.flutter.flutter-gradle-plugin"
}

// v0.32: Load the release keystore credentials from key.properties.
// If the file is missing, we fall back to the debug keystore (and log a
// warning), but production builds should always have this file.
val keystorePropertiesFile = rootProject.file("key.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) {
        load(FileInputStream(keystorePropertiesFile))
    }
}
val hasReleaseKey = keystorePropertiesFile.exists() &&
    keystoreProperties.getProperty("storeFile") != null

android {
    namespace = "com.mnexus.installer"
    compileSdk = 34
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        applicationId = "com.mnexus.installer"
        minSdk = 23
        targetSdk = 34
        versionCode = 21
        versionName = "0.40.0"
    }

    // v0.32: signing config from the fixed release keystore.
    // This makes the APK signature consistent across builds, so Android
    // recognizes each new release as an UPDATE, not as a new app.
    signingConfigs {
        create("release") {
            if (hasReleaseKey) {
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (hasReleaseKey) {
                signingConfigs.getByName("release")
            } else {
                println("WARNING: key.properties not found, falling back to debug signing")
                signingConfigs.getByName("debug")
            }
            minifyEnabled = false
            shrinkResources = false
        }
    }
}

flutter {
    source = "../.."
}

dependencies {
    implementation "androidx.activity:activity:1.9.0"
    implementation "androidx.core:core-ktx:1.13.1"
}
