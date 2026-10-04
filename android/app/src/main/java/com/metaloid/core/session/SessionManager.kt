package com.metaloid.core.session

import com.metaloid.core.common.AppError
import com.metaloid.core.common.MetaLog
import com.metaloid.core.common.Redact
import com.metaloid.core.network.ApiResult
import com.metaloid.core.network.SessionRefresher
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** The result of a sign-up attempt, so the UI can say the truth about it. */
sealed interface SignUpResult {
    data object SignedIn : SignUpResult
    data object EmailConfirmationRequired : SignUpResult
    data class Failed(val error: AppError) : SignUpResult
}

/**
 * Owns the session: sign-in, refresh, sign-out and restoration.
 *
 * Three properties are enforced here and nowhere else, because they are the
 * ones that go wrong quietly:
 *
 *  1. **One refresh at a time.** Concurrent 401s share a single refresh; the
 *     losers of the race return the winner's token. A refresh storm is how an
 *     app gets rate-limited by its own identity provider.
 *  2. **A refresh failure ends the session with a reason.** No retry loop, no
 *     silent demotion to anonymous, no half-signed-in state.
 *  3. **Offline is not signed-out.** If the network is down at launch, the
 *     stored session stays and the app opens in offline mode. Only a definitive
 *     server rejection (or an explicit sign-out) clears it.
 */
class SessionManager(
    private val gateway: GatewayAuthApi,
    private val supabase: SupabaseAuthApi,
    private val store: SessionStore,
    private val deviceName: String,
    private val clock: () -> Long = System::currentTimeMillis,
) : SessionRefresher {

    companion object {
        private const val TAG = "session"
    }

    private val refreshMutex = Mutex()

    /**
     * Bumped every time a *successful* refresh installs a new token. A caller
     * that waited on the mutex compares the generation it saw before waiting
     * with the current one; a difference means somebody else already did the
     * work, so it returns that result instead of refreshing again.
     */
    private var generation: Long = 0

    @Volatile
    private var session: Session? = null

    private val _state = MutableStateFlow<AuthState>(AuthState.Unknown)
    val state: StateFlow<AuthState> = _state.asStateFlow()

    /** Which identity providers this deployment actually offers. */
    @Volatile
    var availableModes: List<AuthMode> = listOf(AuthMode.GATEWAY)

    /** True once the user explicitly signed out, so no restore re-adopts a token. */
    @Volatile
    private var signedOutExplicitly = false

    fun current(): Session? = session

    /** The bearer token for gateway calls. Read per request, never captured. */
    fun accessToken(): String? = session?.accessToken

    /**
     * Reads the encrypted store and produces the initial [AuthState].
     *
     * A stored session is adopted immediately (so the app can render offline),
     * and refreshed in the background if it is already past its expiry.
     */
    suspend fun restore(): AuthState {
        if (signedOutExplicitly) return publish(AuthState.SignedOut(availableModes))
        val stored = store.load()
        if (stored == null) return publish(AuthState.SignedOut(availableModes))
        session = stored
        MetaLog.i(TAG, "restored session for %s via %s", Redact.identity(stored.label), stored.mode)
        return if (stored.isExpired(clock())) {
            val refreshed = refreshIfExpired()
            if (refreshed != null) {
                publish(AuthState.SignedIn(requireNotNull(session)))
            } else {
                // The refresh itself failed. Whether that is a dead session or a
                // dead network decides between "sign in again" and "offline",
                // and the caller distinguishes them from the returned state.
                publish(AuthState.Offline(stored))
            }
        } else {
            publish(AuthState.SignedIn(stored))
        }
    }

    /** Marks the app offline while keeping the session (Section 9.2). */
    fun noteOffline() {
        val current = session ?: return
        if (_state.value !is AuthState.Offline) publish(AuthState.Offline(current))
    }

    /** Marks the app back online; the session itself did not change. */
    fun noteOnline() {
        val current = session ?: return
        if (_state.value !is AuthState.SignedIn) publish(AuthState.SignedIn(current))
    }

    // ── sign in ─────────────────────────────────────────────────────────────

    suspend fun signInGateway(handle: String, passcode: String): AppError? {
        val result = gateway.logIn(handle.trim(), passcode, deviceName)
        return when (result) {
            is ApiResult.Ok -> {
                adopt(
                    Session(
                        mode = AuthMode.GATEWAY,
                        accessToken = result.value.access,
                        refreshToken = result.value.refresh,
                        expiresAtEpochMs = result.value.session.accessExpiresAt,
                        userId = result.value.user.id,
                        label = result.value.user.handle ?: result.value.user.email ?: "account",
                        displayName = result.value.user.displayName,
                    )
                )
                signedOutExplicitly = false
                null
            }
            is ApiResult.Err -> {
                MetaLog.w(TAG, "gateway sign-in failed: %s", result.error.javaClass.simpleName)
                // The gateway's own sentence is accurate and specific here
                // ("Unknown handle or wrong passcode."), so it is used verbatim
                // when it is a credential problem.
                if (result.error is AppError.InvalidInput) AppError.BadCredentials(result.error.userMessage) else result.error
            }
        }
    }

    suspend fun signUpGateway(handle: String, displayName: String, passcode: String): SignUpResult {
        val result = gateway.signUp(handle.trim(), displayName.trim(), passcode, deviceName)
        return when (result) {
            is ApiResult.Ok -> {
                adopt(
                    Session(
                        mode = AuthMode.GATEWAY,
                        accessToken = result.value.access,
                        refreshToken = result.value.refresh,
                        expiresAtEpochMs = result.value.session.accessExpiresAt,
                        userId = result.value.user.id,
                        label = result.value.user.handle ?: "account",
                        displayName = result.value.user.displayName,
                    )
                )
                signedOutExplicitly = false
                SignUpResult.SignedIn
            }
            is ApiResult.Err -> SignUpResult.Failed(
                // Sign-up refusals from the gateway arrive as 400 invalid_input
                // with a specific sentence ("That handle is taken.") — that
                // sentence is the most useful thing we can show.
                if (result.error is AppError.InvalidInput) {
                    val text = result.error.userMessage
                    if (text.contains("taken", ignoreCase = true)) AppError.AccountExists() else AppError.WeakCredentials(text)
                } else {
                    result.error
                }
            )
        }
    }

    suspend fun signInSupabase(email: String, password: String): AppError? {
        if (!supabase.configured) return AppError.AuthUnconfigured("supabase not configured")
        return when (val result = supabase.signIn(email.trim(), password)) {
            is ApiResult.Ok -> {
                adopt(result.value.toSession())
                signedOutExplicitly = false
                null
            }
            is ApiResult.Err -> {
                MetaLog.w(TAG, "supabase sign-in failed: %s", result.error.javaClass.simpleName)
                result.error
            }
        }
    }

    suspend fun signUpSupabase(email: String, password: String): SignUpResult {
        if (!supabase.configured) return SignUpResult.Failed(AppError.AuthUnconfigured("supabase not configured"))
        return when (val result = supabase.signUp(email.trim(), password)) {
            is ApiResult.Ok -> when (val outcome = result.value) {
                is SupabaseSignUpOutcome.SignedIn -> {
                    adopt(outcome.session.toSession())
                    signedOutExplicitly = false
                    SignUpResult.SignedIn
                }
                SupabaseSignUpOutcome.ConfirmationRequired -> SignUpResult.EmailConfirmationRequired
            }
            is ApiResult.Err -> SignUpResult.Failed(result.error)
        }
    }

    // ── refresh ─────────────────────────────────────────────────────────────

    /**
     * Refreshes the access token, at most once for any burst of callers.
     *
     * Single-flight is implemented with a generation counter read *before* the
     * lock: a caller that waited behind a successful refresh sees the counter
     * move and returns that result instead of refreshing a second time. That is
     * what makes "five requests get a 401 at once" cause exactly one call to the
     * identity provider (Section 8.1).
     *
     * `force` is what a 401 handler uses — the server just rejected the token, so
     * local expiry arithmetic is no longer evidence of anything.
     */
    override suspend fun refresh(): String? = refreshInternal(force = true)

    /** Used at launch: refresh only if the stored token is actually past expiry. */
    suspend fun refreshIfExpired(): String? = refreshInternal(force = false)

    private suspend fun refreshInternal(force: Boolean): String? {
        val observed = generation
        return refreshMutex.withLock {
            val current = session ?: return@withLock null
            if (generation != observed) return@withLock current.accessToken
            if (!force && !current.isExpired(clock())) return@withLock current.accessToken
            val refreshed = when (current.mode) {
                AuthMode.SUPABASE -> refreshSupabase(current)
                AuthMode.GATEWAY -> refreshGateway(current)
            }
            if (refreshed != null) {
                generation += 1
                return@withLock refreshed
            }
            // A definitive rejection has already cleared the session (and
            // published SignedOut); a transport failure left it in place and
            // reported Offline. Either way there is no new token.
            return@withLock null
        }
    }

    private suspend fun refreshGateway(current: Session): String? {
        val refreshToken = current.refreshToken ?: return null
        return when (val result = gateway.refresh(refreshToken)) {
            is ApiResult.Ok -> {
                val next = current.copy(
                    accessToken = result.value.access,
                    refreshToken = result.value.refresh,
                    expiresAtEpochMs = result.value.session.accessExpiresAt ?: current.expiresAtEpochMs,
                )
                adopt(next)
                next.accessToken
            }
            is ApiResult.Err -> {
                // A *transport* failure is not an expired session: the phone is
                // offline, and the token may still be perfectly good when the
                // network comes back. Only an explicit rejection ends it.
                if (isDefinitiveRejection(result.error)) null else {
                    publish(AuthState.Offline(current))
                    MetaLog.i(TAG, "refresh deferred: %s", result.error.javaClass.simpleName)
                    null
                }
            }
        }
    }

    private suspend fun refreshSupabase(current: Session): String? {
        val refreshToken = current.refreshToken ?: return null
        return when (val result = supabase.refresh(refreshToken)) {
            is ApiResult.Ok -> {
                val next = result.value.toSession().copy(
                    // GoTrue does not repeat `user` on every refresh; keep ours.
                    userId = result.value.user?.id ?: current.userId,
                    label = result.value.user?.email ?: current.label,
                )
                adopt(next)
                next.accessToken
            }
            is ApiResult.Err -> {
                if (isDefinitiveRejection(result.error)) null else {
                    publish(AuthState.Offline(current))
                    null
                }
            }
        }
    }

    private fun isDefinitiveRejection(error: AppError): Boolean = when (error) {
        is AppError.SessionExpired, is AppError.NotSignedIn, is AppError.BadCredentials,
        is AppError.Forbidden, is AppError.AuthUnconfigured,
        -> true
        else -> false
    }

    // ── sign out ────────────────────────────────────────────────────────────

    /**
     * Signs out. The local wipe is unconditional and happens whatever the server
     * says — a user who pressed "Sign out" on a plane is signed out.
     */
    suspend fun signOut(everywhere: Boolean = false): AppError? {
        val current = session
        var serverError: AppError? = null
        if (current != null) {
            val result = when (current.mode) {
                AuthMode.GATEWAY -> if (everywhere) gateway.logOutEverywhere() else gateway.logOut()
                AuthMode.SUPABASE -> supabase.signOut(current.accessToken)
            }
            if (result is ApiResult.Err) serverError = result.error
        }
        signedOutExplicitly = true
        clearLocal()
        publish(AuthState.SignedOut(availableModes))
        return serverError
    }

    /**
     * The server rejected our bearer token in a way a refresh could not fix.
     *
     * Called from exactly one place (the API client) after it has already tried
     * to refresh, so this cannot start a refresh loop — it ends the session and
     * leaves a reason for the sign-in screen to show.
     */
    suspend fun noteRejectedByServer() {
        if (session == null) return
        signedOutExplicitly = true
        clearLocal()
        publish(AuthState.SignedOut(availableModes, AppError.SessionExpired("token rejected by the server")))
    }

    /** Clears everything this account left on the device. */
    private fun clearLocal() {
        session = null
        store.clear()
    }

    private fun adopt(next: Session) {
        session = next
        store.save(next)
        publish(AuthState.SignedIn(next))
        MetaLog.i(TAG, "session established for %s via %s", Redact.identity(next.label), next.mode)
    }

    private fun publish(next: AuthState): AuthState {
        _state.value = next
        return next
    }

    private fun SupabaseSessionDto.toSession(): Session = Session(
        mode = AuthMode.SUPABASE,
        accessToken = accessToken,
        refreshToken = refreshToken,
        expiresAtEpochMs = expiresAtEpochSecondOrDerived(),
        userId = user?.id.orEmpty(),
        label = user?.email ?: "account",
    )

    /** `expires_at` is unix seconds; a missing one is derived from `expires_in`. */
    private fun SupabaseSessionDto.expiresAtEpochSecondOrDerived(): Long? {
        val explicit = expiresAt
        if (explicit != null && explicit > 0) return explicit * 1000L
        val lifetime = expiresIn ?: return null
        return clock() + lifetime * 1000L
    }

    /** What the sign-in screen shows about the last forced sign-out. */
    fun lastReason(): AppError? = (state.value as? AuthState.SignedOut)?.reason
}

/** Reads and writes the session in encrypted storage. */
class SessionStore(
    private val vault: com.metaloid.core.storage.SecretFileVault,
) {
    fun load(): Session? {
        val raw = vault.read() ?: return null
        return runCatching { com.metaloid.core.network.MetaJson.decodeFromString(Session.serializer(), raw) }
            .onFailure { MetaLog.w("session", "stored session was unreadable: %s", it.javaClass.simpleName) }
            .getOrNull()
    }

    fun save(session: Session) {
        vault.write(com.metaloid.core.network.MetaJson.encodeToString(Session.serializer(), session))
    }

    fun clear() = vault.clear()
}
