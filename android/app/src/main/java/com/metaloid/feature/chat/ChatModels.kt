package com.metaloid.feature.chat

import com.metaloid.data.dto.MessageDto

/** Who wrote a message. */
enum class MessageRole { User, Assistant, Tool, System;

    companion object {
        fun from(raw: String): MessageRole = when (raw) {
            "user" -> User
            "assistant" -> Assistant
            "tool" -> Tool
            else -> System
        }
    }
}

/**
 * The visible lifecycle of one message.
 *
 * Every value is derived from something the server (or the transport) actually
 * reported — there is no state that means "probably fine":
 *
 *   Sending      the request is in flight; the server has not accepted it yet
 *   Sent         the server returned the row (201)
 *   Streaming    text is arriving now
 *   Completed    `done` arrived and the row was finalised
 *   Stopped      the user pressed stop
 *   Failed       the server or the transport reported a failure
 *   Interrupted  the connection dropped or the process died mid-turn
 *   Recovered    the server later reported this turn as `cancelled/interrupted`
 */
enum class MessageState { Sending, Sent, Streaming, Completed, Stopped, Failed, Interrupted, Recovered }

/**
 * One message as the UI consumes it.
 *
 * A separate type from [MessageDto] on purpose: the DTO is a wire contract that
 * may change, this is what the screen renders, and the mapping between them is
 * in one place (rule R10 — no DTO in a Composable).
 */
data class ChatProviderOption(
    val providerId: String,
    val name: String,
    val shared: Boolean = false,
    val pricingUrl: String? = null,
)

data class ChatModelChoice(
    val providerId: String,
    val providerName: String,
    val modelId: String,
    val displayName: String?,
    val free: Boolean?,
    val unavailable: Boolean,
    val contextLimit: Int? = null,
    val availability: String? = null,
    val pricingReported: Boolean = false,
)

data class ChatMessage(
    val id: String,
    val role: MessageRole,
    val text: String,
    val state: MessageState,
    val model: String? = null,
    val provider: String? = null,
    val errorCode: String? = null,
    val errorText: String? = null,
    val createdAt: String? = null,
    /** True for a message this device produced but the server has not stored. */
    val localOnly: Boolean = false,
    /** True when the text came from the local cache rather than a live fetch. */
    val fromCache: Boolean = false,
) {
    val isAssistant: Boolean get() = role == MessageRole.Assistant
    val isTerminal: Boolean get() = state != MessageState.Sending && state != MessageState.Streaming
}

/** Maps a stored row to a UI message. */
fun MessageDto.toChatMessage(): ChatMessage = ChatMessage(
    id = id,
    role = MessageRole.from(role),
    text = content,
    state = when {
        status == "streaming" -> MessageState.Streaming
        status == "complete" -> MessageState.Completed
        status == "cancelled" && errorCode == "interrupted" -> MessageState.Recovered
        status == "cancelled" -> MessageState.Stopped
        status == "error" -> MessageState.Failed
        else -> MessageState.Completed
    },
    model = model,
    provider = provider,
    errorCode = errorCode,
    createdAt = createdAt,
)
