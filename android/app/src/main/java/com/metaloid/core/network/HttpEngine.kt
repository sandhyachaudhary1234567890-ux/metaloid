package com.metaloid.core.network

import com.metaloid.core.common.MetaLog
import com.metaloid.core.common.Redact
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLException
import okhttp3.Call
import okhttp3.Callback
import okhttp3.ConnectionPool
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

/**
 * The app's two HTTP clients.
 *
 * `api` is for request/response calls; `stream` is derived from it with an
 * unbounded read timeout, because a model that takes 20 seconds to think is
 * normal and a 30-second read timeout would cut it off. The streaming path does
 * not rely on the socket timeout for liveness — the gateway sends a `: ping`
 * comment every 8 seconds and `StreamTransport` enforces its own inactivity
 * window (Section 7.2).
 *
 * `retryOnConnectionFailure(false)` is deliberate: OkHttp's silent retry can
 * replay a POST. Every retry in this app is explicit, once, and observable.
 */
data class HttpClients(
    val api: OkHttpClient,
    val stream: OkHttpClient,
)

object HttpEngine {

    const val CONNECT_TIMEOUT_SECONDS = 15L
    const val READ_TIMEOUT_SECONDS = 65L

    fun create(
        tokenProvider: () -> String?,
        userAgent: String,
        verbose: Boolean,
    ): HttpClients {
        val base = OkHttpClient.Builder()
            .connectTimeout(CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .readTimeout(READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .writeTimeout(READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            // No whole-call timeout: the SSE stream legitimately lives for
            // minutes, and the server enforces its own 50-second cap.
            .callTimeout(0, TimeUnit.MILLISECONDS)
            .retryOnConnectionFailure(false)
            .connectionPool(ConnectionPool(6, 5, TimeUnit.MINUTES))
            .addInterceptor(HeaderInterceptor(tokenProvider, userAgent))
            .addInterceptor(RedactingLogger(verbose))
            .build()

        val stream = base.newBuilder()
            // The stream's liveness is enforced by our own inactivity watchdog,
            // which can tell "the server is quiet" from "the socket is dead".
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .build()

        return HttpClients(api = base, stream = stream)
    }

    /**
     * Adds the two headers every gateway call needs, and nothing else.
     *
     * The token is read per request (never captured), so a refresh that happens
     * while other calls are in flight is picked up by the next call without any
     * invalidation dance.
     */
    private class HeaderInterceptor(
        private val tokenProvider: () -> String?,
        private val userAgent: String,
    ) : Interceptor {
        override fun intercept(chain: Interceptor.Chain): Response {
            val original = chain.request()
            val builder: Request.Builder = original.newBuilder()
                .header("User-Agent", userAgent)
                .header("Accept", original.header("Accept") ?: "application/json")
            // An explicit Authorization header always wins. That is what lets
            // the identity provider be called with the *public anon key* while a
            // (possibly expired) session token still exists in memory.
            if (original.header("Authorization") == null) {
                tokenProvider()?.takeIf { it.isNotBlank() }?.let { builder.header("Authorization", "Bearer $it") }
            }
            return chain.proceed(builder.build())
        }
    }

    /**
     * Request logging that cannot leak a session.
     *
     * In a debug build it logs method, path, status and duration. The query
     * string is dropped (it can carry a cursor, which is an opaque handle to a
     * user's data) and response bodies are never logged, because a body is
     * message content.
     */
    private class RedactingLogger(private val verbose: Boolean) : Interceptor {
        override fun intercept(chain: Interceptor.Chain): Response {
            if (!verbose) return chain.proceed(chain.request())
            val request = chain.request()
            val startedAt = System.nanoTime()
            val response = chain.proceed(request)
            val millis = (System.nanoTime() - startedAt) / 1_000_000
            MetaLog.d(
                "http",
                "%s %s -> %d in %dms",
                request.method,
                Redact.url(request.url.toString()),
                response.code,
                millis,
            )
            return response
        }
    }
}

/**
 * Awaits a call without blocking a thread and without leaking the response when
 * the coroutine is cancelled mid-flight — the case that matters when a user
 * leaves a screen while a request is in flight.
 */
internal suspend fun Call.awaitResponse(): Response = suspendCancellableCoroutine { cont ->
    cont.invokeOnCancellation { runCatching { cancel() } }
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
            if (cont.isActive) cont.resumeWithException(e)
        }

        override fun onResponse(call: Call, response: Response) {
            // The continuation can already be cancelled (the user left the
            // screen). Closing the body here is what keeps that from leaking a
            // socket; resuming a cancelled continuation is a no-op, so the
            // `isActive` check is about the body, not the coroutine.
            if (cont.isActive) {
                cont.resume(response)
            } else {
                runCatching { response.close() }
            }
        }
    })
}

/**
 * Classifies a transport exception into the three cases the UI distinguishes.
 *
 * `UnknownHostException`/`ConnectException` mean the gateway could not be
 * reached; `SocketTimeoutException` means it was reached and did not answer in
 * time. Those lead to different sentences and different user actions, so the
 * difference is made here rather than guessed at in a ViewModel.
 */
internal fun classifyTransportError(e: IOException): TransportFailureKind = when (e) {
    is SocketTimeoutException -> TransportFailureKind.Timeout
    is UnknownHostException -> TransportFailureKind.Unreachable
    is SSLException -> TransportFailureKind.Unreachable
    else -> TransportFailureKind.Unreachable
}
