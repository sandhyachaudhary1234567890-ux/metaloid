package com.metaloid.core.session

import com.metaloid.core.network.ApiResult
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/**
 * The gateway's account endpoints (`/api/auth/*`), declared as an interface.
 *
 * The session manager depends on this rather than on the concrete API class so
 * that every authentication rule in it — one refresh, no refresh storms, a
 * failed refresh ends the session — is testable against a fake without a
 * network, a server or a clock.
 *
 * Shapes are confirmed from `server/src/core/users.js` (`createSession`,
 * `refreshSession`) and `server/src/index.js` (`/api/auth/*`).
 */
interface GatewayAuthApi {
    suspend fun signUp(handle: String, displayName: String, passcode: String, deviceName: String): ApiResult<GatewaySessionResponse>

    suspend fun logIn(handle: String, passcode: String, deviceName: String): ApiResult<GatewaySessionResponse>

    suspend fun refresh(refreshToken: String): ApiResult<GatewayRefreshResponse>

    suspend fun logOut(): ApiResult<JsonElement>

    suspend fun logOutEverywhere(): ApiResult<JsonElement>
}

/** `{ user, profile, access, refresh, session }` */
@Serializable
data class GatewaySessionResponse(
    val user: GatewayUser,
    val profile: JsonElement? = null,
    val access: String,
    val refresh: String,
    val session: GatewaySession,
)

/** `{ access, refresh, session }` — refresh rotates the pair in place. */
@Serializable
data class GatewayRefreshResponse(
    val access: String,
    val refresh: String,
    val session: GatewaySession,
)

@Serializable
data class GatewayUser(
    val id: String,
    val handle: String? = null,
    @SerialName("displayName") val displayName: String? = null,
    val role: String? = null,
    val email: String? = null,
    /** Present when the identity came from a Supabase JWT instead of a local account. */
    val via: String? = null,
)

@Serializable
data class GatewaySession(
    val id: String,
    val accessExpiresAt: Long? = null,
    val refreshExpiresAt: Long? = null,
    val deviceName: String? = null,
)

/**
 * The identity provider (Supabase GoTrue), declared as an interface for the
 * same testability reason as [GatewayAuthApi].
 *
 * Implementations are expected to answer `configured = false` — and to fail
 * with a typed error rather than a crash — when the deployment has no Supabase
 * project, which is a supported configuration (self-hosted gateways use
 * [GatewayAuthApi] alone).
 */
interface SupabaseAuthApi {
    val configured: Boolean

    suspend fun signIn(email: String, password: String): ApiResult<SupabaseSessionDto>

    suspend fun signUp(email: String, password: String): ApiResult<SupabaseSignUpOutcome>

    suspend fun refresh(refreshToken: String): ApiResult<SupabaseSessionDto>

    suspend fun signOut(accessToken: String): ApiResult<JsonElement>
}

@Serializable
data class SupabaseSessionDto(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String? = null,
    /** Unix seconds, as GoTrue reports it. */
    @SerialName("expires_at") val expiresAt: Long? = null,
    @SerialName("expires_in") val expiresIn: Long? = null,
    val user: SupabaseUserDto? = null,
)

@Serializable
data class SupabaseUserDto(
    val id: String,
    val email: String? = null,
)

/**
 * Sign-up has two legitimate outcomes and the UI must distinguish them: a
 * session (confirmation disabled) or a pending email confirmation. Treating the
 * second as the first is how an app shows a signed-in shell to a user who is
 * not signed in.
 */
sealed interface SupabaseSignUpOutcome {
    data class SignedIn(val session: SupabaseSessionDto) : SupabaseSignUpOutcome
    data object ConfirmationRequired : SupabaseSignUpOutcome
}
