# MetaIoid Android — R8 / ProGuard rules (release build).
#
# The release build is minified AND shrunk. Every rule below exists because R8
# cannot see the reference by itself; there are no blanket keeps.
#
# Verified by the CI job, which assembles the release APK on every push and
# fails the build if R8 reports a missing class.

# ── kotlinx.serialization ─────────────────────────────────────────────────────
# The compiler plugin generates a synthetic `Companion.serializer()` for every
# @Serializable class. R8 must keep those members, or every DTO fails to
# deserialise in the release build only.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.metaloid.**$$serializer { *; }
-keepclassmembers class com.metaloid.** {
    *** Companion;
}
-keepclasseswithmembers class com.metaloid.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# ── OkHttp / Okio ─────────────────────────────────────────────────────────────
# Optional platform integrations that are legitimately absent on Android.
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
-dontwarn org.slf4j.**
-keepnames class okhttp3.internal.publicsuffix.PublicSuffixDatabase

# ── Coroutines ────────────────────────────────────────────────────────────────
# Coroutines' internals are discovered reflectively for debug tooling only.
-dontwarn kotlinx.coroutines.debug.**

# ── App entry points referenced from the manifest ─────────────────────────────
-keep class com.metaloid.app.MetaIoidApplication { *; }
-keep class com.metaloid.app.MainActivity { *; }

# Keep the file name and line numbers: the app's own crash log needs a readable
# trace, and this is a client that never ships a source-mapping service.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
