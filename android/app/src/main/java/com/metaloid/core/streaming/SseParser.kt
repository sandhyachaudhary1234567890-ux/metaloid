package com.metaloid.core.streaming

/**
 * One Server-Sent Events frame, after parsing.
 *
 * `data` may span several `data:` lines (the spec joins them with newlines), and
 * `event`/`id`/`retry` are optional. The gateway sends only `data:` lines plus
 * `: ping` comments, but the parser implements the whole field grammar so a
 * server that starts using event names does not break an installed client.
 */
data class SseFrame(
    val event: String?,
    val data: String,
    val id: String?,
    val retryMillis: Long?,
    val isComment: Boolean = false,
)

/**
 * Incremental, allocation-frugal SSE parser.
 *
 * Contract (each case is a unit test in SseParserTest):
 *   * a frame is dispatched on a blank line;
 *   * a chunk may split anywhere — mid-field, mid-line, mid-frame;
 *   * CRLF, LF and bare CR line endings are all accepted;
 *   * `:` comment lines (the keep-alive heartbeat) produce no frame;
 *   * multiple `data:` lines are joined with `\n`;
 *   * a field with no colon is a field with an empty value (`data`);
 *   * trailing content at EOF is flushed by [finish], not silently dropped.
 *
 * It holds a `StringBuilder` of the *incomplete* tail only: a 10 000-token
 * response never accumulates in the parser, which is what keeps memory bounded
 * on a long stream.
 */
class SseParser {

    private val buffer = StringBuilder()
    private val data = StringBuilder()
    private var eventName: String? = null
    private var lastId: String? = null
    private var retryMillis: Long? = null
    private var hasField = false

    fun feed(chunk: String): List<SseFrame> {
        if (chunk.isEmpty()) return emptyList()
        buffer.append(chunk)
        val frames = mutableListOf<SseFrame>()
        var index = 0
        while (index < buffer.length) {
            val newlineAt = indexOfLineBreak(index)
            if (newlineAt < 0) break
            val line = buffer.substring(index, newlineAt)
            // Consume the terminator; CRLF is a single break.
            val terminatorLength = if (buffer[newlineAt] == '\r' && newlineAt + 1 < buffer.length && buffer[newlineAt + 1] == '\n') 2 else 1
            if (buffer[newlineAt] == '\r' && newlineAt + 1 >= buffer.length) {
                // A CR at the very end of the buffer may be half of a CRLF that
                // has not arrived yet. Waiting for one more byte is correct; a
                // bare CR is accepted on the next feed or by finish().
                break
            }
            index = newlineAt + terminatorLength
            dispatchLine(line)?.let(frames::add)
        }
        if (index > 0) buffer.delete(0, index)
        return frames
    }

    /** Flushes whatever the socket left behind when it closed. */
    fun finish(): List<SseFrame> {
        val frames = mutableListOf<SseFrame>()
        if (buffer.isNotEmpty()) {
            val tail = buffer.toString()
            buffer.setLength(0)
            tail.split('\n', '\r').forEach { line -> dispatchLine(line)?.let(frames::add) }
        }
        // A last frame without a trailing blank line is still a frame.
        takeFrame()?.let(frames::add)
        return frames
    }

    private fun indexOfLineBreak(from: Int): Int {
        for (i in from until buffer.length) {
            val c = buffer[i]
            if (c == '\n' || c == '\r') return i
        }
        return -1
    }

    private fun dispatchLine(line: String): SseFrame? {
        if (line.isEmpty()) return takeFrame()
        if (line.startsWith(":")) {
            // A comment is a heartbeat. It carries no payload, but it *is*
            // evidence the connection is alive, so the transport counts it.
            return SseFrame(event = null, data = "", id = null, retryMillis = null, isComment = true)
        }
        val colon = line.indexOf(':')
        val field = if (colon < 0) line else line.substring(0, colon)
        var value = if (colon < 0) "" else line.substring(colon + 1)
        if (value.startsWith(" ")) value = value.substring(1)
        when (field) {
            "data" -> {
                if (data.isNotEmpty()) data.append('\n')
                data.append(value)
                hasField = true
            }
            "event" -> eventName = value
            "id" -> if (!value.contains('\u0000')) lastId = value
            "retry" -> retryMillis = value.toLongOrNull()
            else -> Unit // Unknown fields are ignored, per the SSE spec.
        }
        return null
    }

    private fun takeFrame(): SseFrame? {
        if (!hasField && eventName == null) return null
        val frame = SseFrame(
            event = eventName,
            data = data.toString(),
            id = lastId,
            retryMillis = retryMillis,
        )
        data.setLength(0)
        eventName = null
        retryMillis = null
        hasField = false
        return frame
    }
}
