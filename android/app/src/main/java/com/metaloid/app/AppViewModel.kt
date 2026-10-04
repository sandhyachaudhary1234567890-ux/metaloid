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
import okhttp3.HttpUrl.Companion.toHttpUrl

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
        private const val AI_ACCESS_DEBOUNCE_MS = 1_500L
    }

    val preferences: StateFlow<AppPreferences> = container.preferences.preferences
        .stateIn(viewModelScope, SharingStarted.Eagerly, AppPreferences())

    val authState: StateFlow<AuthState> = container.sessionManager.state

    private val _system = MutableStateFlow(SystemSnapshot())
    val system: StateFlow<SystemSnapshot> = _system.asStateFlow()

    private val _aiAccess = MutableStateFlow<AiAccessState>(AiAccessState.Checking)
    val aiAccess: StateFlow<AiAccessState> = _aiAccess.asStateFlow()

    private val _routes = MutableStateFlow<List<Route>>(listOf(Route.Conversations))
    val routes: StateFlow<List<Route>> = _routes.asStateFlow()

    private val _bootstrapComplete = MutableStateFlow(false)
    val bootstrapComplete: StateFlow<Boolean> = _bootstrapComplete.asStateFlow()

    private val connectivity = container.connectivity
    private var healthJob: Job? = null
    private var monitorJob: Job? = null
    private var authObserveJob: Job? = null
    private var providerAccessJob: Job? = null
    private var lastProviderAccessCheckAtMs: Long = 0L
    private var observedUserId: String? = null

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
            observeAiAccessInputs()
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
                    refreshProviderAccess(reason = "connectivity", force = true)
                } else {
                    container.sessionManager.noteOffline()
                    providerAccessJob?.cancel()
                    _aiAccess.value = AiAccessState.Offline
                    _system.value = _system.value.copy(
                        status = SystemStatus.Offline,
                        detail = "no network",
                        checkedAtMs = System.currentTimeMillis(),
                    )
                }
            }
        }
    }

    private fun observeAiAccessInputs() {
        if (authObserveJob?.isActive == true) return
        authObserveJob = viewModelScope.launch {
            authState.collect { auth ->
                when (auth) {
                    is AuthState.SignedIn -> {
                        val changedAccount = observedUserId != auth.session.userId
                        observedUserId = auth.session.userId
                        if (changedAccount || _aiAccess.value == AiAccessState.Offline ||
                            _aiAccess.value == AiAccessState.NotSignedIn || _aiAccess.value == AiAccessState.Checking
                        ) {
                            refreshProviderAccess(reason = "session", force = true)
                        }
                    }
                    is AuthState.Offline -> {
                        observedUserId = auth.session.userId
                        providerAccessJob?.cancel()
                        _aiAccess.value = AiAccessState.Offline
                    }
                    else -> {
                        observedUserId = null
                        providerAccessJob?.cancel()
                        _aiAccess.value = AiAccessState.NotSignedIn
                    }
                }
            }
        }
    }

    /**
     * Runs a real backend/provider readiness check for the signed-in account.
     * Health alone is not enough: BYOK readiness also requires a previously
     * successful adapter test recorded for that user's credential.
     */
    fun refreshProviderAccess(reason: String = "manual", force: Boolean = false) {
        if (container.sessionManager.state.value !is AuthState.SignedIn) {
            if (container.sessionManager.state.value is AuthState.Offline) _aiAccess.value = AiAccessState.Offline
            return
        }
        if (!connectivity.currentlyOnline()) {
            _aiAccess.value = AiAccessState.Offline
            return
        }
        val now = System.currentTimeMillis()
        if (providerAccessJob?.isActive == true) {
            if (!force) return
            providerAccessJob?.cancel()
        }
        if (!force && now - lastProviderAccessCheckAtMs < AI_ACCESS_DEBOUNCE_MS) return

        providerAccessJob = viewModelScope.launch {
            lastProviderAccessCheckAtMs = System.currentTimeMillis()
            _aiAccess.value = AiAccessState.Checking
            val health = when (val healthResult = container.api.health()) {
                is ApiResult.Err -> {
                    MetaLog.w(TAG, "AI readiness check failed (%s): %s", reason, healthResult.error.javaClass.simpleName)
                    _aiAccess.value = AiAccessState.Unavailable(healthResult.error)
                    return@launch
                }
                is ApiResult.Ok -> healthResult.value.also(::applyHealth)
            }
            val credentials = when (val result = container.api.providerCredentialMetadata()) {
                is ApiResult.Ok -> result.value.credentials
                is ApiResult.Err -> {
                    MetaLog.w(TAG, "provider metadata check failed: %s", result.error.javaClass.simpleName)
                    _aiAccess.value = AiAccessState.Unavailable(result.error)
                    return@launch
                }
            }

            if (AiReadinessPolicy.hasRealSharedProvider(health)) {
                verifySelectedModel(health, credentials)
                return@launch
            }

            val verified = AiReadinessPolicy.verifiedCredential(health, credentials)
            if (verified != null) {
                verifySelectedModel(health, credentials)
                return@launch
            }

            val setup = AiReadinessPolicy.issue(health, credentials)
            if (setup.issue == ProviderSetupIssue.NeedsVerification && !setup.credentialId.isNullOrBlank()) {
                when (val test = container.api.testProviderCredential(setup.credentialId)) {
                    is ApiResult.Ok -> {
                        if (test.value.ok && AiReadinessPolicy.verifiedTestStatus(test.value.status)) {
                            val refreshedHealth = (container.api.health() as? ApiResult.Ok)?.value
                            val refreshedCredentials = (container.api.providerCredentialMetadata() as? ApiResult.Ok)?.value?.credentials
                            if (refreshedHealth != null && refreshedCredentials != null &&
                                (AiReadinessPolicy.hasRealSharedProvider(refreshedHealth) ||
                                    AiReadinessPolicy.verifiedCredential(refreshedHealth, refreshedCredentials) != null)
                            ) {
                                applyHealth(refreshedHealth)
                                verifySelectedModel(refreshedHealth, refreshedCredentials)
                            } else {
                                _aiAccess.value = AiAccessState.NeedsSetup(
                                    issue = ProviderSetupIssue.ProviderUnavailable,
                                    providerId = setup.providerId,
                                    credentialId = setup.credentialId,
                                    detail = "The provider answered, but the backend has not confirmed the saved key is ready yet.",
                                )
                            }
                        } else {
                            _aiAccess.value = setup.copy(
                                issue = AiReadinessPolicy.testIssue(test.value.status, test.value.code),
                                detail = setupTestDetail(test.value.status, test.value.detail),
                            )
                        }
                    }
                    is ApiResult.Err -> {
                        _aiAccess.value = setup.copy(
                            issue = if (test.error is AppError.ProviderCredentialUnreadable) {
                                ProviderSetupIssue.InvalidCredential
                            } else {
                                ProviderSetupIssue.ProviderUnavailable
                            },
                            detail = test.error.userMessage,
                        )
                    }
                }
            } else {
                _aiAccess.value = setup
            }
        }
    }

    private suspend fun verifySelectedModel(
        health: HealthDto,
        credentials: List<com.metaloid.data.dto.ProviderCredentialMetadataDto>,
    ) {
        val settings = when (val result = container.api.providerSettings()) {
            is ApiResult.Ok -> result.value.settings
            is ApiResult.Err -> {
                _aiAccess.value = AiAccessState.Unavailable(result.error)
                return
            }
        }
        val modelId = settings?.defaultModel?.takeIf { it.isNotBlank() }
        if (modelId == null) {
            _aiAccess.value = AiAccessState.Ready
            if (health.byok) applyHealth(health)
            return
        }

        val pinnedProvider = settings?.defaultProvider
        val modelFound: Boolean
        var lookupError: AppError? = null
        if (pinnedProvider != null) {
            val hasProviderCredential = credentials.any {
                it.isActive && it.providerId == pinnedProvider &&
                    (it.status.equals("valid", true) || it.status.equals("connected", true))
            }
            if (!hasProviderCredential && !health.provider.equals(pinnedProvider, true)) {
                _aiAccess.value = AiAccessState.NeedsSetup(
                    issue = ProviderSetupIssue.ModelUnavailable,
                    providerId = pinnedProvider,
                    detail = "The saved model is pinned to a provider that is not connected.",
                )
                return
            }
            when (val result = container.api.providerModels(pinnedProvider)) {
                is ApiResult.Ok -> modelFound = result.value.models.any {
                    it.modelId == modelId && it.unavailable != true
                }
                is ApiResult.Err -> {
                    lookupError = result.error
                    modelFound = false
                }
            }
        } else {
            var found = false
            when (val result = container.api.listModels()) {
                is ApiResult.Ok -> found = !result.value.mock && result.value.models.any {
                    it.id == modelId && !it.unavailable
                }
                is ApiResult.Err -> lookupError = result.error
            }
            if (!found) {
                for (providerId in credentials.asSequence()
                    .filter { it.isActive && (it.status.equals("valid", true) || it.status.equals("connected", true)) }
                    .map { it.providerId }
                    .distinct()
                ) {
                    when (val result = container.api.providerModels(providerId)) {
                        is ApiResult.Ok -> if (result.value.models.any { it.modelId == modelId && it.unavailable != true }) {
                            found = true
                            break
                        }
                        is ApiResult.Err -> lookupError = result.error
                    }
                }
            }
            modelFound = found
        }

        if (modelFound) {
            _aiAccess.value = AiAccessState.Ready
            if (health.byok) applyHealth(health)
        } else if (lookupError != null) {
            _aiAccess.value = AiAccessState.Unavailable(lookupError)
        } else {
            _aiAccess.value = AiAccessState.NeedsSetup(
                issue = ProviderSetupIssue.ModelUnavailable,
                providerId = pinnedProvider,
                detail = "The saved model is not present in the backend's current model catalogue. Choose Smart Connect or another listed model.",
            )
        }
    }

    private fun setupTestDetail(status: String?, detail: String?): String = when (status?.lowercase()) {
        "auth_failed", "invalid" -> "The provider rejected this key. Check it and try again."
        "rate_limited" -> "The provider is rate-limited. The key was not confirmed; try again later."
        "unavailable" -> "The provider could not be reached from the MetaIoid server. Try again."
        "unreadable" -> "The server cannot decrypt this saved key. Replace it to reconnect."
        else -> detail?.take(180) ?: "The provider could not verify this key. Try again."
    }

    /** Re-check capabilities and republishes the status line.
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
                            val parsed: HttpUrl? = runCatching { url.toHttpUrl() }.getOrNull()
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
            AiReadinessPolicy.hasRealSharedProvider(health) -> SystemStatus.Live
            // BYOK: the account's own key is the live path even when the shared
            // one is absent. Health readiness is paired with a stored test verdict
            // before the shell opens normal AI usage.
            health.ok && health.byok && _aiAccess.value is AiAccessState.Ready -> SystemStatus.Live
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
                refreshProviderAccess(reason = "gateway changed", force = true)
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
