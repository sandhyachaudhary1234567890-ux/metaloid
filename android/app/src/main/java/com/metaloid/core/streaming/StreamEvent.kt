package com.metaloid.core.streaming

import com.metaloid.core.common.AppError
import com.metaloid.core.network.MetaJson
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive

/**
 * The chat stream protocol, as typed values.
 *
 * Verified against `server/src/index.js` (`POST /api/chat`):
 *
 *   `{"meta":{model,tier,provider,demo[,byok][,notice][,notice_code]}}`
 *   `{"retry":"<model-slug>"}`             failover to the next candidate
 *   `{"token":"<full text so far>"}`       **cumulative**, not a delta
 *   `{"done":true}`
 *   `{"error":"…","code":"…"}`             stable code vocabulary
 *
 * Plus `: ping` / `: connected` comments (no frame), which the transport treats
 * as liveness evidence.
 *
 * Unknown keys and unknown event shapes become [Unknown] and are logged, never
 * fatal: a server that adds an event must not break an installed client.
 */
sealed interface StreamEvent {

    /** Response headers received. The model has not produced anything yet. */
    data object Connected : StreamEvent

    data class Meta(
        val model: String?,
        val tier: String?,
        val provider: String?,
        /**
         * `true` means the *local sandbox provider* answered — nothing real was
         * charged and nothing real was generated. The UI must say so.
         */
        val demo: Boolean?,
        val byok: Boolean? = null,
        /** `byok_failed` when the user's own key failed and the platform key took over. */
        val notice: String? = null,
        val noticeCode: String? = null,
    ) : StreamEvent

    /** The server is trying another model. Text from the previous attempt is gone. */
    data class Retry(val modelSlug: String) : StreamEvent

    /** Cumulative text. Replace the buffer; never append. */
    data class Token(val cumulativeText: String) : StreamEvent

    data object Done : StreamEvent

    data class ServerError(val code: String?, val message: String?) : StreamEvent

    /** A frame that could not be understood. Logged and skipped by the reducer. */
    data class Malformed(val detail: String) : StreamEvent

    /** A frame that parsed but carries nothing this build knows. */
    data class Unknown(val keys: List<String>) : StreamEvent

    /** Transport/HTTP failure, already mapped to a typed error. */
    data class Failed(val error: AppError) : StreamEvent
}

/** Turns raw SSE frames into [StreamEvent]s. Pure; unit-tested. */
object StreamEventParser {

    /**
     * One frame can, in principle, carry more than one key (`{"token":…,"done":true}`).
     * Returning a list handles that without an extra protocol rule.
     */
    fun parse(frame: SseFrame): List<StreamEvent> {
        if (frame.isComment) return emptyList()
        val payload = frame.data.trim()
        if (payload.isEmpty()) return emptyList()
        if (payload == "[DONE]") return listOf(StreamEvent.Done)
        val obj = runCatching { MetaJson.parseToJsonElement(payload) as? JsonObject }.getOrNull()
            ?: return listOf(StreamEvent.Malformed("not a json object"))
        val events = mutableListOf<StreamEvent>()

        obj.string("error")?.let { events += StreamEvent.ServerError(code = obj.string("code"), message = it) }
        obj.string("token")?.let { events += StreamEvent.Token(it) }
        obj.string("retry")?.let { events += StreamEvent.Retry(it) }
        obj.boolean("done")?.let { if (it) events += StreamEvent.Done }
        obj["meta"]?.let { meta ->
            val metaObj = meta as? JsonObject
            if (metaObj == null) {
                events += StreamEvent.Malformed("meta was not an object")
            } else {
                events += StreamEvent.Meta(
                    model = metaObj.string("model"),
                    tier = metaObj.string("tier"),
                    provider = metaObj.string("provider"),
                    demo = metaObj.boolean("demo"),
                    byok = metaObj.boolean("byok"),
                    notice = metaObj.string("notice"),
                    noticeCode = metaObj.string("notice_code"),
                )
            }
        }
        if (events.isEmpty()) events += StreamEvent.Unknown(obj.keys.toList())
        return events
    }
}

/** Reads a JSON value as a string, tolerating numbers and booleans. */
internal fun JsonObject.string(key: String): String? {
    val element = this[key] ?: return null
    val primitive = element as? JsonPrimitive ?: return null
    if (primitive.isString) return primitive.content
    // A non-string where a string is documented is a protocol violation the
    // caller must see, not something to coerce silently — except for numbers and
    // booleans, which some providers do emit for `retry`/`done`.
    return runCatching { primitive.jsonPrimitive.content }.getOrNull()
}

internal fun JsonObject.boolean(key: String): Boolean? {
    val element = this[key] as? JsonPrimitive ?: return null
    return when {
        element.isString -> when (element.content.lowercase()) {
            "true" -> true
            "false" -> false
            else -> null
        }
        else -> runCatching { element.content.toBooleanStrict() }.getOrNull()
    }
}
