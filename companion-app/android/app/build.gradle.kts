// M-NEXUS Installer — Android build config.
// v0.29.1: pin Kotlin plugin to 1.9.22 to match shared_preferences_android
// and other plugins compiled with newer Kotlin metadata.
// v0.32: flutter_sound requires minSdk 23+ (we use 23).

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
        versionCode = 12
        versionName = "0.32.0"
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.debug
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
