package com.metaloid.core.common

/**
 * Every failure the app can show a user, as a typed value (Section 13).
 *
 * Two rules are encoded here rather than left to each screen:
 *
 *  * **No raw exception ever reaches the UI.** A screen renders
 *    [AppError.userMessage]; the underlying cause stays in [technicalDetail],
 *    which is logged (redacted) and never displayed.
 *  * **Every message names the next action.** [AppError.action] tells the UI
 *    which affordance to offer, so "Sign in again" is a button and not a
 *    sentence the user has to interpret.
 *
 * The mapping *into* this type lives in `core/network/ErrorMapper.kt` and is
 * exhaustively unit-tested: an unmapped code must never silently become
 * "Something went wrong".
 */
sealed interface AppError {

    /** What the user reads. Short, specific where the cause is known, calm. */
    val userMessage: String

    /** Log-only. Already redacted by the time it is logged. */
    val technicalDetail: String? get() = null

    /** Whether offering "Try again" is honest for this failure. */
    val retryable: Boolean get() = false

    /** The primary affordance for this failure. */
    val action: ErrorAction get() = ErrorAction.None

    enum class ErrorAction { None, Retry, SignIn, ChooseModel, OpenSettings, ViewUsage, BuyCredit, ChooseFile }

    // ── connectivity ────────────────────────────────────────────────────────

    /** The device has no usable network. */
    data class Offline(override val technicalDetail: String? = null) : AppError {
        override val userMessage: String get() = "You're offline."
        override val retryable: Boolean get() = true
        override val action: ErrorAction get() = ErrorAction.Retry
    }

    /** The device has a network, but MetaIoid's gateway did not answer. */
    data class Unreachable(override val technicalDetail: String? = null) : AppError {
        override val userMessage: String get() = "Can't reach MetaIoid right now."
        override val retryable: Boolean get() = true
        override val action: ErrorAction get() = ErrorAction.Retry
    }

    /** A request timed out at the transport level. */
    data class Timeout(override val technicalDetail: String? = null) : AppError {
        override val userMessage: String get() = "MetaIoid took too long to answer."
        override val retryable: Boolean get() = true
        override val action: ErrorAction get() = ErrorAction.Retry
    }

    // ── identity ────────────────────────────────────────────────────────────

    /** No session, or the refresh token is gone. */
    data class SessionExpired(override val technicalDetail: String? = null) : AppError {
        override val userMessage: String get() = "Your session expired. Sign in again."
        override val action: ErrorAction get() = ErrorAction.SignIn
    }

    /** 401 with no usable credential in this request. */
    data class NotSignedIn(override val technicalDetail: String? = null) : AppError {
        override val userMessage: String get() = "Sign in to continue."
        override val action: ErrorAction get() = ErrorAction.SignIn
    }

    /** 403 — the server refused. The client never second-guesses this. */
    data class Forbidden(override val technicalDetail: String? = null) : AppError {
        override val userMessage: String get() = "You don't have access to this."
    }

    /** Credentials were rejected by the identity provider. */
    data class BadCredentials(val serverMessage: String?, override val technicalDetail: String? = null) : AppError {
        override val userMessage: String
            get() = serverMessage?.takeIf { it.isNotBlank() } ?: "That email or password isn't right."
    }

    /** Sign-up refused because the account already exists. */
    data class AccountExists(override val technicalDetail: String? = null) : AppError {
        override val userMessage: String get() = "An account with that email already exists. Sign in instead."
    }

    /** Password/format rejected before any network call was made. */
    data class WeakCredentials(val message: String) : AppError {
        override val userMessage: String get() = message
    }

    /** The account exists but the address is not confirmed yet. */
    data class EmailUnconfirmed(override val technicalDetail: String? = null) : AppError {
        override val userMessage: String get() = "Confirm your email first — check your inbox for the link."
    }

    /** The *server* has no verification key configured (503 auth_unconfigured). */
    data class AuthUnconfigured(override val technicalDetail: String? = null) : AppError {
        override val userMessage: String get() = "Sign-in isn't available on this MetaIoid server right now."
    }

    // ── data ────────────────────────────────────────────────────────────────

    data class NotFound(override val technicalDetail: String? = null) : AppError {
        override val userMessage: String get() = "That isn't here any more."
    }

    data class InvalidInput(val serverMessage: String?, override val technicalDetail: String? = null) : AppError {
        override val userMessage: String
            get() = serverMessage?.takeIf { it.isNotBlank() } ?: "That request wasn't valid."
    }

    /** The gateway's data service is down (`db_error`). */
    data class DataUnavailable(override val technicalDetail: String? = null) : AppError {
        override val userMessage: String get() = "MetaIoid's data service is unavailable. Retry shortly."
        override val retryable: Boolean get() = true
        override val action: ErrorAction get() = ErrorAction.Retry
    }

    // ── limits ──────────────────────────────────────────────────────────────

    /** 429 with a real `Retry-After` from the server, when it sent one. */
    data class RateLimited(val retryAfterSeconds: Int?, override val technicalDetail: String? = null) : AppError {
        override val userMessage: String
            get() = if (retryAfterSeconds != null && retryAfterSeconds > 0) {
                "Too many requests. Try again in ${retryAfterSeconds}s."
            } else {
                "Too many requests. Try again in a moment."
            }
        override val retryable: Boolean get() = true
        override val action: ErrorAction get() = ErrorAction.Retry
    }

    /** A real quota/plan limit, reported by the backend. Never invented. */
    data class Quota(val serverMessage: String?, override val technicalDetail: String? = null) : AppError {
        override val userMessage: String get() = serverMessage?.takeIf { it.isNotBlank() } ?: "You've reached your limit for now."
        override val action: ErrorAction get() = ErrorAction.ViewUsage
    }

    // ── model / provider ────────────────────────────────────────────────────

    /** The model the user chose (or the router picked) is unavailable. */
    data class ModelUnavailable(val code: String?, override val technicalDetail: String? = null) : AppError {
        override val userMessage: String get() = "The selected AI model is temporarily unavailable."
        override val action: ErrorAction get() = ErrorAction.ChooseModel
    }

    /** No provider key exists at all — neither the user's nor the platform's. */
    data class NoProvider(val code: String?, override val technicalDetail: String? = null) : AppError {
        override val userMessage: String get() = "No AI provider is connected yet. Add a provider key in Settings → AI."
        override val action: ErrorAction get() = ErrorAction.OpenSettings
    }

    /** The user's own provider key was rejected. */
    data class BadProviderKey(override val technicalDetail: String? = null) : AppError {
        override val userMessage: String get() = "Your provider key was rejected. Replace it in Settings → AI."
        override val action: ErrorAction get() = ErrorAction.OpenSettings
    }

    /** The provider account is out of credit. */
    data class NoCredit(override val technicalDetail: String? = null) : AppError {
        override val userMessage: String get() = "The connected AI provider is out of credit."
        override val action: ErrorAction get() = ErrorAction.OpenSettings
    }

    /** A provider key could not be decrypted server-side. */
    data class ProviderCredentialUnreadable(override val technicalDetail: String? = null) : AppError {
        override val userMessage: String get() = "A stored provider key can't be read. Replace it in Settings → AI."
        override val action: ErrorAction get() = ErrorAction.OpenSettings
    }

    /** The server cannot store provider keys safely (503 encryption_unconfigured). */
    data class EncryptionUnconfigured(override val technicalDetail: String? = null) : AppError {
        override val userMessage: String get() = "This MetaIoid server can't store provider keys right now."
    }

    // ── streaming ───────────────────────────────────────────────────────────

    data class StreamInterrupted(override val technicalDetail: String? = null) : AppError {
        override val userMessage: String get() = "Connection interrupted. Your partial response is saved."
        override val retryable: Boolean get() = true
        override val action: ErrorAction get() = ErrorAction.Retry
    }

    /** The stream reported an error after partial text arrived. */
    data class StreamFailed(val code: String?, override val technicalDetail: String? = null) : AppError {
        override val userMessage: String get() = "The response stopped early."
        override val retryable: Boolean get() = true
        override val action: ErrorAction get() = ErrorAction.Retry
    }

    /** The user pressed stop. Neutral by design: not an error. */
    data object Stopped : AppError {
        override val userMessage: String get() = "Stopped."
    }

    // ── files ───────────────────────────────────────────────────────────────

    data class UploadFailed(override val technicalDetail: String? = null) : AppError {
        override val userMessage: String get() = "Upload failed. Try again."
        override val retryable: Boolean get() = true
        override val action: ErrorAction get() = ErrorAction.Retry
    }

    data class FileTooLarge(val limitMb: Int) : AppError {
        override val userMessage: String get() = "That file is larger than the ${limitMb} MB limit."
        override val action: ErrorAction get() = ErrorAction.ChooseFile
    }

    data class FileUnsupported(val message: String? = null) : AppError {
        override val userMessage: String get() = message?.takeIf { it.isNotBlank() } ?: "MetaIoid can't upload that file type."
        override val action: ErrorAction get() = ErrorAction.ChooseFile
    }

    /** The server has no object storage (`storage_unavailable`, 501). */
    data class StorageUnavailable(override val technicalDetail: String? = null) : AppError {
        override val userMessage: String get() = "File uploads aren't available on this MetaIoid server."
    }

    // ── features ────────────────────────────────────────────────────────────

    data class MemoryFailed(override val technicalDetail: String? = null) : AppError {
        override val userMessage: String get() = "Couldn't update memory. Try again."
        override val retryable: Boolean get() = true
        override val action: ErrorAction get() = ErrorAction.Retry
    }

    data class ResearchUnavailable(override val technicalDetail: String? = null) : AppError {
        override val userMessage: String get() = "Research is temporarily unavailable. Chat is ready."
    }

    data class MissionFailed(val serverReason: String?, override val technicalDetail: String? = null) : AppError {
        override val userMessage: String get() = serverReason?.takeIf { it.isNotBlank() } ?: "The mission failed."
        override val retryable: Boolean get() = true
        override val action: ErrorAction get() = ErrorAction.Retry
    }

    // ── voice ───────────────────────────────────────────────────────────────

    data object MicPermissionDenied : AppError {
        override val userMessage: String get() = "Microphone permission is needed for voice."
        override val action: ErrorAction get() = ErrorAction.OpenSettings
    }

    data object VoiceUnavailable : AppError {
        override val userMessage: String get() = "Voice isn't available on this device."
    }

    data class SpeechFailed(val reason: String?) : AppError {
        override val userMessage: String get() = reason?.takeIf { it.isNotBlank() } ?: "I didn't catch that. Try again."
        override val retryable: Boolean get() = true
        override val action: ErrorAction get() = ErrorAction.Retry
    }

    // ── fallback ────────────────────────────────────────────────────────────

    data class ServerError(val code: String?, override val technicalDetail: String? = null) : AppError {
        override val userMessage: String get() = "Something went wrong. Try again."
        override val retryable: Boolean get() = true
        override val action: ErrorAction get() = ErrorAction.Retry
    }

    data class Unknown(override val technicalDetail: String? = null) : AppError {
        override val userMessage: String get() = "Something went wrong. Try again."
        override val retryable: Boolean get() = true
        override val action: ErrorAction get() = ErrorAction.Retry
    }
}
