package com.metaloid.core.network

import com.metaloid.core.common.AppError
import com.metaloid.core.common.MetaLog
import com.metaloid.core.common.Redact
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonElement
import java.io.IOException
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * The result of a gateway call: either a decoded value or a typed [AppError].
 *
 * Deliberately not `kotlin.Result`: an [AppError] is a *value the UI renders*,
 * not an exception to be rethrown, and the compiler should force every call
 * site to handle it.
 */
sealed interface ApiResult<out T> {
    data class Ok<T>(val value: T) : ApiResult<T>
    data class Err(val error: AppError) : ApiResult<Nothing>

    fun getOrNull(): T? = (this as? Ok)?.value
    val errorOrNull: AppError? get() = (this as? Err)?.error
}

inline fun <T, R> ApiResult<T>.map(transform: (T) -> R): ApiResult<R> = when (this) {
    is ApiResult.Ok -> ApiResult.Ok(transform(value))
    is ApiResult.Err -> this
}

inline fun <T> ApiResult<T>.onOk(action: (T) -> Unit): ApiResult<T> {
    if (this is ApiResult.Ok) action(value)
    return this
}

/**
 * Who the client is talking to, and as whom.
 *
 * The base URL is user-configurable (first run, or Settings → Backend) because
 * a MetaIoid deployment is a URL the user owns — a self-hosted gateway, a
 * Vercel project, a Render service. It is never discovered from a hard-coded
 * host, and it is never inferred from a value the user cannot see.
 */
class NetworkContext(
    private val baseUrlProvider: () -> HttpUrl?,
    private val tokenProvider: () -> String?,
    private val sessionExpired: suspend () -> Unit,
) {
    fun baseUrlOrNull(): HttpUrl? = baseUrlProvider()

    /** The current bearer token, refreshed by the session manager when needed. */
    fun accessTokenOrNull(): String? = tokenProvider()

    /**
     * Called when the server rejects our token in a way a refresh cannot fix.
     * One place, so "signed out everywhere" cannot mean three different things.
     */
    suspend fun onSessionRejected() = sessionExpired()
}

/**
 * Refresh coordinator — the single place a token is renewed.
 *
 * Concurrent 401s must trigger exactly one refresh: the others wait for it and
 * retry once with the result (Section 8.1). This interface is what the session
 * manager implements and what the API client depends on, so the "one refresh"
 * property is testable without a network.
 */
interface SessionRefresher {
    /** Returns a new access token, or null when refreshing is impossible. */
    suspend fun refresh(): String?
}

/**
 * The single HTTP entry point for the whole app.
 *
 * Everything the app does over HTTP goes through here: one client, one auth
 * path, one retry policy, one error mapper. Where the request goes
 * (`/api/…` or `/api/v1/…`) is the caller's business; *how* it is sent and how
 * it fails is not (rule R2/R10).
 *
 * Retry policy, in full:
 *   * 401 with a token we still hold → refresh once, retry once.
 *   * 401 the refresh cannot fix → end the session, with a real reason.
 *   * 429 → never retried automatically; the server said when to come back.
 *   * everything else → returned to the caller, which decides.
 */
class ApiClient(
    private val clients: HttpClients,
    private val context: NetworkContext,
    private val sessionRefresh: SessionRefresher,
    private val io: CoroutineDispatcher,
    private val verbose: Boolean,
) {

    companion object {
        private const val TAG = "api"
        private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
    }

    suspend fun <T> get(
        path: String,
        query: Map<String, String?> = emptyMap(),
        serializer: KSerializer<T>,
    ): ApiResult<T> = request("GET", path, query, null, serializer)

    suspend fun <T> post(
        path: String,
        body: JsonElement? = null,
        query: Map<String, String?> = emptyMap(),
        serializer: KSerializer<T>,
    ): ApiResult<T> = request("POST", path, query, body, serializer)

    suspend fun <T> patch(
        path: String,
        body: JsonElement? = null,
        serializer: KSerializer<T>,
    ): ApiResult<T> = request("PATCH", path, emptyMap(), body, serializer)

    suspend fun <T> put(
        path: String,
        body: JsonElement? = null,
        serializer: KSerializer<T>,
    ): ApiResult<T> = request("PUT", path, emptyMap(), body, serializer)

    suspend fun <T> delete(
        path: String,
        body: JsonElement? = null,
        serializer: KSerializer<T>,
    ): ApiResult<T> = request("DELETE", path, emptyMap(), body, serializer)

    /** For endpoints whose body the app ignores entirely. */
    suspend fun postDiscardingBody(path: String, body: JsonElement? = null): ApiResult<Unit> =
        execute(
            build("POST", path, emptyMap(), body) ?: return ApiResult.Err(AppError.Unreachable("no base url")),
            decode = { },
            allowRefreshRetry = true,
        )

    /**
     * Sends a JSON POST to an absolute base URL with explicit headers.
     *
     * Used for exactly one thing: the identity provider (Supabase GoTrue), which
     * lives on a different origin from the gateway and authenticates with the
     * public anon key rather than the user's session bearer token.
     *
     * `allowRefreshRetry` is false here by construction — a token refresh is
     * what *provides* the session, so retrying it on 401 would recurse.
     */
    suspend fun <T> postJsonAbsolute(
        base: HttpUrl,
        path: String,
        body: JsonElement,
        headers: Map<String, String>,
        serializer: KSerializer<T>,
        query: Map<String, String> = emptyMap(),
    ): ApiResult<T> {
        val urlBuilder = base.newBuilder()
        path.trimStart('/').split('/').forEach { if (it.isNotEmpty()) urlBuilder.addPathSegment(it) }
        query.forEach { (name, value) -> urlBuilder.addQueryParameter(name, value) }
        val requestBuilder = Request.Builder()
            .url(urlBuilder.build())
            .post(MetaJson.encodeToString(JsonElement.serializer(), body).toRequestBody(JSON_MEDIA))
        headers.forEach { (name, value) -> requestBuilder.header(name, value) }
        return execute(requestBuilder.build(), decode = { text -> decodeOrThrow(text, serializer) }, allowRefreshRetry = false)
    }

    private suspend fun <T> request(
        method: String,
        path: String,
        query: Map<String, String?>,
        body: JsonElement?,
        serializer: KSerializer<T>,
    ): ApiResult<T> {
        val request = build(method, path, query, body)
            ?: return ApiResult.Err(AppError.Unreachable("no base url configured"))
        val result = execute(request, decode = { text -> decodeOrThrow(text, serializer) }, allowRefreshRetry = true)
        // A token the server has definitively rejected ends the session here,
        // once, rather than in each screen that happens to call the API.
        if (result is ApiResult.Err && result.error is AppError.SessionExpired) {
            context.onSessionRejected()
        }
        return result
    }

    private fun build(
        method: String,
        path: String,
        query: Map<String, String?>,
        body: JsonElement?,
    ): Request? {
        val base: HttpUrl = context.baseUrlOrNull() ?: return null
        val urlBuilder = base.newBuilder()
        // `path` is always an app-owned literal ("/api/v1/me") — never user
        // input — so no value here can escape the configured origin.
        path.trimStart('/').split('/').forEach { segment -> if (segment.isNotEmpty()) urlBuilder.addPathSegment(segment) }
        query.forEach { (key, value) -> if (value != null) urlBuilder.addQueryParameter(key, value) }
        val payload = body?.let { MetaJson.encodeToString(JsonElement.serializer(), it) }
        val builder = Request.Builder().url(urlBuilder.build())
        when (method) {
            "GET" -> builder.get()
            "POST" -> builder.post((payload ?: "{}").toRequestBody(JSON_MEDIA))
            "PATCH" -> builder.patch((payload ?: "{}").toRequestBody(JSON_MEDIA))
            "PUT" -> builder.put((payload ?: "{}").toRequestBody(JSON_MEDIA))
            "DELETE" -> if (payload != null) builder.delete(payload.toRequestBody(JSON_MEDIA)) else builder.delete()
            else -> return null
        }
        return builder.build()
    }

    private suspend fun <T> execute(
        request: Request,
        decode: (String) -> T,
        allowRefreshRetry: Boolean,
    ): ApiResult<T> {
        val first = send(request, decode)
        if (allowRefreshRetry && first is ApiResult.Err && shouldRefresh(first.error)) {
            val refreshed = sessionRefresh.refresh()
            if (refreshed != null) {
                // Rebuilt from the original and sent once more, with the new
                // token supplied by the header interceptor. One retry, no loop.
                return send(request, decode)
            }
            MetaLog.w(TAG, "refresh failed; %s stays unauthorized", Redact.url(request.url.toString()))
        }
        return first
    }

    private fun shouldRefresh(error: AppError): Boolean =
        error is AppError.SessionExpired && context.accessTokenOrNull() != null

    private suspend fun <T> send(request: Request, decode: (String) -> T): ApiResult<T> = withContext(io) {
        try {
            clients.api.newCall(request).awaitResponse().use { response ->
                val text = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    val envelope = ServerEnvelope.parse(text)
                    val retryAfter = response.header("Retry-After")?.toIntOrNull() ?: envelope.retryAfterSeconds
                    MetaLog.w(
                        TAG,
                        "%s %s failed: %d %s",
                        request.method,
                        Redact.url(request.url.toString()),
                        response.code,
                        Redact.text(envelope.code),
                    )
                    return@withContext ApiResult.Err(
                        ErrorMapper.fromHttp(
                            status = response.code,
                            code = envelope.code,
                            serverMessage = envelope.message,
                            retryAfterSeconds = retryAfter,
                            errorCode = envelope.errorCode,
                        )
                    )
                }
                return@withContext try {
                    ApiResult.Ok(decode(text))
                } catch (e: Exception) {
                    // A body that does not match its documented shape is a
                    // contract violation, reported as such instead of as a
                    // blank screen. The technical detail never reaches the UI.
                    MetaLog.e(TAG, "response didn't match its schema: %s", e, e.javaClass.simpleName)
                    ApiResult.Err(AppError.Unknown("schema:${e.javaClass.simpleName}"))
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: IOException) {
            val kind = classifyTransportError(e)
            MetaLog.w(TAG, "%s %s transport failure: %s", request.method, Redact.url(request.url.toString()), kind.name)
            ApiResult.Err(ErrorMapper.fromTransport(kind, e.javaClass.simpleName))
        } catch (e: Exception) {
            MetaLog.e(TAG, "unexpected failure for %s", e, Redact.url(request.url.toString()))
            ApiResult.Err(AppError.Unknown(e.javaClass.simpleName))
        }
    }

    private fun <T> decodeOrThrow(text: String, serializer: KSerializer<T>): T =
        MetaJson.decodeFromString(serializer, text)

}
