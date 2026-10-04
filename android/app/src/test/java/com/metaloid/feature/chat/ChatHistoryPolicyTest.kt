package com.metaloid.feature.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ChatHistoryPolicyTest {

    @Test
    fun `rerun history stops before the exact target and excludes its old answer`() {
        val messages = listOf(
            message("u1", MessageRole.User, "earlier question"),
            message("a1", MessageRole.Assistant, "earlier answer"),
            message("u2", MessageRole.User, "retry this"),
            message("a2", MessageRole.Assistant, "superseded answer"),
        )

        assertEquals(
            listOf(
                "user" to "earlier question",
                "assistant" to "earlier answer",
            ),
            ChatHistoryPolicy.beforeUserMessage(messages, "u2")?.map { it.role to it.content },
        )
    }

    @Test
    fun `repeated text is disambiguated by the persisted message id`() {
        val messages = listOf(
            message("u1", MessageRole.User, "same question"),
            message("a1", MessageRole.Assistant, "first answer"),
            message("u2", MessageRole.User, "same question"),
            message("a2", MessageRole.Assistant, "second answer"),
        )

        assertEquals(
            listOf("user" to "same question", "assistant" to "first answer"),
            ChatHistoryPolicy.beforeUserMessage(messages, "u2")?.map { it.role to it.content },
        )
    }

    @Test
    fun `normal history contains only persisted conversation messages`() {
        val messages = listOf(
            message("u1", MessageRole.User, "saved question"),
            message("a1", MessageRole.Assistant, "saved answer"),
            message("local", MessageRole.User, "still local", localOnly = true),
            message("tool", MessageRole.Tool, "tool output"),
        )

        assertEquals(
            listOf("user" to "saved question", "assistant" to "saved answer"),
            ChatHistoryPolicy.persistedHistory(messages).map { it.role to it.content },
        )
    }

    @Test
    fun `missing target has no rerun history`() {
        assertNull(ChatHistoryPolicy.beforeUserMessage(emptyList(), "missing"))
    }

    private fun message(
        id: String,
        role: MessageRole,
        text: String,
        localOnly: Boolean = false,
    ) = ChatMessage(
        id = id,
        role = role,
        text = text,
        state = MessageState.Completed,
        localOnly = localOnly,
    )
}
