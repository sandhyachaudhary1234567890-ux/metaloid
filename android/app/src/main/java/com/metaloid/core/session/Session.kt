package com.metaloid.core.session

import kotlinx.serialization.Serializable

/**
 * Which identity system issued the session.
 *
 * MetaIoid has exactly one *gateway* identity model, fed by two legitimate
 * issuers — this is not two systems in the client, it is one session with a
 * recorded origin, because the difference changes exactly one thing: whether
 * the Supabase Storage upload path is available (it needs a Supabase token).
 *
 *   GATEWAY   self-hosted / local gateway accounts (`/api/auth/…`,
 *             handle + passcode). Available on any deployment that has local
 *             accounts, and the only path on a server with no Supabase project.
 *   SUPABASE  email + password through the project's identity provider. This is
 *             the documented production path (docs/ANDROID_API.md §1) and the
 *             one that also authorises object storage.
 */
@Serializable
enum class AuthMode { GATEWAY, SUPABASE }

/**
 * A session, exactly as the app needs it and nothing more.
 *
 * This is the only object whose storage is encrypted (core/storage/SecureVault).
 * It never appears in a log, a crash report, a bundle, an Intent or a saved
 * state file: [accessToken] and [refreshToken] are the account.
 */
@Serializable
data class Session(
    val mode: AuthMode,
    val accessToken: String,
    val refreshToken: String? = null,
    /** Epoch millis. Null means "the server did not say" — never assumed. */
    val expiresAtEpochMs: Long? = null,
    val userId: String,
    /** Email or handle. Used for display and for redacted diagnostics only. */
    val label: String,
    val displayName: String? = null,
) {
    /**
     * True when the token is unusable — with a 60-second safety margin, because
     * a token that expires mid-flight produces a failure the user did not cause.
     */
    fun isExpired(nowMs: Long, skewMs: Long = 60_000L): Boolean {
        val expiry = expiresAtEpochMs ?: return false
        return nowMs + skewMs >= expiry
    }
}

/** The app's authentication state, as the UI consumes it. */
sealed interface AuthState {
    /** Before the encrypted store has been read. Not "signed out". */
    data object Unknown : AuthState

    /** No session. [reason] carries *why* when the user was signed out by force. */
    data class SignedOut(
        val available: List<AuthMode>,
        val reason: com.metaloid.core.common.AppError? = null,
    ) : AuthState

    /** A usable session, restored from storage and/or refreshed in memory. */
    data class SignedIn(val session: Session) : AuthState

    /**
     * A session exists locally but could not be used: the network is down or the
     * server is unreachable. This is *not* signed-out — signing the user out
     * because their train entered a tunnel is data loss.
     */
    data class Offline(val session: Session) : AuthState
}
