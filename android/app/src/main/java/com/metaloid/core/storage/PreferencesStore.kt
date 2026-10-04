package com.metaloid.core.storage

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.metaloid.core.designsystem.ThemeMode
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * Non-secret preferences: theme, motion override, the gateway address, the last
 * conversation the user was reading, drafts.
 *
 * DataStore, not SharedPreferences, for one reason that matters: its writes are
 * transactional and it will not silently corrupt on a process death during a
 * write. It is *not* used for anything secret — the session lives in encrypted
 * file storage (`SecretFileVault`) and never here.
 */
private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "metaloid_prefs")

data class AppPreferences(
    val gatewayUrl: String = "",
    val themeMode: ThemeMode = ThemeMode.SYSTEM,
    val accentId: String = "jade",
    /** Null means "follow the system"; true/false is an explicit user override. */
    val reducedMotionOverride: Boolean? = null,
    val lastConversationId: String? = null,
    val voiceLocale: String? = null,
    val ttsRate: Float = 1.0f,
    val speakReplies: Boolean = false,
    /** Set once the user has actually finished the first-run flow. */
    val onboardingComplete: Boolean = false,
    /** The navigation stack, encoded by `RouteCodec`; empty means "the root". */
    val routeStack: String = "",
)

class PreferencesStore(private val context: Context) {

    private object Keys {
        val gatewayUrl = stringPreferencesKey("gateway_url")
        val themeMode = stringPreferencesKey("theme_mode")
        val accentId = stringPreferencesKey("accent_id")
        val reducedMotion = stringPreferencesKey("reduced_motion")
        val lastConversation = stringPreferencesKey("last_conversation")
        val voiceLocale = stringPreferencesKey("voice_locale")
        val ttsRate = floatPreferencesKey("tts_rate")
        val speakReplies = booleanPreferencesKey("speak_replies")
        val onboarding = booleanPreferencesKey("onboarding_complete")
        val routeStack = stringPreferencesKey("route_stack")
    }

    val preferences: Flow<AppPreferences> = context.dataStore.data.map { prefs ->
        AppPreferences(
            gatewayUrl = prefs[Keys.gatewayUrl] ?: "",
            themeMode = prefs[Keys.themeMode]?.let { stored ->
                ThemeMode.entries.firstOrNull { it.name == stored }
            } ?: ThemeMode.SYSTEM,
            accentId = prefs[Keys.accentId] ?: "jade",
            reducedMotionOverride = prefs[Keys.reducedMotion]?.toBooleanStrictOrNull(),
            lastConversationId = prefs[Keys.lastConversation],
            voiceLocale = prefs[Keys.voiceLocale],
            ttsRate = prefs[Keys.ttsRate] ?: 1.0f,
            speakReplies = prefs[Keys.speakReplies] ?: false,
            onboardingComplete = prefs[Keys.onboarding] ?: false,
            routeStack = prefs[Keys.routeStack] ?: "",
        )
    }

    suspend fun setGatewayUrl(value: String) = edit { it[Keys.gatewayUrl] = value }

    suspend fun setThemeMode(mode: ThemeMode) = edit { it[Keys.themeMode] = mode.name }

    suspend fun setAccent(id: String) = edit { it[Keys.accentId] = id }

    suspend fun setReducedMotion(enabled: Boolean?) = edit { prefs ->
        if (enabled == null) prefs.remove(Keys.reducedMotion) else prefs[Keys.reducedMotion] = enabled.toString()
    }

    suspend fun setLastConversation(id: String?) = edit { prefs ->
        if (id == null) prefs.remove(Keys.lastConversation) else prefs[Keys.lastConversation] = id
    }

    suspend fun setVoiceLocale(tag: String?) = edit { prefs ->
        if (tag == null) prefs.remove(Keys.voiceLocale) else prefs[Keys.voiceLocale] = tag
    }

    suspend fun setTtsRate(rate: Float) = edit { it[Keys.ttsRate] = rate }

    suspend fun setSpeakReplies(enabled: Boolean) = edit { it[Keys.speakReplies] = enabled }

    suspend fun setOnboardingComplete() = edit { it[Keys.onboarding] = true }

    suspend fun setRouteStack(encoded: String) = edit { it[Keys.routeStack] = encoded }

    /** Used on sign-out: everything that belongs to the account, gone. */
    suspend fun clearAccountScoped() = edit { prefs ->
        prefs.remove(Keys.lastConversation)
        prefs.remove(Keys.onboarding)
        prefs.remove(Keys.routeStack)
    }

    private suspend fun edit(block: (androidx.datastore.preferences.core.MutablePreferences) -> Unit) {
        context.dataStore.edit(block)
    }
}
