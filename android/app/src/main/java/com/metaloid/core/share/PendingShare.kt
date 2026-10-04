package com.metaloid.core.share

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Text handed to the app by the system share sheet, waiting for a home.
 *
 * The share flow crosses two Activities and a sign-in gate, so the text is held
 * here rather than in an Intent extra that would be lost on the way:
 *
 *   1. [ShareReceiverActivity] stores the text and opens the app;
 *   2. the conversation list creates a real server-side conversation for it;
 *   3. the chat screen claims the text into the composer as an **unsent draft**.
 *
 * Step 3 is deliberate: a share pre-fills the message, it never sends it. Sending
 * is a user action, and an app that posts on your behalf because you tapped
 * "share" is an app that speaks for you.
 *
 * The holder is process-wide and cleared on claim, so a share is never replayed
 * into a second conversation.
 *
 * The text is exposed as a [StateFlow] (`waiting`) rather than a plain field: a
 * share that arrives while the conversation list is already on screen has to be
 * *noticed* by a screen that is already composed.
 */
object PendingShare {

    /**
     * Text waiting for a conversation, or null.
     *
     * It is a [StateFlow] rather than a plain field because a share can arrive
     * while the conversation list is *already* on screen: a one-shot effect in
     * that screen would never re-run, and the share would be dropped without a
     * word. Watching the value means a share is placed whenever one exists.
     */
    private val _waiting = MutableStateFlow<String?>(null)
    val waiting: StateFlow<String?> = _waiting.asStateFlow()

    /** The conversation that will receive [waiting], once it exists. */
    @Volatile
    private var targetConversationId: String? = null

    /** True when there is a share waiting to be placed. */
    val hasPending: Boolean get() = _waiting.value != null

    /**
     * True when a share is waiting **and** has no conversation yet.
     *
     * This is what stops a second conversation being created for the same share
     * when the list screen is composed again after the first one was assigned.
     */
    val needsConversation: Boolean get() = _waiting.value != null && targetConversationId == null

    /** Called by the share receiver. A blank share is not a share. */
    @Synchronized
    fun put(raw: String?) {
        val trimmed = raw?.trim().orEmpty()
        if (trimmed.isNotEmpty()) {
            targetConversationId = null
            _waiting.value = trimmed
        }
    }

    /** Called once the conversation has been created for this share. */
    @Synchronized
    fun assign(conversationId: String) {
        if (_waiting.value != null) targetConversationId = conversationId
    }

    /** The text to pre-fill, claimed exactly once by its conversation. */
    @Synchronized
    fun claimFor(conversationId: String): String? {
        val current = _waiting.value ?: return null
        if (targetConversationId != conversationId) return null
        _waiting.value = null
        targetConversationId = null
        return current
    }

    /**
     * A short title for the conversation this share will create.
     *
     * The first line that has any text in it: a share whose text starts with a
     * blank line (a copied quote usually does) must still get a conversation,
     * and a null title here means the list screen places nothing.
     */
    fun title(): String? = _waiting.value
        ?.lineSequence()
        ?.firstOrNull { it.isNotBlank() }
        ?.trim()
        ?.take(60)
        ?.ifBlank { null }
}
