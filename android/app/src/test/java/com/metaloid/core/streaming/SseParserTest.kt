package com.metaloid.core.streaming

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The SSE parser is the one piece of this app that must not be approximately
 * right: a dropped frame loses text, and a duplicated one duplicates it. These
 * cases are the ones a real token stream produces.
 *
 * Wire reference: `POST /api/chat` writes `data: {"token":"…"}` frames, a
 * `: ping` comment every 8 seconds, and `data: {"done":true}` at the end.
 */
class SseParserTest {

    @Test
    fun `parses a single complete frame`() {
        val frames = SseParser().feed("data: {\"token\":\"Hello\"}\n\n")
        assertEquals(1, frames.size)
        assertEquals("{\"token\":\"Hello\"}", frames[0].data)
        assertFalse(frames[0].isComment)
    }

    @Test
    fun `keeps a partial line across chunks`() {
        val parser = SseParser()
        assertTrue(parser.feed("data: {\"to").isEmpty())
        assertTrue(parser.feed("ken\":\"Hel").isEmpty())
        val frames = parser.feed("lo\"}\n\n")
        assertEquals(1, frames.size)
        assertEquals("{\"token\":\"Hello\"}", frames[0].data)
    }

    @Test
    fun `a frame split across a newline boundary is not emitted early`() {
        val parser = SseParser()
        // The chunk ends exactly after the first newline of the blank-line pair.
        assertTrue(parser.feed("data: one\n").isEmpty())
        val frames = parser.feed("\n")
        assertEquals(listOf("one"), frames.map { it.data })
    }

    @Test
    fun `handles CRLF and bare CR line endings`() {
        val crlf = SseParser().feed("data: a\r\n\r\n")
        assertEquals(listOf("a"), crlf.map { it.data })

        val bare = SseParser().feed("data: b\r\r")
        assertEquals(listOf("b"), bare.map { it.data })
    }

    @Test
    fun `joins multiple data lines of one frame with a newline`() {
        val frames = SseParser().feed("data: first\ndata: second\n\n")
        assertEquals(1, frames.size)
        assertEquals("first\nsecond", frames[0].data)
    }

    @Test
    fun `ignores unknown fields and strips one leading space`() {
        val frames = SseParser().feed("event: message\ndata:  spaced\nid: 7\nretry: 1500\n\n")
        assertEquals(1, frames.size)
        assertEquals(" spaced", frames[0].data)
        assertEquals("message", frames[0].event)
        assertEquals("7", frames[0].id)
        assertEquals(1500L, frames[0].retryMillis)
    }

    @Test
    fun `treats a comment line as a frame the UI can ignore`() {
        val frames = SseParser().feed(": ping\n\n")
        assertEquals(1, frames.size)
        assertTrue(frames[0].isComment)
        assertEquals("", frames[0].data)
    }

    @Test
    fun `comment frames and data frames do not merge`() {
        val frames = SseParser().feed(": ping\ndata: {}\n\n")
        assertEquals(1, frames.size)
        assertEquals("{}", frames[0].data)
        // The comment is not part of the data frame, and must not clear it.
        assertFalse(frames[0].isComment)
    }

    @Test
    fun `finish flushes a final frame with no trailing blank line`() {
        val parser = SseParser()
        assertTrue(parser.feed("data: tail").isEmpty())
        val frames = parser.finish()
        assertEquals(listOf("tail"), frames.map { it.data })
    }

    @Test
    fun `a blank line with no data is not a frame`() {
        assertTrue(SseParser().feed("\n\n\n").isEmpty())
    }

    @Test
    fun `token frames arrive in order and the last one wins`() {
        val parser = SseParser()
        val frames = parser.feed(
            "data: {\"token\":\"A\"}\n\ndata: {\"token\":\"AB\"}\n\ndata: {\"token\":\"ABC\"}\n\n",
        )
        val tokens = frames.mapNotNull { StreamEventParser.parse(it).filterIsInstance<StreamEvent.Token>().firstOrNull() }
        assertEquals(listOf("A", "AB", "ABC"), tokens.map { it.cumulativeText })
    }
}
