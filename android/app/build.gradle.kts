import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

/**
 * Public, non-secret build configuration.
 *
 * Resolution order: -P flag → environment variable → local.properties → empty.
 * Only *public* identifiers are allowed here (the gateway URL and, if used, the
 * Supabase project URL and its public anon key). Secrets are refused by design:
 * there is no code path in this build that can read a service-role key, a JWT
 * secret, an encryption key or a provider API key, and the release checklist
 * scans the built APK to prove none is bundled.
 */
fun publicConfig(
    property: String,
    env: String,
    fallback: String = "",
): String {
    (project.findProperty(property) as String?)?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
    System.getenv(env)?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
    val localFile = rootProject.file("local.properties")
    if (localFile.exists()) {
        val props = Properties()
        localFile.inputStream().use(props::load)
        props.getProperty(property)?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
    }
    return fallback
}

val gatewayUrl: String = publicConfig("metaloid.gatewayUrl", "METALOID_GATEWAY_URL")
val supabaseUrl: String = publicConfig("metaloid.supabaseUrl", "METALOID_SUPABASE_URL")
val supabaseAnonKey: String = publicConfig("metaloid.supabaseAnonKey", "METALOID_SUPABASE_ANON_KEY")

/** Escape a value for a Java string literal in BuildConfig. */
fun quoted(value: String): String = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

android {
    namespace = "com.metaloid.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.metaloid.app"
        minSdk = 26
        targetSdk = 34
        // apk-v3 is 2/1.0.1; V4 increments the versionCode to 3. An in-place
        // update still requires the same signing certificate — see RELEASE.md.
        versionCode = 3
        versionName = "1.0.2"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables { useSupportLibrary = true }

        buildConfigField("String", "GATEWAY_URL", quoted(gatewayUrl))
        buildConfigField("String", "SUPABASE_URL", quoted(supabaseUrl))
        buildConfigField("String", "SUPABASE_ANON_KEY", quoted(supabaseAnonKey))
    }

    signingConfigs {
        // A real keystore is optional. When the CI secrets are present the
        // release build is signed with them; otherwise it falls back to the
        // debug key so that every build produces an *installable* artifact.
        // docs/android/RELEASE.md explains how to produce a store-ready one.
        val keystorePath = System.getenv("METALOID_KEYSTORE")
        if (!keystorePath.isNullOrEmpty()) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        getByName("debug") {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            isMinifyEnabled = false
            buildConfigField("String", "BUILD_TYPE_NAME", quoted("debug"))
        }
        getByName("release") {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            buildConfigField("String", "BUILD_TYPE_NAME", quoted("release"))
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        unitTests {
            isReturnDefaultValues = true
            isIncludeAndroidResources = false
        }
    }

    lint {
        abortOnError = true
        // Only this module's code is linted; third-party sources are not this
        // project's to fix, and linting them turns their warnings into our
        // build failures.
        checkDependencies = false
        warningsAsErrors = false
        // A baseline file would hide exactly the defects this project exists to
        // avoid, so there is none.
        baseline = null
        xmlReport = true
        htmlReport = true
    }

    packaging {
        resources {
            excludes += setOf(
                "/META-INF/{AL2.0,LGPL2.1}",
                "/META-INF/DEPENDENCIES",
                "/META-INF/INDEX.LIST",
                "META-INF/*.kotlin_module",
            )
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.datastore.preferences)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons.core)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)

    implementation(libs.okhttp)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)

    androidTestImplementation(libs.androidx.test.junit)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.rules)
    androidTestImplementation(libs.espresso.core)
    androidTestImplementation(libs.uiautomator)
    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(libs.compose.ui.test.junit4)
    debugImplementation(libs.compose.ui.test.manifest)
}
