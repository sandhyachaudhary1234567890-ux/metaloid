package com.metaloid.core.storage

import com.metaloid.core.common.MetaLog
import com.metaloid.core.network.MetaJson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import java.io.File

/**
 * Unsent text, per conversation.
 *
 * A draft is the one thing on this screen the user typed and the server has
 * never seen, so it is the one thing that must survive a process death. It is
 * cleared on a confirmed send or an explicit discard — never on a failed send,
 * because the failure is exactly when the text matters most.
 *
 * Writes are debounced: typing a sentence should not mean a file write per
 * keystroke. The last write wins, and a crash between keystrokes loses at most
 * the debounce window.
 */
class DraftStore(
    private val file: File,
    private val scope: CoroutineScope,
    private val debounceMs: Long = 400L,
) {

    @Serializable
    private data class Payload(val drafts: Map<String, String> = emptyMap())

    private companion object {
        const val TAG = "drafts"
    }

    private val mutex = Mutex()
    private var drafts: MutableMap<String, String> = mutableMapOf()
    private var loaded = false
    private var pendingSave: Job? = null

    suspend fun load(): Map<String, String> {
        mutex.withLock {
            if (!loaded && file.exists()) {
                runCatching { MetaJson.decodeFromString(Payload.serializer(), file.readText()) }
                    .onSuccess { drafts = it.drafts.toMutableMap() }
                    .onFailure { MetaLog.w(TAG, "draft store unreadable: %s", it.javaClass.simpleName) }
                loaded = true
            }
            return drafts.toMap()
        }
    }

    suspend fun get(conversationId: String): String = mutex.withLock {
        if (!loaded) load()
        drafts[conversationId].orEmpty()
    }

    /** Schedules a save. Safe to call on every keystroke. */
    fun put(conversationId: String, text: String) {
        scope.launch {
            mutex.withLock {
                if (text.isEmpty()) drafts.remove(conversationId) else drafts[conversationId] = text
            }
            pendingSave?.cancel()
            pendingSave = scope.launch {
                delay(debounceMs)
                flush()
            }
        }
    }

    suspend fun clear(conversationId: String) {
        mutex.withLock { drafts.remove(conversationId) }
        flush()
    }

    suspend fun clearAll() {
        mutex.withLock { drafts.clear() }
        flush()
    }

    suspend fun flush() {
        val snapshot = mutex.withLock { drafts.toMap() }
        runCatching {
            file.parentFile?.mkdirs()
            file.writeText(MetaJson.encodeToString(Payload.serializer(), Payload(snapshot)))
        }.onFailure { MetaLog.w(TAG, "could not persist drafts: %s", it.javaClass.simpleName) }
    }
}
