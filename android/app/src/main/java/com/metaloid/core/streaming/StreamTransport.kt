package com.metaloid.core.streaming

import com.metaloid.core.common.AppError
import com.metaloid.core.common.MetaLog
import com.metaloid.core.common.Redact
import com.metaloid.core.network.ErrorMapper
import com.metaloid.core.network.HttpClients
import com.metaloid.core.network.ServerEnvelope
import com.metaloid.core.network.classifyTransportError
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.IOException
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** Everything one streamed turn needs to reach the gateway. */
data class ChatStreamRequest(
    val url: HttpUrl,
    val jsonBody: String,
    val accessToken: String?,
    val requestId: String,
)

/**
 * A cold stream of protocol events.
 *
 * Cold on purpose: collecting it opens the connection and cancelling the
 * collector closes it. There is no "start" method to forget to call and no
 * handle to leak — the lifecycle of the socket is the lifecycle of the
 * collection, which is what makes "every stream has an owner and a guaranteed
 * close path" (Section 12) true by construction.
 */
interface StreamTransport {
    fun open(request: ChatStreamRequest): Flow<StreamEvent>
}

/**
 * SSE over OkHttp.
 *
 * The details that matter, each of which has bitten a worse implementation:
 *
 *  * **Cancellation closes the socket.** `invokeOnCompletion { call.cancel() }`
 *    runs when the collecting coroutine is cancelled, which unblocks the read
 *    and stops the server from spending tokens on a reply nobody will see.
 *  * **Inactivity is enforced separately from the socket timeout.** The stream
 *    client has *no* read timeout (a thinking model is silent for seconds);
 *    a watchdog coroutine aborts the call after [INACTIVITY_TIMEOUT_MS] of
 *    silence, and the gateway's own `: ping` every 8 s keeps that from firing on
 *    a healthy-but-slow turn.
 *  * **Headers are handled before frames.** A non-2xx response is a JSON error
 *    envelope, not a stream; it is mapped to a typed error and the flow ends.
 *  * **The parser is fed the bytes, not the lines.** Chunk boundaries are
 *    irrelevant to correctness because [SseParser] holds its own partial state.
 */
class OkHttpStreamTransport(
    private val clients: HttpClients,
    private val io: CoroutineDispatcher,
    private val verbose: Boolean,
    private val inactivityTimeoutMs: Long = INACTIVITY_TIMEOUT_MS,
    /** Device connectivity, for the offline-versus-unreachable distinction. */
    private val online: () -> Boolean = { true },
) : StreamTransport {

    companion object {
        private const val TAG = "stream"

        /**
         * Well above the gateway's 8-second heartbeat and its 50-second
         * hard cap, and above the 5–15 s time-to-first-token that free models
         * routinely take. Long enough to be invisible, short enough that a dead
         * socket is reported while the user is still looking at the screen.
         */
        const val INACTIVITY_TIMEOUT_MS = 75_000L

        private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

        /** How often the inactivity watchdog wakes up to compare timestamps. */
        private const val WATCHDOG_TICK_MS = 5_000L
    }

    override fun open(request: ChatStreamRequest): Flow<StreamEvent> = flow {
        val call = clients.stream.newCall(buildHttpRequest(request))
        // Registered before the first byte is requested, so a cancellation that
        // arrives during connection setup still closes the socket.
        val cancellation = (coroutineContext[Job])?.invokeOnCompletion { runCatching { call.cancel() } }
        var lastActivityAt = System.currentTimeMillis()
        try {
            coroutineScope {
                val watchdog = launch {
                    while (isActive) {
                        delay(WATCHDOG_TICK_MS)
                        val quietFor = System.currentTimeMillis() - lastActivityAt
                        if (quietFor >= inactivityTimeoutMs) {
                            MetaLog.w(TAG, "stream went quiet for %dms; aborting the request", quietFor)
                            runCatching { call.cancel() }
                            break
                        }
                    }
                }
                try {
                    call.execute().use { response ->
                        if (!response.isSuccessful) {
                            val text = response.body?.string().orEmpty()
                            val envelope = ServerEnvelope.parse(text)
                            val retryAfter = response.header("Retry-After")?.toIntOrNull() ?: envelope.retryAfterSeconds
                            MetaLog.w(TAG, "stream refused: %d %s", response.code, Redact.text(envelope.code))
                            emit(
                                StreamEvent.Failed(
                                    ErrorMapper.fromHttp(
                                        status = response.code,
                                        code = envelope.code,
                                        serverMessage = envelope.message,
                                        retryAfterSeconds = retryAfter,
                                        errorCode = envelope.errorCode,
                                    )
                                )
                            )
                            return@use
                        }
                        emit(StreamEvent.Connected)
                        val source = response.body?.source()
                        if (source == null) {
                            emit(StreamEvent.Failed(AppError.StreamInterrupted("empty body")))
                            return@use
                        }
                        val parser = SseParser()
                        while (isActive) {
                            val line = try {
                                source.readUtf8Line()
                            } catch (e: IOException) {
                                // Reached on a cancel too; the isActive check below
                                // decides whether that is an error or a stop.
                                if (!isActive) break
                                MetaLog.w(TAG, "stream read failed: %s", e.javaClass.simpleName)
                                emit(
                                    StreamEvent.Failed(
                                        ErrorMapper.fromTransport(classifyTransportError(e, online()), e.javaClass.simpleName)
                                    )
                                )
                                return@use
                            }
                            if (line == null) break
                            lastActivityAt = System.currentTimeMillis()
                            // readUtf8Line() strips the terminator, so it is put
                            // back for the parser — which is what lets a frame be
                            // reassembled correctly across chunk boundaries.
                            parser.feed(line + "\n").forEach { frame ->
                                StreamEventParser.parse(frame).forEach { emit(it) }
                            }
                        }
                        parser.finish().forEach { frame ->
                            StreamEventParser.parse(frame).forEach { emit(it) }
                        }
                    }
                } finally {
                    watchdog.cancel()
                }
            }
        } catch (e: IOException) {
            if (!coroutineContext.isActive) return@flow
            MetaLog.w(TAG, "stream failed: %s", e.javaClass.simpleName)
            emit(StreamEvent.Failed(ErrorMapper.fromTransport(classifyTransportError(e, online()), e.javaClass.simpleName)))
        } finally {
            cancellation?.dispose()
        }
    }.flowOn(io)

    private fun buildHttpRequest(request: ChatStreamRequest): Request {
        val builder = Request.Builder()
            .url(request.url)
            .post(request.jsonBody.toRequestBody(JSON_MEDIA))
            .header("Accept", "text/event-stream")
            .header("Cache-Control", "no-store")
            // Sent so a server-side log can correlate a turn without any user
            // identifier: it is generated per send by the client and is not a
            // secret. (The gateway does not require it; it is harmless if
            // ignored, and useful when it is not.)
            .header("X-Request-Id", request.requestId)
        request.accessToken?.takeIf { it.isNotBlank() }?.let { builder.header("Authorization", "Bearer $it") }
        return builder.build()
    }

}
