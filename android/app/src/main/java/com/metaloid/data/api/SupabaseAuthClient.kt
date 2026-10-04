package com.metaloid.data.api

import com.metaloid.core.common.MetaLog
import com.metaloid.core.network.ApiClient
import com.metaloid.core.network.ApiResult
import com.metaloid.core.network.MetaJson
import com.metaloid.core.session.SupabaseAuthApi
import com.metaloid.core.session.SupabaseSessionDto
import com.metaloid.core.session.SupabaseSignUpOutcome
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.HttpUrl

/**
 * The two public values a Supabase project hands to a browser or an app.
 *
 * The anon key is public *by design*: it grants nothing on its own, because
 * every table is protected by row-level security and every gateway route
 * requires a verified user JWT. It is fetched from `/api/config` when the build
 * did not bake one in, which is exactly what the web client does.
 */
data class SupabaseConfig(
    val url: HttpUrl,
    val anonKey: String,
)

/**
 * Email + password authentication against the project's identity provider
 * (Supabase GoTrue), spoken over plain REST.
 *
 * Why REST instead of `supabase-kt`: the app needs three endpoints
 * (`/token?grant_type=password`, `/signup`, `/token?grant_type=refresh_token`)
 * and one storage call. That is ~200 lines here versus a multi-module SDK with
 * its own Kotlin/coroutine requirements — and every line here is unit-testable
 * against MockWebServer. Recorded as a decision in docs/android/DECISIONS.md.
 *
 * The anon key travels in `apikey` *and* as an explicit `Authorization` header,
 * which is what the official clients send and what keeps this call independent
 * of whatever session token happens to be in memory.
 */
class SupabaseAuthClient(
    private val api: ApiClient,
    private val configProvider: () -> SupabaseConfig?,
) : SupabaseAuthApi {

    companion object {
        private const val TAG = "supabase"
    }

    override val configured: Boolean get() = configProvider() != null

    override suspend fun signIn(email: String, password: String): ApiResult<SupabaseSessionDto> {
        val config = configProvider()
            ?: return ApiResult.Err(com.metaloid.core.common.AppError.AuthUnconfigured("supabase not configured"))
        return api.postJsonAbsolute(
            base = config.url,
            path = "/auth/v1/token",
            body = buildJsonObject {
                put("email", email)
                put("password", password)
            },
            headers = authHeaders(config),
            serializer = SupabaseSessionDto.serializer(),
            query = mapOf("grant_type" to "password"),
        )
    }

    override suspend fun signUp(email: String, password: String): ApiResult<SupabaseSignUpOutcome> {
        val config = configProvider()
            ?: return ApiResult.Err(com.metaloid.core.common.AppError.AuthUnconfigured("supabase not configured"))
        val result = api.postJsonAbsolute(
            base = config.url,
            path = "/auth/v1/signup",
            body = buildJsonObject {
                put("email", email)
                put("password", password)
            },
            headers = authHeaders(config),
            serializer = JsonElement.serializer(),
        )
        return when (result) {
            is ApiResult.Err -> result
            is ApiResult.Ok -> ApiResult.Ok(interpretSignUp(result.value))
        }
    }

    override suspend fun refresh(refreshToken: String): ApiResult<SupabaseSessionDto> {
        val config = configProvider()
            ?: return ApiResult.Err(com.metaloid.core.common.AppError.AuthUnconfigured("supabase not configured"))
        return api.postJsonAbsolute(
            base = config.url,
            path = "/auth/v1/token",
            body = buildJsonObject { put("refresh_token", refreshToken) },
            headers = authHeaders(config),
            serializer = SupabaseSessionDto.serializer(),
            query = mapOf("grant_type" to "refresh_token"),
        )
    }

    override suspend fun signOut(accessToken: String): ApiResult<JsonElement> {
        val config = configProvider()
            ?: return ApiResult.Err(com.metaloid.core.common.AppError.AuthUnconfigured("supabase not configured"))
        return api.postJsonAbsolute(
            base = config.url,
            path = "/auth/v1/logout",
            body = buildJsonObject { },
            headers = authHeaders(config) + mapOf("Authorization" to "Bearer $accessToken"),
            serializer = JsonElement.serializer(),
        )
    }

    private fun authHeaders(config: SupabaseConfig): Map<String, String> = mapOf(
        "apikey" to config.anonKey,
        "Authorization" to "Bearer ${config.anonKey}",
    )

    /**
     * Sign-up has two honest outcomes.
     *
     * With email confirmation enabled the provider returns the user and **no
     * session**; reporting that as "signed in" would put a signed-in shell in
     * front of a user who has no token (rule R4).
     */
    private fun interpretSignUp(payload: JsonElement): SupabaseSignUpOutcome {
        val obj = runCatching { payload.jsonObject }.getOrNull()
        val direct = obj?.get("access_token")?.let { runCatching { it.jsonPrimitive.content }.getOrNull() }
        if (!direct.isNullOrBlank()) {
            val parsed = runCatching {
                MetaJson.decodeFromJsonElement(SupabaseSessionDto.serializer(), payload)
            }.getOrNull()
            if (parsed != null) return SupabaseSignUpOutcome.SignedIn(parsed)
        }
        val nested = obj?.get("session")
        if (nested != null) {
            val parsed = runCatching {
                MetaJson.decodeFromJsonElement(SupabaseSessionDto.serializer(), nested)
            }.getOrNull()
            if (parsed != null && parsed.accessToken.isNotBlank()) return SupabaseSignUpOutcome.SignedIn(parsed)
        }
        MetaLog.i(TAG, "sign-up succeeded without a session: email confirmation required")
        return SupabaseSignUpOutcome.ConfirmationRequired
    }
}
