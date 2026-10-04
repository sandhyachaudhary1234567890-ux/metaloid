package com.metaloid.feature.conversations

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.metaloid.core.common.AppError
import com.metaloid.core.common.MetaLog
import com.metaloid.core.network.ApiResult
import com.metaloid.data.dto.ConversationDto
import com.metaloid.di.AppContainer
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * The conversation list.
 *
 * The list is a *view of server state*, with one exception that is stated on the
 * screen: when the fetch fails and a cache exists, the cache is shown and
 * labelled with its age (Section 8.7). There is no optimistic insert of a
 * conversation the server has not created — a conversation that does not exist
 * server-side is not a conversation.
 */
class ConversationsViewModel(private val container: AppContainer) : ViewModel() {

    companion object {
        private const val TAG = "conversations"
    }

    data class UiState(
        val conversations: List<ConversationDto> = emptyList(),
        val query: String = "",
        val loading: Boolean = false,
        val refreshing: Boolean = false,
        val error: AppError? = null,
        val showingCache: Boolean = false,
        val cacheAgeMs: Long? = null,
        val deletingId: String? = null,
    ) {
        val visible: List<ConversationDto>
            get() = if (query.isBlank()) {
                conversations
            } else {
                val needle = query.trim().lowercase()
                conversations.filter { it.title.lowercase().contains(needle) }
            }

        val isEmpty: Boolean get() = !loading && error == null && conversations.isEmpty()
    }

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    /**
     * Loads the list: cache first, then the server.
     *
     * The two are distinguishable in state ([showingCache]), so the screen can
     * say "showing the copy from 20 minutes ago" instead of pretending.
     */
    fun load(force: Boolean = false) {
        if (_state.value.loading || (_state.value.refreshing && !force)) return
        _state.value = _state.value.copy(
            loading = _state.value.conversations.isEmpty(),
            refreshing = _state.value.conversations.isNotEmpty(),
            error = null,
        )
        viewModelScope.launch {
            if (_state.value.conversations.isEmpty()) {
                container.conversations.loadCache()
                val cached = container.conversations.cachedConversations()
                if (cached.isNotEmpty()) {
                    _state.value = _state.value.copy(
                        conversations = cached,
                        showingCache = true,
                        cacheAgeMs = container.conversations.cacheAgeMs(System.currentTimeMillis()),
                        loading = false,
                    )
                }
            }
            when (val result = container.conversations.refreshConversations()) {
                is ApiResult.Ok -> _state.value = _state.value.copy(
                    conversations = result.value,
                    loading = false,
                    refreshing = false,
                    error = null,
                    showingCache = false,
                    cacheAgeMs = null,
                )
                is ApiResult.Err -> {
                    MetaLog.w(TAG, "list failed: %s", result.error.javaClass.simpleName)
                    _state.value = _state.value.copy(
                        loading = false,
                        refreshing = false,
                        error = result.error,
                        showingCache = _state.value.conversations.isNotEmpty(),
                    )
                }
            }
        }
    }

    fun onQueryChange(value: String) {
        _state.value = _state.value.copy(query = value)
    }

    /** Creates an empty conversation server-side, then hands its id to the caller. */
    fun create(onCreated: (String) -> Unit) {
        viewModelScope.launch {
            when (val result = container.conversations.create(title = null, model = null, provider = null)) {
                is ApiResult.Ok -> {
                    _state.value = _state.value.copy(
                        conversations = listOf(result.value) + _state.value.conversations,
                        error = null,
                    )
                    onCreated(result.value.id)
                }
                is ApiResult.Err -> _state.value = _state.value.copy(error = result.error)
            }
        }
    }

    /**
     * Gives an incoming share a home: creates the conversation server-side and
     * attaches the pending text to it, then hands the id to the caller.
     *
     * Nothing is created when there is no pending share, and nothing is created
     * twice: [PendingShare.assign] is a no-op once the text has been claimed.
     */
    fun createForPendingShare(onCreated: (String) -> Unit) {
        val title = com.metaloid.core.share.PendingShare.title() ?: return
        viewModelScope.launch {
            when (val result = container.conversations.create(title = title, model = null, provider = null)) {
                is ApiResult.Ok -> {
                    com.metaloid.core.share.PendingShare.assign(result.value.id)
                    _state.value = _state.value.copy(conversations = listOf(result.value) + _state.value.conversations)
                    onCreated(result.value.id)
                }
                is ApiResult.Err -> MetaLog.w(TAG, "could not place the shared text: %s", result.error.javaClass.simpleName)
            }
        }
    }

    fun rename(id: String, title: String) {
        val trimmed = title.trim()
        if (trimmed.isEmpty()) return
        val previous = _state.value.conversations
        _state.value = _state.value.copy(
            conversations = previous.map { if (it.id == id) it.copy(title = trimmed) else it },
        )
        viewModelScope.launch {
            when (val result = container.conversations.rename(id, trimmed)) {
                is ApiResult.Ok -> _state.value = _state.value.copy(
                    conversations = _state.value.conversations.map { if (it.id == id) result.value else it },
                )
                is ApiResult.Err -> {
                    // The rename is rolled back on screen: the server is the
                    // owner of the title, and an unconfirmed one must not stick.
                    _state.value = _state.value.copy(conversations = previous, error = result.error)
                }
            }
        }
    }

    fun delete(id: String) {
        val previous = _state.value.conversations
        _state.value = _state.value.copy(
            conversations = previous.filterNot { it.id == id },
            deletingId = id,
        )
        viewModelScope.launch {
            when (val result = container.conversations.delete(id)) {
                is ApiResult.Ok -> _state.value = _state.value.copy(deletingId = null)
                is ApiResult.Err -> _state.value = _state.value.copy(
                    conversations = previous,
                    deletingId = null,
                    error = result.error,
                )
            }
        }
    }

    fun dismissError() {
        _state.value = _state.value.copy(error = null)
    }
}
