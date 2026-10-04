package com.metaloid.core.share

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
 */
object PendingShare {

    /** Text waiting for a conversation, or null. */
    @Volatile
    private var text: String? = null

    /** The conversation that will receive [text], once it exists. */
    @Volatile
    private var targetConversationId: String? = null

    /** True when there is a share waiting to be placed. */
    val hasPending: Boolean get() = text != null

    /** Called by the share receiver. A blank share is not a share. */
    @Synchronized
    fun put(raw: String?) {
        val trimmed = raw?.trim().orEmpty()
        if (trimmed.isNotEmpty()) {
            text = trimmed
            targetConversationId = null
        }
    }

    /** Called once the conversation has been created for this share. */
    @Synchronized
    fun assign(conversationId: String) {
        if (text != null) targetConversationId = conversationId
    }

    /** The text to pre-fill, claimed exactly once by its conversation. */
    @Synchronized
    fun claimFor(conversationId: String): String? {
        if (text == null || targetConversationId != conversationId) return null
        val claimed = text
        text = null
        targetConversationId = null
        return claimed
    }

    /** A short title for the conversation this share will create. */
    fun title(): String? = text?.lineSequence()?.firstOrNull()?.trim()?.take(60)?.ifBlank { null }
}
