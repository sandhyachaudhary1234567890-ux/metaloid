package com.metaloid.feature.chat

import com.metaloid.feature.chat.data.ChatTurnRunner

/** Builds only server-confirmed context for chat requests and reruns. */
internal object ChatHistoryPolicy {

    fun persistedHistory(messages: List<ChatMessage>): List<ChatTurnRunner.HistoryItem> =
        messages.asSequence()
            .filter(::isPersistedConversationMessage)
            .filter { it.text.isNotBlank() }
            .map(::toHistoryItem)
            .toList()

    /**
     * History for retry/regenerate ends immediately before the exact user row.
     * Messages after it (including the superseded assistant answer) are omitted.
     */
    fun beforeUserMessage(
        messages: List<ChatMessage>,
        userMessageId: String,
    ): List<ChatTurnRunner.HistoryItem>? {
        val targetIndex = messages.indexOfLast {
            it.id == userMessageId && it.role == MessageRole.User
        }
        if (targetIndex < 0) return null
        return messages.asSequence()
            .take(targetIndex)
            .filter(::isPersistedConversationMessage)
            .filter { it.text.isNotBlank() }
            .map(::toHistoryItem)
            .toList()
    }

    private fun isPersistedConversationMessage(message: ChatMessage): Boolean =
        !message.localOnly && (message.role == MessageRole.User || message.role == MessageRole.Assistant)

    private fun toHistoryItem(message: ChatMessage): ChatTurnRunner.HistoryItem =
        ChatTurnRunner.HistoryItem(
            role = if (message.role == MessageRole.User) "user" else "assistant",
            content = message.text,
        )
}
