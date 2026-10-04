package com.metaloid.app

import kotlinx.serialization.Serializable

/**
 * Every destination in the app.
 *
 * The back stack is a plain `List<Route>` held by [AppViewModel] and encoded to
 * one string by [RouteCodec], so a user who is reading a mission on a
 * low-memory device comes back to that mission rather than to the conversation
 * list (Section 15, navigation). The encoding is written by hand rather than
 * generated: it is five lines of string splitting, and hand-written means the
 * persistence format cannot change under the app's feet when a plugin version
 * moves.
 *
 * Hand-rolled navigation instead of `navigation-compose`: the graph is flat, the
 * transitions are two cross-fades, and this is less code than the dependency —
 * and one fewer version to keep in step.
 */
sealed interface Route {

    /** The conversation list — also the app's root. */
    data object Conversations : Route

    data class Chat(val conversationId: String) : Route

    data object Memory : Route

    data object Missions : Route

    data class MissionDetail(val missionId: String) : Route

    data object Research : Route

    data class ResearchDetail(val investigationId: String) : Route

    data object Activity : Route

    data object Settings : Route

    data object Usage : Route

    data object Diagnostics : Route

    /** Stable identity for `key()` in lists and for the back stack. */
    val key: String
        get() = when (this) {
            Conversations -> "conversations"
            is Chat -> "chat:$conversationId"
            Memory -> "memory"
            Missions -> "missions"
            is MissionDetail -> "mission:$missionId"
            Research -> "research"
            is ResearchDetail -> "researchDetail:$investigationId"
            Activity -> "activity"
            Settings -> "settings"
            Usage -> "usage"
            Diagnostics -> "diagnostics"
        }
}

/**
 * Encodes and decodes a route stack to a single string.
 *
 * The format is `segment|segment|…` where `segment` is `name` or `name:argument`.
 * A conversation id is a UUID and a mission id is a slug, so neither can contain
 * `|`; the decoder is still defensive, and an unparsable segment is dropped
 * rather than crashing the launch path.
 */
object RouteCodec {

    fun encode(stack: List<Route>): String = stack.joinToString("|") { it.key }

    fun decode(value: String?): List<Route> {
        if (value.isNullOrBlank()) return emptyList()
        return value.split('|').mapNotNull { segment -> decodeOne(segment) }
    }

    fun decodeOne(segment: String): Route? {
        val (name, argument) = if (segment.contains(':')) {
            segment.substringBefore(':') to segment.substringAfter(':')
        } else {
            segment to null
        }
        return when (name) {
            "conversations" -> Route.Conversations
            "chat" -> argument?.let { Route.Chat(it) }
            "memory" -> Route.Memory
            "missions" -> Route.Missions
            "mission" -> argument?.let { Route.MissionDetail(it) }
            "research" -> Route.Research
            "researchDetail" -> argument?.let { Route.ResearchDetail(it) }
            "activity" -> Route.Activity
            "settings" -> Route.Settings
            "usage" -> Route.Usage
            "diagnostics" -> Route.Diagnostics
            else -> null
        }
    }
}
