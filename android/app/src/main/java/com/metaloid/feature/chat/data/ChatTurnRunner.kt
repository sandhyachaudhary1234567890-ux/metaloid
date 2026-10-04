package com.metaloid.feature.chat.data

import com.metaloid.core.common.AppError
import com.metaloid.core.common.MetaLog
import com.metaloid.core.network.ApiResult
import com.metaloid.core.network.MetaJson
import com.metaloid.core.streaming.ChatStreamRequest
import com.metaloid.core.streaming.StreamEvent
import com.metaloid.core.streaming.StreamTransport
import com.metaloid.data.api.MetaIoidApi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.concurrent.atomic.AtomicBoolean
import okhttp3.HttpUrl

/**
 * One turn of a conversation, start to finish, against the real gateway.
 *
 * The persistence order is dictated by the server's own rules and is not a
 * matter of taste (docs/ANDROID_API.md §4, verified in
 * `server/src/api/v1.js`):
 *
 *   1. the user message is appended **first** and must be non-empty;
 *   2. the assistant row **cannot** be created empty — `content` is required and
 *      non-empty, and a 400 is the only alternative — so it is created the
 *      moment the first token arrives, with `status: "streaming"`;
 *   3. the row is finalised exactly once: `complete` on `done`, `cancelled` on a
 *      user stop, `error` on a stream failure — always with the text that was
 *      actually produced, so a partial answer survives in the transcript
 *      instead of being lost with the socket;
 *   4. if the process dies mid-stream, the row is left in `streaming` and the
 *      gateway's `…/messages/recover` closes it as `cancelled` +
 *      `error_code: interrupted` on the next launch.
 *
 * Nothing here retries. A retry is a user decision (the UI offers it), because
 * a silent retry would double-charge a provider and could duplicate a message.
 */
class ChatTurnRunner(
    private val api: MetaIoidApi,
    private val transport: StreamTransport,
    private val chatUrlProvider: () -> HttpUrl?,
    private val tokenProvider: () -> String?,
    private val clock: () -> Long = System::currentTimeMillis,
) {

    private data class PersistenceResult(val messageId: String? = null, val error: AppError? = null)

    companion object {
        private const val TAG = "turn"

        /**
         * Task tiers the gateway recognises (`POST /api/chat`). Anything else
         * makes the server classify on its own, which is the right default: the
         * client does not own model routing (rule R6).
         */
        const val TASK_FAST = "fast"
        const val TASK_SMART = "smart"
        const val TASK_VOICE = "voice"
    }

    data class Turn(
        val conversationId: String,
        val text: String,
        val history: List<HistoryItem>,
        val task: String? = null,
        val requestId: String,
        val attachments: List<String> = emptyList(),
        /** False for retry/regenerate when this user row already exists remotely. */
        val appendUserMessage: Boolean = true,
        /** The exact optimistic row to reconcile after the server accepts it. */
        val optimisticUserId: String? = null,
        /** Distinguishes an explicit stop from a transport interruption in final persistence. */
        val stopRequested: AtomicBoolean = AtomicBoolean(false),
    )

    data class HistoryItem(val role: String, val content: String)

    /** What the ViewModel needs to hear about a turn. */
    sealed interface Update {
        data object Submitting : Update
        data class UserStored(val messageId: String, val optimisticUserId: String?) : Update
        data class RequestAccepted(val requestId: String) : Update
        data class AssistantRowOpened(val messageId: String) : Update
        data class AssistantRowSaved(val messageId: String) : Update
        /** The user message could not be stored — the turn cannot start. */
        data class Rejected(val error: AppError, val optimisticUserId: String?) : Update
        data class Event(val event: StreamEvent) : Update
        data class Finished(
            val finalText: String,
            val status: String,
            val latencyMs: Long,
            val error: AppError?,
            val persistenceError: AppError? = null,
        ) : Update
    }

    fun start(turn: Turn): Flow<Update> = flow {
        emit(Update.Submitting)

        // Validate the streaming endpoint before appending a new user row; a
        // missing gateway must not leave a duplicate-looking orphaned message.
        val url = chatUrlProvider()?.newBuilder()?.apply {
            addPathSegment("api")
            addPathSegment("chat")
        }?.build()
        if (url == null) {
            emit(Update.Rejected(AppError.Unreachable("no gateway configured"), turn.optimisticUserId))
            return@flow
        }

        if (turn.appendUserMessage) {
            val userAppend = api.appendMessage(
                conversationId = turn.conversationId,
                role = "user",
                content = turn.text,
                status = "complete",
                metadata = buildJsonObject { put("client_request_id", turn.requestId) },
            )
            when (userAppend) {
                is ApiResult.Err -> {
                    emit(Update.Rejected(userAppend.error, turn.optimisticUserId))
                    return@flow
                }
                is ApiResult.Ok -> emit(
                    Update.UserStored(userAppend.value.message?.id.orEmpty(), turn.optimisticUserId),
                )
            }
        }
        emit(Update.RequestAccepted(turn.requestId))

        val body = buildRequestBody(turn)
        val startedAt = clock()
        var text = ""
        var model: String? = null
        var provider: String? = null
        var demoSandbox = false
        var done = false
        var serverError: AppError? = null
        var rowId: String? = null
        var rowJob: Deferred<PersistenceResult>? = null
        // The terminal write happens **once**. Without this flag the `finally`
        // below would write a second time on the happy path — and when the
        // assistant row could not be created at the first attempt, that second
        // write creates a second row, i.e. the same answer twice in the
        // transcript.
        var finalised = false

        // The whole turn runs inside a `coroutineScope`, and the *finalisation*
        // runs in a `finally` under NonCancellable. That is what makes a user
        // pressing Stop (or the screen going away) leave a coherent record:
        // the partial text is written and the row is closed, instead of the
        // transcript keeping a turn that is "streaming" forever.
        try {
            coroutineScope {
                transport.open(
                    ChatStreamRequest(
                        url = url,
                        jsonBody = body,
                        accessToken = tokenProvider(),
                        requestId = turn.requestId,
                    )
                ).collect { event ->
                    emit(Update.Event(event))
                    when (event) {
                        is StreamEvent.Meta -> {
                            model = event.model ?: model
                            provider = event.provider ?: provider
                            demoSandbox = event.demo == true
                        }
                        is StreamEvent.Token -> {
                            // The protocol is cumulative. A retry reset changes
                            // this buffer, and every subsequent token replaces it.
                            text = event.cumulativeText
                            // The row is created asynchronously: awaiting here
                            // would pause token delivery for one round-trip.
                            if (rowId == null && rowJob == null && text.isNotBlank()) {
                                val snapshot = text
                                val snapshotModel = model
                                val snapshotProvider = provider
                                rowJob = async {
                                    openAssistantRow(turn.conversationId, snapshot, snapshotModel, snapshotProvider)
                                }
                            }
                        }
                        is StreamEvent.Retry -> {
                            text = ""
                            model = event.modelSlug
                            provider = null
                        }
                        StreamEvent.Done -> done = true
                        is StreamEvent.ServerError -> {
                            serverError = com.metaloid.core.network.ErrorMapper.fromStreamCode(event.code, event.message)
                        }
                        is StreamEvent.Failed -> serverError = event.error
                        else -> Unit
                    }
                }
                val opened = rowJob?.await()
                rowId = opened?.messageId
            }
            if (!done && serverError == null) {
                serverError = AppError.StreamInterrupted("stream closed without a terminal event")
                emit(Update.Event(StreamEvent.Failed(serverError!!)))
            }
            if (rowId != null) emit(Update.AssistantRowOpened(rowId!!))
            val latency = clock() - startedAt
            val status = when {
                serverError is AppError.Stopped -> "cancelled"
                serverError != null -> "error"
                done -> "complete"
                else -> "cancelled"
            }
            val persisted = writeFinalRow(
                existingRowId = rowId,
                conversationId = turn.conversationId,
                text = text,
                status = status,
                error = serverError,
                model = model,
                provider = provider,
                latencyMs = if (done && serverError == null) latency else null,
            )
            if (rowId == null && persisted.messageId != null) {
                emit(Update.AssistantRowOpened(persisted.messageId))
            }
            if (persisted.error == null && persisted.messageId != null) {
                emit(Update.AssistantRowSaved(persisted.messageId))
            }
            finalised = true
            if (persisted.error != null) {
                MetaLog.w(TAG, "turn persistence incomplete: %s", persisted.error.javaClass.simpleName)
            }
            MetaLog.i(TAG, "turn finished: status=%s chars=%d demo=%s latency=%dms", status, text.length, demoSandbox, latency)
            emit(Update.Finished(text, status, latency, serverError, persisted.error))
        } finally {
            // Reached on cancellation too: nothing may be left "in flight".
            // When the turn already wrote its own ending, this is a no-op — a
            // failed write is left to the gateway's `…/messages/recover`, the
            // same path that closes a row after the process died.
            withContext(NonCancellable) {
                if (finalised) return@withContext
                if (rowJob != null && rowId == null) {
                    rowId = runCatching { rowJob?.await()?.messageId }.getOrNull() ?: rowId
                }
                val stopped = turn.stopRequested.get()
                val finalWrite = writeFinalRow(
                    existingRowId = rowId,
                    conversationId = turn.conversationId,
                    text = text,
                    status = when {
                        serverError is AppError.Stopped -> "cancelled"
                        serverError != null -> "error"
                        done -> "complete"
                        text.isBlank() && rowId == null -> ""
                        else -> "cancelled"
                    },
                    error = serverError ?: when {
                        done -> null
                        stopped -> AppError.Stopped
                        else -> AppError.StreamInterrupted("stopped or interrupted")
                    },
                    model = model,
                    provider = provider,
                    latencyMs = null,
                    skipWhenBlank = true,
                )
                if (finalWrite.error != null) {
                    MetaLog.w(TAG, "cancelled turn could not be fully persisted: %s", finalWrite.error.javaClass.simpleName)
                }
                finalised = true
            }
        }
    }

    /**
     * Writes the terminal state of the turn.
     *
     * `existingRowId` is null when the first token never arrived — in that case
     * there is nothing to update and, deliberately, nothing is created: an empty
     * assistant row would be a bubble the user never asked for (case 4).
     */
    private suspend fun writeFinalRow(
        existingRowId: String?,
        conversationId: String,
        text: String,
        status: String,
        error: AppError?,
        model: String?,
        provider: String?,
        latencyMs: Long?,
        skipWhenBlank: Boolean = false,
    ): PersistenceResult {
        if (status.isEmpty()) return PersistenceResult()
        if (skipWhenBlank && text.isBlank() && existingRowId == null) return PersistenceResult()

        val messageId = existingRowId ?: if (text.isNotBlank()) {
            val opened = openAssistantRow(conversationId, text, model, provider)
            opened.messageId ?: return opened
        } else {
            return PersistenceResult()
        }
        val errorFromUpdate = finalise(messageId, text, status, error, latencyMs, model, provider)
        return PersistenceResult(messageId = messageId, error = errorFromUpdate)
    }

    private fun buildRequestBody(turn: Turn): String = MetaJson.encodeToString(
        kotlinx.serialization.json.JsonElement.serializer(),
        buildJsonObject {
            // Attachment names travel as context, not as fake content: the
            // gateway is told which files accompany the turn, and the files
            // themselves live in storage (they are never inlined as base64).
            val message = if (turn.attachments.isEmpty()) {
                turn.text
            } else {
                turn.text + "\n\n[Attached: " + turn.attachments.joinToString(", ") + "]"
            }
            put("message", message)
            if (!turn.task.isNullOrBlank()) put("task", turn.task)
            put(
                "history",
                kotlinx.serialization.json.JsonArray(
                    turn.history.takeLast(10).map { item ->
                        buildJsonObject {
                            put("role", item.role)
                            put("content", item.content)
                        }
                    }
                ),
            )
        },
    )

    /**
     * Creates the assistant row with the first token as its content.
     *
     * A failure here is not fatal to the turn: the user still sees the streamed
     * reply, and the transcript simply has no stored row for it. That is
     * reported (the ViewModel logs it and the UI does not claim it was saved).
     */
    private suspend fun openAssistantRow(
        conversationId: String,
        text: String,
        model: String?,
        provider: String?,
    ): PersistenceResult = try {
        when (
            val created = api.appendMessage(
                conversationId = conversationId,
                role = "assistant",
                content = text,
                status = "streaming",
                model = model,
                provider = provider,
            )
        ) {
            is ApiResult.Ok -> created.value.message?.id?.takeIf { it.isNotBlank() }?.let {
                PersistenceResult(messageId = it)
            } ?: PersistenceResult(error = AppError.DataUnavailable("assistant row id missing"))
            is ApiResult.Err -> {
                MetaLog.w(TAG, "could not open the assistant row: %s", created.error.javaClass.simpleName)
                PersistenceResult(error = created.error)
            }
        }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        MetaLog.w(TAG, "could not open the assistant row: %s", e.javaClass.simpleName)
        PersistenceResult(error = AppError.Unknown(e.javaClass.simpleName))
    }

    private suspend fun finalise(
        messageId: String,
        text: String,
        status: String,
        error: AppError?,
        latencyMs: Long?,
        model: String?,
        provider: String?,
    ): AppError? = try {
        when (
            val result = api.updateMessage(
                messageId = messageId,
                // An empty cumulative buffer after a `retry` must replace the
                // previous attempt's text, not leave stale output on the row.
                content = text,
                status = status,
                errorCode = errorCodeFor(status, error),
                latencyMs = latencyMs,
                model = model,
                provider = provider,
                updateRouting = true,
            )
        ) {
            is ApiResult.Ok -> if (result.value.message == null) {
                AppError.DataUnavailable("message finalization returned no row")
            } else null
            is ApiResult.Err -> {
                MetaLog.w(TAG, "could not finalise the assistant row: %s", result.error.javaClass.simpleName)
                result.error
            }
        }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        MetaLog.w(TAG, "could not finalise the assistant row: %s", e.javaClass.simpleName)
        AppError.Unknown(e.javaClass.simpleName)
    }

    /**
     * `error_code` values. `interrupted` is the gateway's own word for a
     * mid-stream loss (it writes it in `recover`), so it is reused rather than
     * invented; `stopped` is this client recording a deliberate user stop, which
     * the recover path cannot distinguish otherwise.
     */
    private fun errorCodeFor(status: String, error: AppError?): String? = when {
        status == "complete" -> null
        error is AppError.Stopped -> "stopped"
        error is AppError.StreamInterrupted -> "interrupted"
        error != null -> "stream_error"
        else -> "interrupted"
    }
}
