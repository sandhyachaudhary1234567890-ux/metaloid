package com.metaloid.feature.chat

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.metaloid.core.common.AppError
import com.metaloid.core.common.MetaLog
import com.metaloid.core.network.ApiResult
import com.metaloid.core.storage.DraftStore
import com.metaloid.data.dto.ConversationDto
import com.metaloid.data.dto.ModelDto
import com.metaloid.di.AppContainer
import com.metaloid.feature.chat.data.ChatTurnRunner
import com.metaloid.feature.chat.domain.StreamPhase
import com.metaloid.feature.chat.domain.StreamReducer
import com.metaloid.feature.chat.domain.StreamState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.UUID

/**
 * Conversation + turn orchestration for the chat screen.
 *
 * It owns no networking and no parsing: it calls [ChatTurnRunner] (which owns the
 * persistence order and the SSE stream) and [StreamReducer] (a pure function of
 * state and event), then publishes an immutable [UiState]. Everything the screen
 * renders is in that state object, which is why the screen itself contains no
 * decision logic (rule R10).
 *
 * Send policy (case 13): **one turn at a time, strictly ordered**. While a turn
 * is in flight the composer turns into Stop; a second send is refused rather
 * than interleaved, because two streams writing into one bubble is not a state
 * any user can reason about.
 */
class ChatViewModel(private val container: AppContainer) : ViewModel() {

    companion object {
        private const val TAG = "chat"
    }

    /** An attachment the user added, with its real upload state. */
    data class PendingAttachment(
        val localId: String,
        val displayName: String,
        val mimeType: String,
        val sizeBytes: Long?,
        val uri: Uri,
        val state: AttachmentState,
        val attachmentId: String? = null,
        val progress: Float? = null,
        val error: AppError? = null,
    )

    enum class AttachmentState { Selected, Uploading, Confirmed, Failed }

    data class UiState(
        val conversationId: String? = null,
        val conversation: ConversationDto? = null,
        val messages: List<ChatMessage> = emptyList(),
        val stream: StreamState = StreamState(),
        val draft: String = "",
        val attachments: List<PendingAttachment> = emptyList(),
        val loading: Boolean = false,
        val loadError: AppError? = null,
        val sendError: AppError? = null,
        /** True while the list is showing the local read-cache, not the server. */
        val showingCachedData: Boolean = false,
        val cacheAgeMs: Long? = null,
        /** A real tool/capability label from the server, e.g. "Searching…". */
        val toolActivity: String? = null,
        val models: List<ModelDto> = emptyList(),
        val selectedModel: String? = null,
        val uploadsEnabled: Boolean = true,
    ) {
        val isStreaming: Boolean get() = stream.phase.isActive
        val canSend: Boolean get() = draft.isNotBlank() && !isStreaming
        val hasConfirmedAttachments: Boolean get() = attachments.any { it.state == AttachmentState.Confirmed }
        val hasUnconfirmedAttachments: Boolean get() = attachments.any { it.state != AttachmentState.Confirmed }
    }

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    private val drafts = DraftStore(
        file = java.io.File(container.appFilesDir(), "metaloid.drafts.json"),
        scope = viewModelScope,
    )

    private var turnJob: Job? = null
    private var lastUserText: String? = null
    private var lastUserMessageId: String? = null
    private var assistantLocalId: String? = null
    private var requestSeq = 0L
    private val sendLock = Mutex()

    // ── opening a conversation ──────────────────────────────────────────────

    /**
     * Opens a conversation: cached transcript first (labelled), then the server.
     *
     * Two things happen before anything is shown as live:
     *   * `…/messages/recover` closes any turn the server still has open, so a
     *     process death mid-stream becomes `cancelled/interrupted` instead of an
     *     eternal spinner;
     *   * the draft for this conversation is restored, because it is the one
     *     thing the server has never seen.
     */
    fun open(conversationId: String?) {
        if (conversationId == null) {
            _state.value = UiState(uploadsEnabled = container.uploadsEnabled())
            return
        }
        if (_state.value.conversationId == conversationId && _state.value.messages.isNotEmpty()) return
        _state.value = UiState(conversationId = conversationId, loading = true, uploadsEnabled = container.uploadsEnabled())
        viewModelScope.launch {
            val cached = container.conversations.cachedMessages(conversationId)
            if (cached.isNotEmpty()) {
                _state.value = _state.value.copy(
                    messages = cached.map { it.toChatMessage() },
                    showingCachedData = true,
                    cacheAgeMs = container.conversations.cacheAgeMs(System.currentTimeMillis()),
                    loading = false,
                )
            }
            // A share that was waiting for this conversation becomes the draft.
            // It is never sent automatically: sharing selects a recipient, not a
            // decision to speak.
            val shared = com.metaloid.core.share.PendingShare.claimFor(conversationId)
            val draft = shared ?: drafts.get(conversationId)
            if (draft.isNotEmpty()) {
                _state.value = _state.value.copy(draft = draft)
                if (shared != null) drafts.put(conversationId, shared)
            }
            lastUserText = cached.lastOrNull { it.role == "user" }?.content

            when (val loaded = container.conversations.loadMessages(conversationId)) {
                is ApiResult.Ok -> {
                    _state.value = _state.value.copy(
                        messages = loaded.value.map { it.toChatMessage() },
                        showingCachedData = false,
                        cacheAgeMs = null,
                        loading = false,
                        loadError = null,
                    )
                    lastUserText = loaded.value.lastOrNull { it.role == "user" }?.content
                    lastUserMessageId = loaded.value.lastOrNull { it.role == "user" }?.id
                    val recovered = container.conversations.recoverInterrupted(conversationId)
                    if (recovered > 0) {
                        // The server closed the open turns; re-read so the UI
                        // shows the real rows rather than our local guess.
                        MetaLog.i(TAG, "recovered %d interrupted message(s)", recovered)
                        (container.conversations.loadMessages(conversationId) as? ApiResult.Ok)?.let { refreshed ->
                            _state.value = _state.value.copy(messages = refreshed.value.map { it.toChatMessage() })
                        }
                    }
                }
                is ApiResult.Err -> {
                    _state.value = _state.value.copy(
                        loading = false,
                        loadError = loaded.error,
                        // If a cache was shown, keep showing it and say so.
                        showingCachedData = cached.isNotEmpty(),
                    )
                }
            }
            loadModels()
        }
    }

    fun loadModels() {
        viewModelScope.launch {
            when (val models = container.api.listModels()) {
                is ApiResult.Ok -> _state.value = _state.value.copy(models = models.value.models)
                is ApiResult.Err -> MetaLog.w(TAG, "model list unavailable: %s", models.error.javaClass.simpleName)
            }
            when (val settings = container.api.providerSettings()) {
                is ApiResult.Ok -> _state.value = _state.value.copy(selectedModel = settings.value.settings?.defaultModel)
                is ApiResult.Err -> Unit
            }
        }
    }

    /**
     * Changes the model for this account through the gateway.
     *
     * It is explicit, it is persisted server-side, and it is never a silent
     * switch: the user picks, the server records, and the next turn uses it
     * (rules R6/R8).
     */
    fun selectModel(modelId: String) {
        val previous = _state.value.selectedModel
        _state.value = _state.value.copy(selectedModel = modelId)
        viewModelScope.launch {
            when (val result = container.api.updateProviderSettings(defaultModel = modelId)) {
                is ApiResult.Ok -> MetaLog.i(TAG, "model preference stored")
                is ApiResult.Err -> {
                    MetaLog.w(TAG, "model preference rejected: %s", result.error.javaClass.simpleName)
                    _state.value = _state.value.copy(selectedModel = previous, sendError = result.error)
                }
            }
        }
    }

    // ── composer ────────────────────────────────────────────────────────────

    fun onDraftChange(text: String) {
        _state.value = _state.value.copy(draft = text, sendError = null)
        _state.value.conversationId?.let { drafts.put(it, text) }
    }

    fun clearSendError() {
        _state.value = _state.value.copy(sendError = null)
    }

    // ── sending ─────────────────────────────────────────────────────────────

    fun send() {
        val current = _state.value
        val text = current.draft.trim()
        if (text.isEmpty()) return
        if (current.isStreaming) {
            // Nothing is queued silently: the composer is a Stop button while a
            // turn runs, so reaching here means a double tap.
            return
        }
        if (current.hasUnconfirmedAttachments) {
            _state.value = current.copy(sendError = AppError.UploadFailed("wait for the attachment to finish"))
            return
        }
        viewModelScope.launch {
            sendLock.withLock {
                val requestId = newRequestId()
                val conversationId = current.conversationId ?: createConversation() ?: return@withLock
                val confirmedNames = _state.value.attachments
                    .filter { it.state == AttachmentState.Confirmed }
                    .map { it.displayName }
                val history = _state.value.messages
                    .filter { it.role == MessageRole.User || it.role == MessageRole.Assistant }
                    .filter { it.text.isNotBlank() }
                    .map { ChatTurnRunner.HistoryItem(if (it.role == MessageRole.User) "user" else "assistant", it.text) }

                // The user's own message appears immediately but is marked
                // `Sending` until the server returns the row (rule R4: nothing is
                // shown as sent before the server accepted it).
                val localUserId = "local-user-$requestId"
                assistantLocalId = "local-assistant-$requestId"
                lastUserText = text
                appendMessage(
                    ChatMessage(
                        id = localUserId,
                        role = MessageRole.User,
                        text = text,
                        state = MessageState.Sending,
                        localOnly = true,
                    )
                )
                _state.value = _state.value.copy(
                    draft = "",
                    attachments = emptyList(),
                    stream = StreamState(phase = StreamPhase.Submitting, startedAtMs = System.currentTimeMillis()),
                )
                drafts.clear(conversationId)
                lastUserMessageId = localUserId

                val turn = ChatTurnRunner.Turn(
                    conversationId = conversationId,
                    text = text,
                    history = history,
                    task = null,
                    requestId = requestId,
                    attachments = confirmedNames,
                )
                turnJob = launchTurn(turn)
            }
        }
    }

    /**
     * Retry after a failure: re-runs **the last user message** without creating
     * a second one (case 15). The failed assistant row stays in the transcript
     * as history, which is what it is.
     */
    fun retryLast() {
        val text = lastUserText ?: return
        if (_state.value.isStreaming) return
        viewModelScope.launch { startTurnForExistingMessage(text) }
    }

    /**
     * Regenerate: a new answer to the same question.
     *
     * The gateway has no variant/branch endpoint, so this appends a new assistant
     * message and keeps the previous one — silently replacing it would delete
     * something the server still holds.
     */
    fun regenerate() {
        val text = _state.value.messages.lastOrNull { it.role == MessageRole.User }?.text ?: lastUserText ?: return
        if (_state.value.isStreaming) return
        viewModelScope.launch { startTurnForExistingMessage(text) }
    }

    private suspend fun startTurnForExistingMessage(text: String) {
        val conversationId = _state.value.conversationId ?: return
        val requestId = newRequestId()
        assistantLocalId = "local-assistant-$requestId"
        val history = _state.value.messages
            .filter { (it.role == MessageRole.User || it.role == MessageRole.Assistant) && it.text.isNotBlank() }
            .map { ChatTurnRunner.HistoryItem(if (it.role == MessageRole.User) "user" else "assistant", it.text) }
        _state.value = _state.value.copy(stream = StreamState(phase = StreamPhase.Submitting, startedAtMs = System.currentTimeMillis()))
        turnJob = launchTurn(
            ChatTurnRunner.Turn(
                conversationId = conversationId,
                text = text,
                history = history.dropLast(1),
                task = null,
                requestId = requestId,
            )
        )
    }

    private fun launchTurn(turn: ChatTurnRunner.Turn): Job = viewModelScope.launch {
        try {
            container.turnRunner.start(turn).collect { update -> reduce(update) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            MetaLog.e(TAG, "turn orchestration failed", e)
            _state.value = _state.value.copy(
                stream = StreamReducer.onTransportLoss(_state.value.stream, AppError.Unknown(e.javaClass.simpleName)),
            )
            finaliseAssistantMessage(_state.value.stream.text, MessageState.Failed)
        }
    }

    private fun reduce(update: ChatTurnRunner.Update) {
        when (update) {
            ChatTurnRunner.Update.Submitting -> Unit

            is ChatTurnRunner.Update.UserStored -> {
                // The server now owns this message: swap the local id for the
                // real one and mark it Sent.
                _state.value = _state.value.copy(
                    messages = _state.value.messages.map { message ->
                        if (message.localOnly && message.role == MessageRole.User && message.text == lastUserText) {
                            message.copy(id = update.messageId.ifBlank { message.id }, state = MessageState.Sent, localOnly = false)
                        } else {
                            message
                        }
                    },
                )
                lastUserMessageId = update.messageId
            }

            is ChatTurnRunner.Update.RequestAccepted -> Unit

            is ChatTurnRunner.Update.AssistantRowOpened -> {
                val localId = assistantLocalId
                _state.value = _state.value.copy(
                    messages = _state.value.messages.map { message ->
                        if (localId != null && message.id == localId) message.copy(id = update.messageId) else message
                    },
                )
                if (localId != null) assistantLocalId = update.messageId
            }

            is ChatTurnRunner.Update.Rejected -> {
                _state.value = _state.value.copy(
                    sendError = update.error,
                    stream = StreamState(),
                    messages = _state.value.messages.map { message ->
                        if (message.role == MessageRole.User && message.state == MessageState.Sending) {
                            message.copy(state = MessageState.Failed, errorText = update.error.userMessage)
                        } else {
                            message
                        }
                    },
                )
            }

            is ChatTurnRunner.Update.Event -> {
                val next = StreamReducer.reduce(_state.value.stream, update.event)
                _state.value = _state.value.copy(stream = next)
                when {
                    // The first token creates the assistant bubble.
                    next.phase == StreamPhase.Streaming && !hasAssistantBubble() -> {
                        appendMessage(
                            ChatMessage(
                                id = assistantLocalId ?: newRequestId(),
                                role = MessageRole.Assistant,
                                text = next.text,
                                state = MessageState.Streaming,
                                model = next.model,
                                provider = next.provider,
                                localOnly = true,
                            )
                        )
                    }
                    next.phase == StreamPhase.Streaming -> updateAssistantMessage(next.text, MessageState.Streaming)
                    next.phase == StreamPhase.Retrying -> {
                        // The server discarded the previous attempt when it
                        // failed over; say so and clear the text (the reducer
                        // already did) rather than stitching two models' output.
                        if (hasAssistantBubble()) updateAssistantMessage("", MessageState.Streaming)
                    }
                    next.phase == StreamPhase.Completed -> finaliseAssistantMessage(next.text, MessageState.Completed)
                    next.phase == StreamPhase.Cancelled -> finaliseAssistantMessage(next.text, MessageState.Stopped)
                    next.phase == StreamPhase.Failed -> {
                        val error = next.error
                        if (error is AppError.StreamInterrupted) {
                            finaliseAssistantMessage(next.text, MessageState.Interrupted)
                        } else {
                            finaliseAssistantMessage(next.text, MessageState.Failed)
                        }
                    }
                    else -> Unit
                }
            }

            is ChatTurnRunner.Update.Finished -> {
                val state = when (update.status) {
                    "complete" -> MessageState.Completed
                    "cancelled" -> MessageState.Stopped
                    else -> MessageState.Failed
                }
                if (update.status == "complete" && update.finalText.isBlank() && !hasAssistantBubble()) {
                    // `done` with no text is an honest, empty result — not a
                    // blank bubble (case 6).
                    appendMessage(
                        ChatMessage(
                            id = assistantLocalId ?: newRequestId(),
                            role = MessageRole.Assistant,
                            text = "",
                            state = MessageState.Completed,
                            model = _state.value.stream.model,
                            provider = _state.value.stream.provider,
                            localOnly = false,
                        )
                    )
                } else {
                    finaliseAssistantMessage(update.finalText, state)
                }
                _state.value = _state.value.copy(
                    stream = _state.value.stream.copy(error = update.error),
                )
            }
        }
    }

    /** Cancels the in-flight turn. The runner finalises the server row. */
    fun stop() {
        val job = turnJob
        if (job == null || !job.isActive) return
        _state.value = _state.value.copy(stream = StreamReducer.onUserStop(_state.value.stream))
        finaliseAssistantMessage(_state.value.stream.text, MessageState.Stopped)
        job.cancel()
    }

    // ── message list helpers ────────────────────────────────────────────────

    private fun hasAssistantBubble(): Boolean =
        _state.value.messages.any { it.role == MessageRole.Assistant && it.state == MessageState.Streaming }

    private fun appendMessage(message: ChatMessage) {
        _state.value = _state.value.copy(messages = _state.value.messages + message)
    }

    private fun updateAssistantMessage(text: String, state: MessageState) {
        val localId = assistantLocalId
        var updated = false
        val messages = _state.value.messages.map { message ->
            if (message.role == MessageRole.Assistant && (message.id == localId || message.state == MessageState.Streaming)) {
                updated = true
                message.copy(text = text, state = state, model = _state.value.stream.model, provider = _state.value.stream.provider)
            } else {
                message
            }
        }
        _state.value = _state.value.copy(messages = if (updated) messages else _state.value.messages)
    }

    private fun finaliseAssistantMessage(text: String, state: MessageState) {
        val localId = assistantLocalId
        val exists = _state.value.messages.any { it.role == MessageRole.Assistant && it.id == localId }
        if (!exists && text.isNotBlank()) {
            appendMessage(
                ChatMessage(
                    id = localId ?: newRequestId(),
                    role = MessageRole.Assistant,
                    text = text,
                    state = state,
                    model = _state.value.stream.model,
                    provider = _state.value.stream.provider,
                )
            )
            return
        }
        updateAssistantMessage(text, state)
    }

    private suspend fun createConversation(): String? {
        val title = _state.value.draft.trim().take(60).ifBlank { null }
        return when (val created = container.conversations.create(title = title, model = null, provider = null)) {
            is ApiResult.Ok -> {
                _state.value = _state.value.copy(conversationId = created.value.id, conversation = created.value)
                created.value.id
            }
            is ApiResult.Err -> {
                _state.value = _state.value.copy(sendError = created.error)
                null
            }
        }
    }

    private fun newRequestId(): String = "req-${++requestSeq}-${UUID.randomUUID().toString().take(8)}"

    // ── attachments ─────────────────────────────────────────────────────────

    fun attach(uri: Uri, context: android.content.Context) {
        val picked = container.attachments.inspect(context, uri) ?: run {
            _state.value = _state.value.copy(sendError = AppError.FileUnsupported())
            return
        }
        val localId = UUID.randomUUID().toString()
        val pending = PendingAttachment(
            localId = localId,
            displayName = picked.displayName,
            mimeType = picked.mimeType,
            sizeBytes = picked.sizeBytes,
            uri = uri,
            state = AttachmentState.Uploading,
        )
        _state.value = _state.value.copy(attachments = _state.value.attachments + pending)
        viewModelScope.launch {
            val result = container.attachments.upload(
                context = context,
                picked = picked,
                conversationId = _state.value.conversationId,
                onProgress = { status ->
                    _state.value = _state.value.copy(
                        attachments = _state.value.attachments.map { attachment ->
                            if (attachment.localId == localId) attachment.copy(progress = status.fraction) else attachment
                        },
                    )
                },
            )
            _state.value = _state.value.copy(
                attachments = _state.value.attachments.map { attachment ->
                    when {
                        attachment.localId != localId -> attachment
                        result is ApiResult.Ok -> attachment.copy(
                            state = AttachmentState.Confirmed,
                            attachmentId = result.value.id,
                            progress = 1f,
                        )
                        else -> attachment.copy(
                            state = AttachmentState.Failed,
                            error = (result as? ApiResult.Err)?.error ?: AppError.UploadFailed(),
                        )
                    }
                },
            )
        }
    }

    fun removeAttachment(localId: String) {
        val removed = _state.value.attachments.firstOrNull { it.localId == localId }
        _state.value = _state.value.copy(attachments = _state.value.attachments.filterNot { it.localId == localId })
        // An attachment that reached the server is deleted there too; one that
        // never did needs no cleanup.
        removed?.attachmentId?.let { id ->
            viewModelScope.launch { container.attachments.delete(id) }
        }
    }

    // ── conversation actions ────────────────────────────────────────────────

    fun rename(title: String) {
        val id = _state.value.conversationId ?: return
        viewModelScope.launch {
            when (val result = container.conversations.rename(id, title)) {
                is ApiResult.Ok -> _state.value = _state.value.copy(conversation = result.value)
                is ApiResult.Err -> _state.value = _state.value.copy(sendError = result.error)
            }
        }
    }

    fun delete(onDeleted: () -> Unit) {
        val id = _state.value.conversationId ?: return
        viewModelScope.launch {
            when (val result = container.conversations.delete(id)) {
                is ApiResult.Ok -> {
                    drafts.clear(id)
                    onDeleted()
                }
                is ApiResult.Err -> _state.value = _state.value.copy(sendError = result.error)
            }
        }
    }

    /** Records a tool/capability label that the server actually reported. */
    fun setToolActivity(label: String?) {
        _state.value = _state.value.copy(toolActivity = label)
    }

    override fun onCleared() {
        super.onCleared()
        // The stream is owned by `turnJob`; cancelling the scope closes the
        // socket through the transport's completion handler.
        turnJob?.cancel()
    }
}
