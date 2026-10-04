package com.metaloid.core.network

import com.metaloid.core.common.AppError
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * The one JSON configuration for the whole app.
 *
 * `ignoreUnknownKeys` is not laziness: the gateway is versioned independently
 * of the client, so a field added server-side must never break an installed
 * app (forward compatibility, Section 7.2).
 */
val MetaJson: Json = Json {
    ignoreUnknownKeys = true
    isLenient = true
    coerceInputValues = true
    encodeDefaults = true
}

/**
 * The gateway's error envelope, `{ "error": "…", "code": "…" }`, plus the
 * optional `retry_after` that accompanies `rate_limited`.
 *
 * `code` is the contract; `error` is prose for a human. The app switches on the
 * code and never parses the sentence (docs/ANDROID_API.md §2).
 */
data class ServerEnvelope(
    val code: String?,
    val errorCode: String?,
    val message: String?,
    val retryAfterSeconds: Int?,
) {
    companion object {
        /**
         * Reads both envelopes the two servers in the system use:
         *
         *   gateway  `{ "error": "Human sentence.", "code": "not_found" }`
         *   Supabase `{ "error_code": "invalid_credentials", "msg": "…" }`
         *            (older GoTrue versions: `error` + `error_description`)
         *
         * `code` may be a *number* in the Supabase envelope (400); it is only
         * ever compared against string codes, so a numeric one is normalised to
         * its digits and simply does not match anything.
         */
        fun parse(body: String?): ServerEnvelope {
            if (body.isNullOrBlank()) return ServerEnvelope(null, null, null, null)
            val obj: JsonObject = runCatching { MetaJson.parseToJsonElement(body).jsonObject }.getOrNull()
                ?: return ServerEnvelope(null, null, null, null)
            val errorField = obj.stringOrNull("error")
            val description = obj.stringOrNull("error_description") ?: obj.stringOrNull("msg")
            // In the gateway envelope `error` is the human sentence; in the
            // Supabase envelope it is a machine code. Both end up in the right
            // field so neither mapper has to guess.
            val gatewayStyle = obj.containsKey("error_description") || obj.containsKey("msg") || obj.containsKey("error_code")
            return ServerEnvelope(
                code = if (gatewayStyle) obj.stringOrNull("error_code") ?: errorField else errorField,
                errorCode = obj.stringOrNull("error_code") ?: if (gatewayStyle) errorField else null,
                message = description ?: errorField,
                retryAfterSeconds = obj.intOrNull("retry_after"),
            )
        }
    }
}

internal fun JsonObject.stringOrNull(key: String): String? {
    val element = this[key] ?: return null
    return runCatching { element.jsonPrimitive.content }.getOrNull()
}

internal fun JsonObject.intOrNull(key: String): Int? {
    val element = this[key] ?: return null
    val primitive = runCatching { element as? JsonPrimitive }.getOrNull() ?: return null
    return primitive.content.toIntOrNull()
}

internal fun JsonObject.boolOrNull(key: String): Boolean? {
    val element = this[key] ?: return null
    return runCatching { element.jsonPrimitive }.getOrNull()?.content?.let {
        when (it) {
            "true" -> true
            "false" -> false
            else -> null
        }
    }
}

/**
 * A failure that carries the *metadata* of the response, so the mapper can
 * decide, and the UI never has to see any of it.
 */
data class HttpFailure(
    val status: Int,
    val code: String?,
    val serverMessage: String?,
    val retryAfterSeconds: Int?,
) {
    fun toAppError(): AppError = ErrorMapper.fromHttp(status, code, serverMessage, retryAfterSeconds)
}

/**
 * HTTP status + gateway code → [AppError].
 *
 * This is the only place in the app that knows what a status code means. Every
 * branch is unit-tested (ErrorMapperTest) and the table matches
 * docs/ANDROID_API.md §2 plus the streaming error vocabulary from `/api/chat`.
 */
object ErrorMapper {

    fun fromHttp(
        status: Int,
        code: String?,
        serverMessage: String?,
        retryAfterSeconds: Int? = null,
        errorCode: String? = null,
    ): AppError {
        // Identity-provider codes (Supabase GoTrue) arrive as `error_code`
        // rather than the gateway's `code`. They are mapped here, in the same
        // table, so there is one place that decides what a failure means.
        when (errorCode) {
            "invalid_credentials", "invalid_grant" -> return AppError.BadCredentials(serverMessage)
            "email_not_confirmed" -> return AppError.EmailUnconfirmed()
            "user_already_exists", "email_exists" -> return AppError.AccountExists()
            "weak_password" -> return AppError.WeakCredentials(serverMessage ?: "Choose a stronger password (8+ characters).")
            "over_email_send_rate_limit", "over_request_rate_limit" -> return AppError.RateLimited(retryAfterSeconds)
            "signup_disabled" -> return AppError.Forbidden("signup_disabled")
            "invalid_api_key", "bad_jwt" -> return AppError.AuthUnconfigured()
            "no_authorization" -> return AppError.NotSignedIn()
        }
        // The code is authoritative when present, because the gateway keeps its
        // codes stable while a status can move.
        return when (code) {
            "no_token" -> AppError.NotSignedIn()
            "invalid_token", "AUTH_REQUIRED" -> AppError.SessionExpired()
            "token_expired" -> AppError.SessionExpired()
            "auth_unconfigured" -> AppError.AuthUnconfigured()
            "not_found" -> AppError.NotFound()
            "invalid_input" -> AppError.InvalidInput(serverMessage)
            "encryption_unconfigured" -> AppError.EncryptionUnconfigured()
            "storage_unavailable" -> AppError.StorageUnavailable()
            "provider_test_failed" -> AppError.BadProviderKey()
            "rate_limited", "RATE_LIMIT" -> AppError.RateLimited(retryAfterSeconds)
            "db_error" -> AppError.DataUnavailable()
            else -> when (status) {
                400 -> AppError.InvalidInput(serverMessage)
                401 -> AppError.SessionExpired()
                403 -> AppError.Forbidden()
                404 -> AppError.NotFound()
                408, 504 -> AppError.Timeout()
                413 -> AppError.FileTooLarge(50)
                415 -> AppError.FileUnsupported(serverMessage)
                429 -> AppError.RateLimited(retryAfterSeconds)
                501 -> AppError.StorageUnavailable()
                503 -> AppError.ServerError(code)
                in 500..599 -> AppError.DataUnavailable()
                else -> AppError.Unknown("HTTP $status")
            }
        }
    }

    /**
     * The streaming vocabulary sent inside `{"error":…,"code":…}` frames.
     * These are stable by contract (docs/ANDROID_API.md §4).
     */
    fun fromStreamCode(code: String?, message: String?): AppError = when (code) {
        "no_provider" -> AppError.NoProvider(code)
        "bad_key" -> AppError.BadProviderKey()
        "credential_unreadable" -> AppError.ProviderCredentialUnreadable()
        "no_credit" -> AppError.NoCredit()
        "rate_limited" -> AppError.Quota(message)
        "no_model" -> AppError.ModelUnavailable(code)
        "offline" -> AppError.Unreachable()
        "timeout" -> AppError.Timeout()
        "cancelled" -> AppError.Stopped
        "server", null, "" -> AppError.StreamFailed(code, message)
        else -> AppError.StreamFailed(code, message)
    }

    /**
     * IOException → [AppError]. Java's exception messages are never shown; the
     * distinction that matters is "no network" vs "server unreachable" vs
     * "too slow", and it is made from the exception type, not its prose.
     */
    fun fromTransport(kind: TransportFailureKind, detail: String?): AppError = when (kind) {
        TransportFailureKind.NoNetwork -> AppError.Offline(detail)
        TransportFailureKind.Timeout -> AppError.Timeout(detail)
        TransportFailureKind.Unreachable -> AppError.Unreachable(detail)
        TransportFailureKind.Protocol -> AppError.Unknown(detail)
    }
}

/** Classified transport failures, decided in `StreamTransport`/`ApiClient`. */
enum class TransportFailureKind { NoNetwork, Timeout, Unreachable, Protocol }
