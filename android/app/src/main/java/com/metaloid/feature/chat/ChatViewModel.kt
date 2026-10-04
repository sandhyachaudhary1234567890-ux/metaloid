package com.metaloid.feature.chat

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.metaloid.app.AiReadinessPolicy
import com.metaloid.core.common.AppError
import com.metaloid.core.common.MetaLog
import com.metaloid.core.network.ApiResult
import com.metaloid.core.storage.DraftStore
import com.metaloid.data.dto.ConversationDto
import com.metaloid.data.dto.HealthDto
import com.metaloid.data.dto.ModelListDto
import com.metaloid.data.dto.ProviderCatalogDto
import com.metaloid.data.dto.ProviderCredentialMetadataListDto
import com.metaloid.data.dto.ProviderSettingsEnvelope
import com.metaloid.di.AppContainer
import com.metaloid.feature.chat.data.ChatTurnRunner
import com.metaloid.feature.chat.domain.StreamPhase
import com.metaloid.feature.chat.domain.StreamReducer
import com.metaloid.feature.chat.domain.StreamState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonNull
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

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
private data class ModelPickerResults(
    val providers: ApiResult<ProviderCatalogDto>,
    val credentials: ApiResult<ProviderCredentialMetadataListDto>,
    val settings: ApiResult<ProviderSettingsEnvelope>,
    val health: ApiResult<HealthDto>,
    val sharedModels: ApiResult<ModelListDto>,
)

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
        val providerOptions: List<ChatProviderOption> = emptyList(),
        val sharedModels: List<ChatModelChoice> = emptyList(),
        val providerModels: List<ChatModelChoice> = emptyList(),
        val activeModelProviderId: String? = null,
        val selectedProvider: String? = null,
        val selectedModel: String? = null,
        val modelPickerLoading: Boolean = false,
        val modelListLoading: Boolean = false,
        val modelSaving: Boolean = false,
        val modelPickerError: AppError? = null,
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
    private var conversationLoadJob: Job? = null
    private var modelPickerJob: Job? = null
    private var providerModelsJob: Job? = null
    private var modelRequestSeq = 0L
    private var openGeneration = 0L
    private var assistantLocalId: String? = null
    private var activeStopSignal: AtomicBoolean? = null
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
        if (conversationId != null && _state.value.conversationId == conversationId && _state.value.messages.isNotEmpty()) return
        conversationLoadJob?.cancel()
        modelPickerJob?.cancel()
        providerModelsJob?.cancel()
        val generation = ++openGeneration
        if (conversationId == null) {
            turnJob?.cancel()
            _state.value = UiState(uploadsEnabled = container.uploadsEnabled())
            return
        }
        if (_state.value.conversationId != null && _state.value.conversationId != conversationId) {
            // The old turn finalises its own server row under NonCancellable;
            // it must not keep publishing into the newly opened transcript.
            turnJob?.cancel()
        }
        _state.value = UiState(conversationId = conversationId, loading = true, uploadsEnabled = container.uploadsEnabled())
        conversationLoadJob = viewModelScope.launch {
            val cached = container.conversations.cachedMessages(conversationId)
            if (generation != openGeneration) return@launch
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
            if (generation != openGeneration) return@launch
            if (draft.isNotEmpty()) {
                _state.value = _state.value.copy(draft = draft)
                if (shared != null) drafts.put(conversationId, shared)
            }

            when (val loaded = container.conversations.loadMessages(conversationId)) {
                is ApiResult.Ok -> {
                    if (generation != openGeneration) return@launch
                    _state.value = _state.value.copy(
                        messages = loaded.value.map { it.toChatMessage() },
                        showingCachedData = false,
                        cacheAgeMs = null,
                        loading = false,
                        loadError = null,
                    )
                    val recovered = container.conversations.recoverInterrupted(conversationId)
                    if (generation != openGeneration) return@launch
                    if (recovered > 0) {
                        MetaLog.i(TAG, "recovered %d interrupted message(s)", recovered)
                        (container.conversations.loadMessages(conversationId) as? ApiResult.Ok)?.let { refreshed ->
                            if (generation == openGeneration) {
                                _state.value = _state.value.copy(messages = refreshed.value.map { it.toChatMessage() })
                            }
                        }
                    }
                }
                is ApiResult.Err -> {
                    if (generation != openGeneration) return@launch
                    _state.value = _state.value.copy(
                        loading = false,
                        loadError = loaded.error,
                        // If a cache was shown, keep showing it and say so.
                        showingCachedData = cached.isNotEmpty(),
                    )
                }
            }
            loadDefaultRoute(generation)
        }
    }

    private fun loadDefaultRoute(generation: Long) {
        viewModelScope.launch {
            when (val settings = container.api.providerSettings()) {
                is ApiResult.Ok -> if (generation == openGeneration) {
                    _state.value = _state.value.copy(
                        selectedProvider = settings.value.settings?.defaultProvider,
                        selectedModel = settings.value.settings?.defaultModel,
                    )
                }
                is ApiResult.Err -> MetaLog.w(TAG, "provider settings unavailable: %s", settings.error.javaClass.simpleName)
            }
        }
    }

    /** Fetch backend provider choices only when the user opens the picker. */
    fun loadModelPicker() {
        if (_state.value.modelPickerLoading) return
        modelPickerJob?.cancel()
        providerModelsJob?.cancel()
        val request = ++modelRequestSeq
        _state.value = _state.value.copy(
            modelPickerLoading = true,
            modelListLoading = false,
            modelPickerError = null,
            providerModels = emptyList(),
            activeModelProviderId = null,
        )
        modelPickerJob = viewModelScope.launch {
            val results = coroutineScope {
                val providers = async { container.api.providerCatalog() }
                val credentials = async { container.api.providerCredentialMetadata() }
                val settings = async { container.api.providerSettings() }
                val health = async { container.api.health() }
                val sharedModels = async { container.api.listModels() }
                ModelPickerResults(providers.await(), credentials.await(), settings.await(), health.await(), sharedModels.await())
            }
            if (request != modelRequestSeq) return@launch
            val credentials = (results.credentials as? ApiResult.Ok)?.value?.credentials
            val health = (results.health as? ApiResult.Ok)?.value
            val sharedList = (results.sharedModels as? ApiResult.Ok)?.value
            val catalog = (results.providers as? ApiResult.Ok)?.value?.providers.orEmpty()
            val settings = (results.settings as? ApiResult.Ok)?.value?.settings
            val providerError = (results.providers as? ApiResult.Err)?.error
                ?: (results.credentials as? ApiResult.Err)?.error
                ?: (results.health as? ApiResult.Err)?.error
                ?: (results.sharedModels as? ApiResult.Err)?.error
                ?: (results.settings as? ApiResult.Err)?.error
            val liveShared = health?.let(AiReadinessPolicy::hasRealSharedProvider) == true && sharedList?.mock != true
            val verifiedIds = if (health?.byok == true) credentials.orEmpty()
                .filter { it.isActive && (it.status.equals("valid", true) || it.status.equals("connected", true)) }
                .map { it.providerId }
                .toSet() else emptySet()
            val secretProviders = catalog.filter { provider ->
                provider.adapter && provider.providerId in verifiedIds &&
                    provider.authType?.lowercase() in setOf("api_key", "bearer_token")
            }
            val sharedProviderId = if (liveShared) sharedList?.provider?.takeIf { it.isNotBlank() } else null
            val options = buildList {
                if (sharedProviderId != null) {
                    val provider = catalog.firstOrNull { it.providerId == sharedProviderId }
                    add(ChatProviderOption(
                        providerId = sharedProviderId,
                        name = provider?.name?.ifBlank { null } ?: sharedProviderId,
                        shared = true,
                        pricingUrl = provider?.pricingUrl,
                    ))
                }
                secretProviders.forEach { provider ->
                    if (none { it.providerId == provider.providerId }) add(
                        ChatProviderOption(
                            providerId = provider.providerId,
                            name = provider.name.ifBlank { provider.providerId },
                            pricingUrl = provider.pricingUrl,
                        ),
                    )
                }
            }
            val sharedChoices = if (sharedProviderId != null) {
                sharedList?.models.orEmpty().map { row ->
                    ChatModelChoice(
                        providerId = sharedProviderId,
                        providerName = options.firstOrNull { it.providerId == sharedProviderId }?.name ?: sharedProviderId,
                        modelId = row.id,
                        displayName = row.name,
                        free = row.free,
                        unavailable = row.unavailable,
                        contextLimit = row.context,
                        availability = if (row.unavailable) "unavailable" else "available",
                    )
                }
            } else {
                emptyList()
            }
            if (request != modelRequestSeq) return@launch
            _state.value = _state.value.copy(
                providerOptions = options,
                sharedModels = sharedChoices,
                selectedProvider = settings?.defaultProvider,
                selectedModel = settings?.defaultModel,
                modelPickerLoading = false,
                modelPickerError = if (options.isEmpty() && !liveShared) providerError else null,
            )
        }
    }

    fun showModelProviders() {
        providerModelsJob?.cancel()
        modelRequestSeq += 1
        _state.value = _state.value.copy(
            activeModelProviderId = null,
            providerModels = emptyList(),
            modelListLoading = false,
            modelPickerError = null,
        )
    }

    /** Opens a backend provider's catalogue on demand; no local model names are bundled. */
    fun openProviderModels(providerId: String) {
        val option = _state.value.providerOptions.firstOrNull { it.providerId == providerId } ?: return
        providerModelsJob?.cancel()
        val request = ++modelRequestSeq
        if (option.shared) {
            _state.value = _state.value.copy(
                activeModelProviderId = providerId,
                providerModels = _state.value.sharedModels,
                modelListLoading = false,
                modelPickerError = null,
            )
            return
        }
        _state.value = _state.value.copy(
            activeModelProviderId = providerId,
            providerModels = emptyList(),
            modelListLoading = true,
            modelPickerError = null,
        )
        providerModelsJob = viewModelScope.launch {
            val refresh = container.api.refreshProviderModels(providerId)
            val live = (refresh as? ApiResult.Ok)?.value?.live
            when (val models = container.api.providerModels(providerId)) {
                is ApiResult.Ok -> {
                    val choices = models.value.models.map { model ->
                        ChatModelChoice(
                            providerId = providerId,
                            providerName = option.name,
                            modelId = model.modelId,
                            displayName = model.displayName,
                            free = model.free,
                            unavailable = model.unavailable == true || model.availability.equals("unavailable", true),
                            contextLimit = model.contextLimit,
                            availability = when {
                                model.unavailable == true || model.availability.equals("unavailable", true) -> "unavailable"
                                model.availability.equals("available", true) || live == true -> "available"
                                else -> "unconfirmed"
                            },
                            pricingReported = model.pricing != null && model.pricing !is JsonNull,
                        )
                    }
                    if (request == modelRequestSeq) _state.value = _state.value.copy(
                        providerModels = choices,
                        modelListLoading = false,
                        modelPickerError = null,
                    )
                }
                is ApiResult.Err -> if (request == modelRequestSeq) _state.value = _state.value.copy(
                    modelListLoading = false,
                    modelPickerError = models.error,
                )
            }
        }
    }

    /** Reset to backend Smart Connect, or explicitly pin a listed model. */
    fun selectSmartConnect(onSaved: () -> Unit = {}) = persistModelRoute(providerId = null, modelId = null, onSaved = onSaved)

    fun selectModel(choice: ChatModelChoice, onSaved: () -> Unit = {}) {
        if (choice.unavailable) {
            _state.value = _state.value.copy(modelPickerError = AppError.ModelUnavailable(choice.modelId))
            return
        }
        persistModelRoute(providerId = choice.providerId, modelId = choice.modelId, onSaved = onSaved)
    }

    private fun persistModelRoute(providerId: String?, modelId: String?, onSaved: () -> Unit) {
        if (_state.value.modelSaving) return
        val previousProvider = _state.value.selectedProvider
        val previousModel = _state.value.selectedModel
        _state.value = _state.value.copy(modelSaving = true, modelPickerError = null)
        viewModelScope.launch {
            when (val result = container.api.setProviderRoute(providerId, modelId)) {
                is ApiResult.Ok -> {
                    val saved = result.value.settings
                    if (saved == null || saved.defaultProvider != providerId || saved.defaultModel != modelId) {
                        _state.value = _state.value.copy(
                            modelSaving = false,
                            modelPickerError = AppError.InvalidInput("The server did not confirm the saved model route."),
                        )
                        return@launch
                    }
                    _state.value = _state.value.copy(
                        selectedProvider = providerId,
                        selectedModel = modelId,
                        modelSaving = false,
                        modelPickerError = null,
                    )
                    onSaved()
                }
                is ApiResult.Err -> {
                    MetaLog.w(TAG, "model route rejected: %s", result.error.javaClass.simpleName)
                    _state.value = _state.value.copy(
                        selectedProvider = previousProvider,
                        selectedModel = previousModel,
                        modelSaving = false,
                        modelPickerError = result.error,
                    )
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
        if (_state.value.isStreaming) return
        viewModelScope.launch {
            sendLock.withLock {
                val current = _state.value
                if (current.isStreaming) return@withLock
                val text = current.draft.trim()
                if (text.isEmpty()) return@withLock
                if (current.hasUnconfirmedAttachments) {
                    _state.value = current.copy(sendError = AppError.UploadFailed("wait for the attachment to finish"))
                    return@withLock
                }
                val conversationId = current.conversationId ?: createConversation() ?: return@withLock
                val prepared = _state.value
                if (prepared.isStreaming) return@withLock
                val confirmedNames = prepared.attachments
                    .filter { it.state == AttachmentState.Confirmed }
                    .map { it.displayName }
                // Only messages the backend has confirmed belong in outgoing
                // history. The current user turn is sent separately as `message`.
                val history = ChatHistoryPolicy.persistedHistory(prepared.messages)

                val requestId = newRequestId()
                val localUserId = "local-user-$requestId"
                assistantLocalId = "local-assistant-$requestId"
                val stopSignal = AtomicBoolean(false)
                activeStopSignal = stopSignal
                val localUser = ChatMessage(
                    id = localUserId,
                    role = MessageRole.User,
                    text = text,
                    state = MessageState.Sending,
                    localOnly = true,
                )
                _state.value = prepared.copy(
                    messages = prepared.messages + localUser,
                    draft = "",
                    attachments = emptyList(),
                    sendError = null,
                    stream = StreamState(phase = StreamPhase.Submitting, startedAtMs = System.currentTimeMillis()),
                )
                drafts.clear(conversationId)

                val turn = ChatTurnRunner.Turn(
                    conversationId = conversationId,
                    text = text,
                    history = history,
                    task = null,
                    requestId = requestId,
                    attachments = confirmedNames,
                    appendUserMessage = true,
                    optimisticUserId = localUserId,
                    stopRequested = stopSignal,
                )
                turnJob = launchTurn(turn)
            }
        }
    }

    /** Retry the last user turn without appending that already-stored row again. */
    fun retryLast() = rerunLastUserMessage()

    /** Regenerate from the same persisted context, retaining the previous response row. */
    fun regenerate() = rerunLastUserMessage()

    private fun rerunLastUserMessage() {
        if (_state.value.isStreaming) return
        val targetId = _state.value.messages.lastOrNull { it.role == MessageRole.User }?.id ?: return
        viewModelScope.launch {
            sendLock.withLock {
                if (_state.value.isStreaming) return@withLock
                startTurnForExistingMessage(targetId)
            }
        }
    }

    /**
     * Re-runs one specific user row with only earlier, persisted messages as
     * context. Neither that user row nor any later answer is duplicated in the
     * server history; `message` carries the target text separately.
     */
    private fun startTurnForExistingMessage(targetUserId: String) {
        val current = _state.value
        val conversationId = current.conversationId ?: return
        val target = current.messages.lastOrNull { it.id == targetUserId && it.role == MessageRole.User } ?: return
        if (target.text.isBlank()) return
        val history = ChatHistoryPolicy.beforeUserMessage(current.messages, targetUserId) ?: return
        val requestId = newRequestId()
        assistantLocalId = "local-assistant-$requestId"
        val stopSignal = AtomicBoolean(false)
        activeStopSignal = stopSignal
        _state.value = current.copy(
            sendError = null,
            stream = StreamState(phase = StreamPhase.Submitting, startedAtMs = System.currentTimeMillis()),
        )
        val turn = ChatTurnRunner.Turn(
            conversationId = conversationId,
            text = target.text,
            history = history,
            task = null,
            requestId = requestId,
            appendUserMessage = target.localOnly,
            optimisticUserId = target.id.takeIf { target.localOnly },
            stopRequested = stopSignal,
        )
        turnJob = launchTurn(turn)
    }

    private fun launchTurn(turn: ChatTurnRunner.Turn): Job = viewModelScope.launch {
        try {
            container.turnRunner.start(turn).collect { update -> reduce(update) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            MetaLog.e(TAG, "turn orchestration failed", e)
            val error = AppError.Unknown(e.javaClass.simpleName)
            _state.value = _state.value.copy(
                stream = StreamReducer.onTransportLoss(_state.value.stream, error),
                sendError = error,
            )
            finaliseAssistantMessage(_state.value.stream.text, MessageState.Failed)
            activeStopSignal = null
        }
    }

    private fun reduce(update: ChatTurnRunner.Update) {
        when (update) {
            ChatTurnRunner.Update.Submitting -> Unit

            is ChatTurnRunner.Update.UserStored -> {
                // Reconcile by optimistic identity, never by repeated message text.
                val optimisticId = update.optimisticUserId ?: return
                _state.value = _state.value.copy(
                    messages = _state.value.messages.map { message ->
                        if (message.id == optimisticId && message.role == MessageRole.User && message.localOnly) {
                            message.copy(
                                id = update.messageId.ifBlank { message.id },
                                state = MessageState.Sent,
                                localOnly = false,
                            )
                        } else message
                    },
                )
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

            is ChatTurnRunner.Update.AssistantRowSaved -> {
                _state.value = _state.value.copy(
                    messages = _state.value.messages.map { message ->
                        if (message.id == update.messageId && message.role == MessageRole.Assistant) {
                            message.copy(localOnly = false)
                        } else message
                    },
                )
            }

            is ChatTurnRunner.Update.Rejected -> {
                val optimisticId = update.optimisticUserId
                val rejectedMessage = _state.value.messages.firstOrNull { it.id == optimisticId && it.localOnly }
                val restoredDraft = rejectedMessage?.text
                val conversationId = _state.value.conversationId
                if (!restoredDraft.isNullOrBlank() && conversationId != null) drafts.put(conversationId, restoredDraft)
                _state.value = _state.value.copy(
                    sendError = update.error,
                    draft = restoredDraft ?: _state.value.draft,
                    stream = StreamState(),
                    messages = if (optimisticId == null) _state.value.messages else
                        _state.value.messages.filterNot { it.id == optimisticId && it.localOnly },
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
                val messageState = when {
                    update.status == "complete" -> MessageState.Completed
                    update.error is AppError.Stopped -> MessageState.Stopped
                    update.error is AppError.StreamInterrupted -> MessageState.Interrupted
                    update.status == "cancelled" -> MessageState.Stopped
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
                            localOnly = true,
                        )
                    )
                } else {
                    finaliseAssistantMessage(update.finalText, messageState)
                }
                _state.value = _state.value.copy(
                    stream = _state.value.stream.copy(error = update.error),
                    sendError = update.persistenceError ?: _state.value.sendError,
                )
                activeStopSignal = null
            }
        }
    }

    /** Cancels the in-flight turn. The runner finalises the server row. */
    fun stop() {
        val job = turnJob
        if (job == null || !job.isActive) return
        activeStopSignal?.set(true)
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
            if (localId != null && message.role == MessageRole.Assistant && message.id == localId) {
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
