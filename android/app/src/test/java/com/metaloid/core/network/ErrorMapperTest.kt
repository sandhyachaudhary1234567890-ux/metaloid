package com.metaloid.core.network

import com.metaloid.core.common.AppError
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Error mapping is the app's whole vocabulary for "what went wrong". The
 * gateway's codes are a stable contract (docs/ANDROID_API.md §5), so each one
 * gets an assertion: a code that falls through to [AppError.Unknown] is a bug in
 * the map, not a surprise in production.
 */
class ErrorMapperTest {

    @Test
    fun `gateway auth codes`() {
        assertTrue(ErrorMapper.fromHttp(401, "no_token", null) is AppError.NotSignedIn)
        assertTrue(ErrorMapper.fromHttp(401, "invalid_token", null) is AppError.SessionExpired)
        assertTrue(ErrorMapper.fromHttp(401, "token_expired", null) is AppError.SessionExpired)
        assertTrue(ErrorMapper.fromHttp(503, "auth_unconfigured", null) is AppError.AuthUnconfigured)
    }

    @Test
    fun `gateway data and provider codes`() {
        assertTrue(ErrorMapper.fromHttp(404, "not_found", null) is AppError.NotFound)
        assertTrue(ErrorMapper.fromHttp(400, "invalid_input", "title too long") is AppError.InvalidInput)
        assertTrue(ErrorMapper.fromHttp(503, "encryption_unconfigured", null) is AppError.EncryptionUnconfigured)
        assertTrue(ErrorMapper.fromHttp(501, "storage_unavailable", null) is AppError.StorageUnavailable)
        assertTrue(ErrorMapper.fromHttp(400, "provider_test_failed", null) is AppError.BadProviderKey)
        assertTrue(ErrorMapper.fromHttp(500, "db_error", null) is AppError.DataUnavailable)
    }

    @Test
    fun `rate limiting keeps the server's retry-after`() {
        val error = ErrorMapper.fromHttp(429, "rate_limited", null, retryAfterSeconds = 30)
        assertEquals(30, (error as AppError.RateLimited).retryAfterSeconds)
        assertTrue(error.retryable)
    }

    @Test
    fun `supabase identity codes are mapped in the same place`() {
        assertTrue(ErrorMapper.fromHttp(400, null, "Invalid login credentials", errorCode = "invalid_credentials") is AppError.BadCredentials)
        assertTrue(ErrorMapper.fromHttp(400, null, null, errorCode = "email_not_confirmed") is AppError.EmailUnconfirmed)
        assertTrue(ErrorMapper.fromHttp(400, null, null, errorCode = "user_already_exists") is AppError.AccountExists)
        assertTrue(ErrorMapper.fromHttp(422, null, null, errorCode = "weak_password") is AppError.WeakCredentials)
        assertTrue(ErrorMapper.fromHttp(429, null, null, errorCode = "over_request_rate_limit") is AppError.RateLimited)
        assertTrue(ErrorMapper.fromHttp(403, null, null, errorCode = "signup_disabled") is AppError.Forbidden)
        assertTrue(ErrorMapper.fromHttp(401, null, null, errorCode = "bad_jwt") is AppError.AuthUnconfigured)
    }

    @Test
    fun `status-only fallbacks`() {
        assertTrue(ErrorMapper.fromHttp(401, null, null) is AppError.SessionExpired)
        assertTrue(ErrorMapper.fromHttp(403, null, null) is AppError.Forbidden)
        assertTrue(ErrorMapper.fromHttp(404, null, null) is AppError.NotFound)
        assertTrue(ErrorMapper.fromHttp(408, null, null) is AppError.Timeout)
        assertTrue(ErrorMapper.fromHttp(413, null, null) is AppError.FileTooLarge)
        assertTrue(ErrorMapper.fromHttp(415, null, null) is AppError.FileUnsupported)
        assertTrue(ErrorMapper.fromHttp(504, null, null) is AppError.Timeout)
        assertTrue(ErrorMapper.fromHttp(502, null, null) is AppError.DataUnavailable)
    }

    @Test
    fun `stream codes`() {
        assertTrue(ErrorMapper.fromStreamCode("no_provider", null) is AppError.NoProvider)
        assertTrue(ErrorMapper.fromStreamCode("bad_key", null) is AppError.BadProviderKey)
        assertTrue(ErrorMapper.fromStreamCode("credential_unreadable", null) is AppError.ProviderCredentialUnreadable)
        assertTrue(ErrorMapper.fromStreamCode("no_credit", null) is AppError.NoCredit)
        assertTrue(ErrorMapper.fromStreamCode("no_model", null) is AppError.ModelUnavailable)
        assertTrue(ErrorMapper.fromStreamCode("rate_limited", "slow down") is AppError.Quota)
        assertTrue(ErrorMapper.fromStreamCode("offline", null) is AppError.Unreachable)
        assertTrue(ErrorMapper.fromStreamCode("timeout", null) is AppError.Timeout)
        assertEquals(AppError.Stopped, ErrorMapper.fromStreamCode("cancelled", null))
        assertTrue(ErrorMapper.fromStreamCode("server", "boom") is AppError.StreamFailed)
        assertTrue(ErrorMapper.fromStreamCode(null, null) is AppError.StreamFailed)
        assertTrue(ErrorMapper.fromStreamCode("something_new", null) is AppError.StreamFailed)
    }

    @Test
    fun `transport failures`() {
        assertTrue(ErrorMapper.fromTransport(TransportFailureKind.NoNetwork, null) is AppError.Offline)
        assertTrue(ErrorMapper.fromTransport(TransportFailureKind.Timeout, null) is AppError.Timeout)
        assertTrue(ErrorMapper.fromTransport(TransportFailureKind.Unreachable, null) is AppError.Unreachable)
        assertTrue(ErrorMapper.fromTransport(TransportFailureKind.Protocol, "bad frame") is AppError.Unknown)
    }

    @Test
    fun `every error can explain itself to a user without leaking internals`() {
        val errors = listOf(
            ErrorMapper.fromHttp(500, "db_error", "pg: connection refused"),
            ErrorMapper.fromStreamCode("bad_key", "sk-or-v1-abc"),
            ErrorMapper.fromTransport(TransportFailureKind.NoNetwork, null),
        )
        errors.forEach { error ->
            assertTrue("message must not be blank", error.userMessage.isNotBlank())
            val detail = error.technicalDetail ?: ""
            assertTrue(
                "technical detail must not contain a key: $detail",
                !detail.contains("sk-or-v1-abc"),
            )
        }
    }
}
