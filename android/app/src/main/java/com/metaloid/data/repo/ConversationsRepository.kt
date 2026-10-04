package com.metaloid.data.repo

import com.metaloid.core.common.AppError
import com.metaloid.core.common.MetaLog
import com.metaloid.core.network.ApiResult
import com.metaloid.core.network.MetaJson
import com.metaloid.data.api.MetaIoidApi
import com.metaloid.data.dto.ConversationDto
import com.metaloid.data.dto.MessageDto
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import java.io.File

/**
 * The conversation list and transcripts.
 *
 * The gateway owns this data. The file on the phone is a **read cache** and is
 * labelled as one wherever it is shown: it lets the app open into a conversation
 * while offline instead of showing an empty screen, and it is never used to
 * decide that something succeeded. Nothing is ever written to it that the server
 * did not return.
 */
class ConversationsRepository(
    private val api: MetaIoidApi,
    private val cacheFile: File,
) {

    companion object {
        private const val TAG = "conversations"
        private const val MAX_CACHED_CONVERSATIONS = 60
        private const val MAX_CACHED_MESSAGES = 200
    }

    @Serializable
    internal data class Cache(
        val conversations: List<ConversationDto> = emptyList(),
        val messages: Map<String, List<MessageDto>> = emptyMap(),
        val savedAtEpochMs: Long = 0,
    )

    private val cacheMutex = Mutex()

    @Volatile
    private var cache: Cache = Cache()

    val hasCache: Boolean get() = cache.conversations.isNotEmpty()

    internal suspend fun loadCache(): Cache? {
        if (cache.savedAtEpochMs != 0L) return cache
        cacheMutex.withLock {
            if (cache.savedAtEpochMs != 0L) return cache
            val file = cacheFile
            if (!file.exists()) return null
            val parsed = runCatching { MetaJson.decodeFromString(Cache.serializer(), file.readText()) }
                .onFailure { MetaLog.w(TAG, "conversation cache unreadable: %s", it.javaClass.simpleName) }
                .getOrNull()
            if (parsed != null) cache = parsed
            return parsed
        }
    }

    /** Cached conversations, newest first, for the offline list. */
    fun cachedConversations(): List<ConversationDto> = cache.conversations

    fun cachedMessages(conversationId: String): List<MessageDto> = cache.messages[conversationId].orEmpty()

    /** Cache age, so the UI can say "last updated 12 minutes ago". */
    fun cacheAgeMs(now: Long): Long? = cache.savedAtEpochMs.takeIf { it > 0 }?.let { now - it }

    suspend fun refreshConversations(limit: Int = 30): ApiResult<List<ConversationDto>> {
        val result = api.listConversations(limit = limit)
        if (result is ApiResult.Ok) {
            persist(cache.copy(conversations = result.value.rows.take(MAX_CACHED_CONVERSATIONS)))
        }
        return when (result) {
            is ApiResult.Ok -> ApiResult.Ok(result.value.rows)
            is ApiResult.Err -> result
        }
    }

    suspend fun create(title: String?, model: String?, provider: String?): ApiResult<ConversationDto> {
        val result = api.createConversation(title, model, provider)
        return when (result) {
            is ApiResult.Ok -> {
                val created = result.value.conversation
                if (created == null) {
                    ApiResult.Err(AppError.Unknown("create returned no conversation"))
                } else {
                    persist(cache.copy(conversations = (listOf(created) + cache.conversations).take(MAX_CACHED_CONVERSATIONS)))
                    ApiResult.Ok(created)
                }
            }
            is ApiResult.Err -> result
        }
    }

    suspend fun rename(id: String, title: String): ApiResult<ConversationDto> {
        val result = api.renameConversation(id, title)
        return when (result) {
            is ApiResult.Ok -> {
                val updated = result.value.conversation
                if (updated == null) {
                    ApiResult.Err(AppError.Unknown("rename returned no conversation"))
                } else {
                    persist(cache.copy(conversations = cache.conversations.map { if (it.id == id) updated else it }))
                    ApiResult.Ok(updated)
                }
            }
            is ApiResult.Err -> result
        }
    }

    suspend fun delete(id: String): ApiResult<Unit> {
        val result = api.deleteConversation(id)
        return when (result) {
            is ApiResult.Ok -> {
                persist(
                    cache.copy(
                        conversations = cache.conversations.filterNot { it.id == id },
                        messages = cache.messages - id,
                    )
                )
                ApiResult.Ok(Unit)
            }
            is ApiResult.Err -> result
        }
    }

    /**
     * Reads a transcript, newest page first and ordered oldest-first for
     * rendering (the server documents that ordering).
     */
    suspend fun loadMessages(conversationId: String, limit: Int = 50): ApiResult<List<MessageDto>> {
        val result = api.listMessages(conversationId, limit = limit)
        if (result is ApiResult.Ok) {
            persist(cache.copy(messages = cache.messages + (conversationId to result.value.rows.takeLast(MAX_CACHED_MESSAGES))))
        }
        return when (result) {
            is ApiResult.Ok -> ApiResult.Ok(result.value.rows)
            is ApiResult.Err -> result
        }
    }

    /**
     * Closes messages the server still has in `streaming`.
     *
     * Called when a conversation is opened after a process death: the gateway
     * marks those rows `cancelled` with `error_code: interrupted`, so the turn
     * stops being "in progress" forever and the partial text it did store stays
     * in the transcript.
     */
    suspend fun recoverInterrupted(conversationId: String): Int {
        return when (val result = api.recoverMessages(conversationId)) {
            is ApiResult.Ok -> result.value.recovered
            is ApiResult.Err -> {
                MetaLog.w(TAG, "recover failed: %s", result.error.javaClass.simpleName)
                0
            }
        }
    }

    suspend fun clearCache() {
        cacheMutex.withLock {
            cache = Cache()
            runCatching { if (cacheFile.exists()) cacheFile.delete() }
        }
    }

    private suspend fun persist(next: Cache) {
        val stamped = next.copy(savedAtEpochMs = System.currentTimeMillis())
        cacheMutex.withLock {
            cache = stamped
            runCatching {
                cacheFile.parentFile?.mkdirs()
                cacheFile.writeText(MetaJson.encodeToString(Cache.serializer(), stamped))
            }.onFailure { MetaLog.w(TAG, "could not write the conversation cache: %s", it.javaClass.simpleName) }
        }
    }
}
