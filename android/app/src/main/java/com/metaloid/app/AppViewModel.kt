package com.metaloid.app

import android.app.Application
import android.os.Build
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.metaloid.core.common.AppError
import com.metaloid.core.common.MetaLog
import com.metaloid.core.designsystem.SystemStatus
import com.metaloid.core.designsystem.ThemeMode
import com.metaloid.core.network.ApiResult
import com.metaloid.core.session.AuthMode
import com.metaloid.core.session.AuthState
import com.metaloid.core.storage.AppPreferences
import com.metaloid.data.api.SupabaseConfig
import com.metaloid.data.dto.HealthDto
import com.metaloid.di.AppContainer
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import okhttp3.HttpUrl

/**
 * What the app is, as the shell around every screen sees it.
 *
 * Responsibilities, and deliberately nothing else:
 *   * the user's preferences (theme, motion, gateway address);
 *   * the session state, as published by the session manager;
 *   * the *observed* system status (Section 8.11), derived from a real
 *     `/api/health` call plus the device's connectivity — never from config,
 *     never from a timer;
 *   * which identity providers this deployment offers;
 *   * the navigation stack.
 *
 * Chat, memory, files and missions each have their own ViewModel. This one must
 * stay small enough to read in one sitting, because it is the file that decides
 * what the user sees *before* any feature runs.
 */
class AppViewModel(
    application: Application,
    private val container: AppContainer,
) : AndroidViewModel(application) {

    companion object {
        private const val TAG = "app"
        /** Re-check capability on foreground/connectivity change, not on a loop. */
        private const val HEALTH_DEBOUNCE_MS = 1_200L
    }

    val preferences: StateFlow<AppPreferences> = container.preferences.preferences
        .stateIn(viewModelScope, SharingStarted.Eagerly, AppPreferences())

    val authState: StateFlow<AuthState> = container.sessionManager.state

    private val _system = MutableStateFlow(SystemSnapshot())
    val system: StateFlow<SystemSnapshot> = _system.asStateFlow()

    private val _routes = MutableStateFlow<List<Route>>(listOf(Route.Conversations))
    val routes: StateFlow<List<Route>> = _routes.asStateFlow()

    private val _bootstrapComplete = MutableStateFlow(false)
    val bootstrapComplete: StateFlow<Boolean> = _bootstrapComplete.asStateFlow()

    private val connectivity = com.metaloid.core.system.ConnectivityMonitor(application)
    private var healthJob: Job? = null
    private var monitorJob: Job? = null

    val currentRoute: Route get() = _routes.value.lastOrNull() ?: Route.Conversations

    /** True when the release/debug build allows plain-HTTP gateways. */
    val allowCleartext: Boolean get() = BuildConfig.DEBUG

    // ── bootstrap ───────────────────────────────────────────────────────────

    /**
     * The launch sequence (Section 8.11): read the stored address, adopt the
     * stored session, discover what the deployment supports, check health, then
     * hand over. Every step is a real call or a real read — there is no timed
     * pause anywhere in this function.
     */
    fun bootstrap() {
        if (monitorJob != null) return
        monitorJob = viewModelScope.launch {
            // The stored address wins over the build default: the user's choice
            // is the one that persists.
            val stored = preferences.first()
            val gateway = stored.gatewayUrl.ifBlank { BuildConfig.GATEWAY_URL }
            if (gateway.isNotBlank()) container.backendAddress.set(gateway)
            container.buildTimeSupabaseConfig()?.let { container.setSupabaseConfig(it) }
            container.sessionManager.restore()
            // The navigation stack survives a process death: a user who was
            // reading a mission comes back to it, not to the root screen.
            val restored = RouteCodec.decode(stored.routeStack)
            if (restored.isNotEmpty()) {
                _routes.value = restored
                MetaLog.i(TAG, "restored %d route(s) from the previous session", restored.size)
            }
            checkHealth(reason = "launch")
            _bootstrapComplete.value = true
            // Connectivity changes re-evaluate the status; they never poll.
            connectivity.observe().collect { online ->
                if (online) {
                    container.sessionManager.noteOnline()
                    checkHealth(reason = "connectivity")
                } else {
                    container.sessionManager.noteOffline()
                    _system.value = _system.value.copy(
                        status = SystemStatus.Offline,
                        detail = "no network",
                        checkedAtMs = System.currentTimeMillis(),
                    )
                }
            }
        }
    }

    /**
     * Re-checks capabilities and republishes the status line.
     *
     * Debounced, because it is called from foreground/connectivity events that
     * can arrive in bursts. Nothing here is polled on a timer: the gateway's
     * health is re-read when something the user did (or the OS reported) makes
     * the previous answer questionable.
     */
    fun checkHealth(reason: String) {
        if (healthJob?.isActive == true) return
        healthJob = viewModelScope.launch {
            delay(HEALTH_DEBOUNCE_MS)
            val online = connectivity.currentlyOnline()
            if (!online) {
                _system.value = _system.value.copy(
                    status = SystemStatus.Offline,
                    detail = "no network",
                    checkedAtMs = System.currentTimeMillis(),
                )
                return@launch
            }
            // Supabase identifiers may only be known at runtime; fetch them once.
            if (container.supabaseConfig.value == null) {
                when (val config = container.api.publicConfig()) {
                    is ApiResult.Ok -> {
                        val url = config.value.supabaseUrl
                        val anon = config.value.supabaseAnonKey
                        if (!url.isNullOrBlank() && !anon.isNullOrBlank()) {
                            val parsed: HttpUrl? = runCatching { okhttp3.HttpUrl.Companion.toHttpUrl(url) }.getOrNull()
                            if (parsed != null) container.setSupabaseConfig(SupabaseConfig(parsed, anon))
                        }
                    }
                    is ApiResult.Err -> MetaLog.i(TAG, "public config unavailable: %s", config.error.javaClass.simpleName)
                }
            }
            when (val health = container.api.health()) {
                is ApiResult.Ok -> applyHealth(health.value)
                is ApiResult.Err -> {
                    MetaLog.w(TAG, "health check failed (%s): %s", reason, health.error.javaClass.simpleName)
                    _system.value = _system.value.copy(
                        status = SystemStatus.Degraded,
                        detail = health.error.userMessage,
                        lastError = health.error,
                        checkedAtMs = System.currentTimeMillis(),
                    )
                }
            }
        }
    }

    private fun applyHealth(health: HealthDto) {
        val status = when {
            health.ok && health.ai && !health.degraded && health.provider == "openrouter" -> SystemStatus.Live
            // BYOK: the account's own key is the live path even when the shared
            // one is absent. The server reports that as `byok: true`.
            health.ok && health.byok -> SystemStatus.Live
            health.ok && !health.ai -> SystemStatus.Degraded
            health.ok -> SystemStatus.Degraded
            else -> SystemStatus.Degraded
        }
        val detail = buildStatusDetail(health)
        container.setStorageReady(health.storage?.ready == true)
        container.updateAvailableAuthModes(availableAuthModes(health))
        _system.value = SystemSnapshot(
            status = status,
            detail = detail,
            health = health,
            checkedAtMs = System.currentTimeMillis(),
            capabilities = Capabilities.from(health),
        )
    }

    /**
     * What is and is not available, from the server's own report.
     *
     * The UI disables exactly these and explains them; nothing is disabled on a
     * guess.
     */
    private fun buildStatusDetail(health: HealthDto): String? = when {
        !health.ai && health.byok -> "your provider key"
        !health.ai -> "no AI provider connected"
        health.degraded -> "a dependency is failing"
        health.models?.catalogue == false -> "model list unavailable"
        else -> null
    }

    private fun availableAuthModes(health: HealthDto): List<AuthMode> {
        val modes = mutableListOf<AuthMode>()
        if (container.supabaseConfig.value != null) modes += AuthMode.SUPABASE
        // The gateway's own accounts work on any deployment that has local
        // accounts; a production server with Supabase identities reports
        // `auth.configured = true` and keeps the gateway route for admins.
        modes += AuthMode.GATEWAY
        return modes
    }

    // ── preferences ─────────────────────────────────────────────────────────

    fun setThemeMode(mode: ThemeMode) = viewModelScope.launch { container.preferences.setThemeMode(mode) }

    fun setAccent(id: String) = viewModelScope.launch { container.preferences.setAccent(id) }

    fun setReducedMotion(enabled: Boolean?) = viewModelScope.launch { container.preferences.setReducedMotion(enabled) }

    fun setSpeakReplies(enabled: Boolean) = viewModelScope.launch { container.preferences.setSpeakReplies(enabled) }

    fun setTtsRate(rate: Float) = viewModelScope.launch { container.preferences.setTtsRate(rate) }

    fun setVoiceLocale(tag: String?) = viewModelScope.launch { container.preferences.setVoiceLocale(tag) }

    fun setLastConversation(id: String?) = viewModelScope.launch { container.preferences.setLastConversation(id) }

    // ── backend address ─────────────────────────────────────────────────────

    /**
     * Validates and stores the gateway address, then re-runs discovery.
     *
     * Returns the validation result so the screen can show a specific problem
     * instead of "invalid".
     */
    fun setGatewayUrl(raw: String): com.metaloid.core.backend.BackendValidation {
        val result = container.backendAddress.set(raw)
        if (result is com.metaloid.core.backend.BackendValidation.Ok) {
            viewModelScope.launch {
                container.preferences.setGatewayUrl(result.url.toString())
                checkHealth(reason = "manual")
            }
        }
        return result
    }

    fun gatewayUrl(): String = container.backendAddress.current()?.toString().orEmpty()

    // ── navigation ──────────────────────────────────────────────────────────

    fun navigate(route: Route) {
        val current = _routes.value.lastOrNull()
        if (current == route) return
        publish(_routes.value + route)
    }

    /** Goes back one step; returns false at the root, so the system handles it. */
    fun back(): Boolean {
        val stack = _routes.value
        if (stack.size <= 1) return false
        publish(stack.dropLast(1))
        return true
    }

    fun resetTo(route: Route) {
        publish(listOf(route))
    }

    private fun publish(stack: List<Route>) {
        _routes.value = stack
        viewModelScope.launch {
            // Encoded by hand (`RouteCodec`), so this file is the only place that
            // knows how a route is spelled on disk.
            container.preferences.setRouteStack(RouteCodec.encode(stack))
        }
    }

    /** Sign-out: wipe the session and everything account-scoped on the device. */
    fun signOut() = viewModelScope.launch {
        container.sessionManager.signOut()
        container.conversations.clearCache()
        container.preferences.clearAccountScoped()
        _routes.value = listOf(Route.Conversations)
        checkHealth(reason = "signout")
    }

    fun signOutEverywhere() = viewModelScope.launch {
        container.sessionManager.signOut(everywhere = true)
        container.conversations.clearCache()
        container.preferences.clearAccountScoped()
        _routes.value = listOf(Route.Conversations)
    }

    fun diagnostics(): String = MetaLog.diagnostics(
        appVersion = "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})",
        gatewayHost = container.backendAddress.current()?.host ?: "not configured",
        accountLabel = container.sessionManager.current()?.label,
    )

    fun deviceSummary(): String = "${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})"

    val serverBuild: String? get() = _system.value.health?.build
}

/**
 * The status line's data.
 *
 * [status] is derived from a real check; [detail] explains a non-LIVE state in
 * the server's own terms ("no AI provider connected"), never in invented ones.
 */
data class SystemSnapshot(
    val status: SystemStatus = SystemStatus.Checking,
    val detail: String? = null,
    val health: HealthDto? = null,
    val checkedAtMs: Long? = null,
    val lastError: AppError? = null,
    val capabilities: Capabilities = Capabilities(),
)

/**
 * Which features this deployment can actually serve, from `/api/health`.
 *
 * A capability is true only when the server reported it (or when it is a
 * device-side feature the app verified for itself). Research defaults to false
 * until the server answers, because offering a feature that cannot run is a
 * promise the app cannot keep.
 */
data class Capabilities(
    val chat: Boolean = false,
    val memory: Boolean = true,
    val files: Boolean = false,
    val research: Boolean = false,
    val missions: Boolean = true,
    val voice: Boolean = false,
) {
    companion object {
        fun from(health: HealthDto): Capabilities = Capabilities(
            // Chat needs a provider path: either the shared one or the user's own.
            chat = health.ai || health.byok,
            memory = health.database,
            files = health.storage?.ready == true,
            // Research rides the same provider path plus the data store.
            research = (health.ai || health.byok) && health.database,
            missions = (health.ai || health.byok) && health.database,
            voice = health.voice,
        )
    }
}
