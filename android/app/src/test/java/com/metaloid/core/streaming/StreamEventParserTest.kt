package com.metaloid.core.streaming

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Frame → event mapping, against the exact wire shapes the gateway sends.
 * A mis-mapped key here shows up to the user as a wrong model name or a missing
 * answer, so every documented key has a case.
 */
class StreamEventParserTest {

    private fun frame(data: String, comment: Boolean = false) =
        SseFrame(event = null, data = data, id = null, retryMillis = null, isComment = comment)

    @Test
    fun `token frame`() {
        val events = StreamEventParser.parse(frame("""{"token":"Hello"}"""))
        assertEquals(listOf(StreamEvent.Token("Hello")), events)
    }

    @Test
    fun `done frame`() {
        assertEquals(listOf(StreamEvent.Done), StreamEventParser.parse(frame("""{"done":true}""")))
    }

    @Test
    fun `done false is not a completion`() {
        val events = StreamEventParser.parse(frame("""{"done":false}"""))
        assertTrue(events.none { it is StreamEvent.Done })
    }

    @Test
    fun `meta frame carries model tier provider and the sandbox flag`() {
        val events = StreamEventParser.parse(
            frame("""{"meta":{"model":"gpt-4o-mini","tier":"fast","provider":"openrouter","demo":true,"byok":false}}"""),
        )
        val meta = events.filterIsInstance<StreamEvent.Meta>().single()
        assertEquals("gpt-4o-mini", meta.model)
        assertEquals("fast", meta.tier)
        assertEquals("openrouter", meta.provider)
        assertEquals(true, meta.demo)
        assertEquals(false, meta.byok)
    }

    @Test
    fun `meta notice is surfaced when the platform key took over`() {
        val events = StreamEventParser.parse(
            frame("""{"meta":{"model":"m","demo":false,"byok":false,"notice":"byok_failed","notice_code":"bad_key"}}"""),
        )
        val meta = events.filterIsInstance<StreamEvent.Meta>().single()
        assertEquals("byok_failed", meta.notice)
        assertEquals("bad_key", meta.noticeCode)
    }

    @Test
    fun `error frame carries code and message`() {
        val events = StreamEventParser.parse(frame("""{"error":"out of credit","code":"no_credit"}"""))
        val error = events.filterIsInstance<StreamEvent.ServerError>().single()
        assertEquals("no_credit", error.code)
        assertEquals("out of credit", error.message)
    }

    @Test
    fun `retry frame carries the model slug`() {
        val events = StreamEventParser.parse(frame("""{"retry":"anthropic/claude-3-haiku"}"""))
        assertEquals(listOf(StreamEvent.Retry("anthropic/claude-3-haiku")), events)
    }

    @Test
    fun `one frame can carry two keys`() {
        val events = StreamEventParser.parse(frame("""{"token":"final","done":true}"""))
        assertTrue(events.any { it is StreamEvent.Token })
        assertTrue(events.any { it is StreamEvent.Done })
    }

    @Test
    fun `an unknown key is reported, not guessed at`() {
        val events = StreamEventParser.parse(frame("""{"tool_call":{"name":"search"}}"""))
        val unknown = events.filterIsInstance<StreamEvent.Unknown>().single()
        assertEquals(listOf("tool_call"), unknown.keys)
    }

    @Test
    fun `invalid json is malformed rather than fatal`() {
        val events = StreamEventParser.parse(frame("this is not json"))
        assertTrue(events.single() is StreamEvent.Malformed)
    }

    @Test
    fun `a json array is malformed, not a crash`() {
        assertTrue(StreamEventParser.parse(frame("[1,2,3]")).single() is StreamEvent.Malformed)
    }

    @Test
    fun `a comment frame produces nothing`() {
        assertTrue(StreamEventParser.parse(frame("", comment = true)).isEmpty())
    }

    @Test
    fun `an empty frame produces nothing`() {
        assertTrue(StreamEventParser.parse(frame("   ")).isEmpty())
    }

    @Test
    fun `the openai-style sentinel is accepted as done`() {
        assertEquals(listOf(StreamEvent.Done), StreamEventParser.parse(frame("[DONE]")))
    }
}
