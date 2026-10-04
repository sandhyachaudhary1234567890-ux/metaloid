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
    )

    data class HistoryItem(val role: String, val content: String)

    /** What the ViewModel needs to hear about a turn. */
    sealed interface Update {
        data object Submitting : Update
        data class UserStored(val messageId: String) : Update
        data class RequestAccepted(val requestId: String) : Update
        data class AssistantRowOpened(val messageId: String) : Update
        /** The user message could not be stored — the turn cannot start. */
        data class Rejected(val error: AppError) : Update
        data class Event(val event: StreamEvent) : Update
        data class Finished(
            val finalText: String,
            val status: String,
            val latencyMs: Long,
            val error: AppError?,
        ) : Update
    }

    fun start(turn: Turn): Flow<Update> = flow {
        emit(Update.Submitting)

        val userAppend = api.appendMessage(
            conversationId = turn.conversationId,
            role = "user",
            content = turn.text,
            status = "complete",
            metadata = buildJsonObject { put("client_request_id", turn.requestId) },
        )
        when (userAppend) {
            is ApiResult.Err -> {
                // Nothing was sent to a model: the turn stops here and the UI
                // says why. The user's text is still in the composer/draft.
                emit(Update.Rejected(userAppend.error))
                return@flow
            }
            is ApiResult.Ok -> emit(Update.UserStored(userAppend.value.message?.id ?: ""))
        }
        emit(Update.RequestAccepted(turn.requestId))

        val url = chatUrlProvider()?.newBuilder()?.apply {
            addPathSegment("api")
            addPathSegment("chat")
        }?.build()
        if (url == null) {
            emit(Update.Rejected(AppError.Unreachable("no gateway configured")))
            return@flow
        }

        val body = buildRequestBody(turn)
        val startedAt = clock()
        var text = ""
        var model: String? = null
        var provider: String? = null
        var demoSandbox = false
        var done = false
        var serverError: AppError? = null
        var rowId: String? = null
        var rowJob: Deferred<String?>? = null

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
                            text = event.cumulativeText
                            // The row is created asynchronously: awaiting here
                            // would pause token delivery for one round-trip,
                            // which is visible on a fast model.
                            if (rowId == null && rowJob == null && text.isNotBlank()) {
                                val snapshot = text
                                val snapshotModel = model
                                val snapshotProvider = provider
                                rowJob = async {
                                    openAssistantRow(turn.conversationId, snapshot, snapshotModel, snapshotProvider)
                                }
                            }
                        }
                        StreamEvent.Done -> done = true
                        is StreamEvent.ServerError -> {
                            serverError = com.metaloid.core.network.ErrorMapper.fromStreamCode(event.code, event.message)
                        }
                        else -> Unit
                    }
                }
                rowId = rowJob?.await()
            }
            if (rowId != null) emit(Update.AssistantRowOpened(rowId))
            val latency = clock() - startedAt
            val status = when {
                done -> "complete"
                serverError != null -> "error"
                else -> "cancelled"
            }
            writeFinalRow(
                existingRowId = rowId,
                conversationId = turn.conversationId,
                text = text,
                status = status,
                error = serverError,
                model = model,
                provider = provider,
                latencyMs = if (done) latency else null,
            )
            MetaLog.i(TAG, "turn finished: status=%s chars=%d demo=%s latency=%dms", status, text.length, demoSandbox, latency)
            emit(Update.Finished(text, status, latency, serverError))
        } finally {
            // Reached on cancellation too: nothing may be left "in flight".
            withContext(NonCancellable) {
                if (!done && rowJob != null && rowId == null) {
                    rowId = runCatching { rowJob?.await() }.getOrNull() ?: rowId
                }
                writeFinalRow(
                    existingRowId = rowId,
                    conversationId = turn.conversationId,
                    text = text,
                    status = when {
                        done -> "complete"
                        serverError != null -> "error"
                        text.isBlank() -> "" // nothing to write; no row was created
                        else -> "cancelled"
                    },
                    error = serverError ?: if (done) null else AppError.StreamInterrupted("stopped or interrupted"),
                    model = model,
                    provider = provider,
                    latencyMs = null,
                    skipWhenBlank = true,
                )
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
    ) {
        if (status.isEmpty()) return
        if (skipWhenBlank && text.isBlank() && existingRowId == null) return
        if (existingRowId == null) {
            // Text exists but the row was never created (a failure between the
            // first token and the insert). Store it now so the turn is not lost.
            if (text.isBlank()) return
            val created = openAssistantRow(conversationId, text, model, provider)
            if (created != null) {
                finalise(created, text, status, error, latencyMs)
            }
            return
        }
        finalise(existingRowId, text, status, error, latencyMs)
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
    ): String? = try {
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
            is ApiResult.Ok -> created.value.message?.id
            is ApiResult.Err -> {
                MetaLog.w(TAG, "could not open the assistant row: %s", created.error.javaClass.simpleName)
                null
            }
        }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        MetaLog.w(TAG, "could not open the assistant row: %s", e.javaClass.simpleName)
        null
    }

    private suspend fun finalise(
        messageId: String?,
        text: String,
        status: String,
        error: AppError?,
        latencyMs: Long? = null,
    ) {
        if (messageId == null) return
        try {
            api.updateMessage(
                messageId = messageId,
                content = text.ifBlank { null },
                status = status,
                errorCode = errorCodeFor(status, error),
                latencyMs = latencyMs,
            )
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            MetaLog.w(TAG, "could not finalise the assistant row: %s", e.javaClass.simpleName)
        }
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
