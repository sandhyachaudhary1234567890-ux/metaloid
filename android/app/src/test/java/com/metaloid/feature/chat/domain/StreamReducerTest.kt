package com.metaloid.feature.chat.domain

import com.metaloid.core.common.AppError
import com.metaloid.core.streaming.StreamEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The reducer is a pure function, so these tests are the specification of the
 * streaming contract: tokens are cumulative, a retry discards the previous
 * attempt, and a finished turn cannot be reopened by a late frame.
 */
class StreamReducerTest {

    private fun submitting() = StreamState(phase = StreamPhase.Submitting, startedAtMs = 1_000L)

    @Test
    fun `a token replaces the buffer rather than appending`() {
        var state = submitting()
        state = StreamReducer.reduce(state, StreamEvent.Token("Hel"))
        state = StreamReducer.reduce(state, StreamEvent.Token("Hello"))
        assertEquals("Hello", state.text)
        assertEquals(StreamPhase.Streaming, state.phase)
    }

    @Test
    fun `a shrinking token keeps the longer text and counts an anomaly`() {
        var state = submitting()
        state = StreamReducer.reduce(state, StreamEvent.Token("Hello there"))
        state = StreamReducer.reduce(state, StreamEvent.Token("Hello"))
        assertEquals("Hello there", state.text)
        assertEquals(1, state.anomalies)
    }

    @Test
    fun `a retry discards the previous attempt and keeps it as superseded text`() {
        var state = submitting()
        state = StreamReducer.reduce(state, StreamEvent.Token("first attempt"))
        state = StreamReducer.reduce(state, StreamEvent.Retry("some/model"))
        assertEquals("", state.text)
        assertEquals("first attempt", state.supersededText)
        assertEquals(StreamPhase.Retrying, state.phase)
        assertEquals(1, state.attempt)

        // A shorter token immediately after a retry is legitimate, not an anomaly.
        state = StreamReducer.reduce(state, StreamEvent.Token("second"))
        assertEquals("second", state.text)
        assertEquals(0, state.anomalies)
    }

    @Test
    fun `done with no token completes an empty result`() {
        var state = submitting()
        state = StreamReducer.reduce(state, StreamEvent.Done)
        assertEquals(StreamPhase.Completed, state.phase)
        assertTrue(state.isEmptyResult)
    }

    @Test
    fun `events after a terminal phase are ignored`() {
        var state = submitting()
        state = StreamReducer.reduce(state, StreamEvent.Token("Answer"))
        state = StreamReducer.reduce(state, StreamEvent.Done)
        val completed = state
        state = StreamReducer.reduce(state, StreamEvent.Token("Answer plus more"))
        assertEquals(completed, state)
    }

    @Test
    fun `meta fills model and provider and reports the sandbox honestly`() {
        var state = submitting()
        state = StreamReducer.reduce(
            state,
            StreamEvent.Meta(model = "gpt-4o-mini", tier = "fast", provider = "openrouter", demo = true),
        )
        assertEquals("gpt-4o-mini", state.model)
        assertEquals("fast", state.tier)
        assertEquals("openrouter", state.provider)
        assertTrue(state.demo)
        assertEquals(StreamPhase.Connected, state.phase)
    }

    @Test
    fun `a server error maps to a typed failure and keeps the partial text`() {
        var state = submitting()
        state = StreamReducer.reduce(state, StreamEvent.Token("Partial answer"))
        state = StreamReducer.reduce(state, StreamEvent.ServerError("no_credit", "out of credit"))
        assertEquals(StreamPhase.Failed, state.phase)
        assertEquals("Partial answer", state.text)
        assertTrue(state.error is AppError.NoCredit)
    }

    @Test
    fun `a cancelled server error is a cancellation, not a failure`() {
        var state = submitting()
        state = StreamReducer.reduce(state, StreamEvent.ServerError("cancelled", null))
        assertEquals(StreamPhase.Cancelled, state.phase)
        assertNull(state.error)
    }

    @Test
    fun `closing before the first token is a failure without partial text`() {
        var state = submitting()
        state = StreamReducer.reduce(state, StreamEvent.Connected)
        state = StreamReducer.onStreamClosed(state)
        assertEquals(StreamPhase.Failed, state.phase)
        assertTrue(state.error is AppError.StreamInterrupted)
    }

    @Test
    fun `closing mid stream is an interruption that preserves what arrived`() {
        var state = submitting()
        state = StreamReducer.reduce(state, StreamEvent.Token("half an answer"))
        state = StreamReducer.onStreamClosed(state)
        assertEquals(StreamPhase.Interrupted, state.phase)
        assertEquals("half an answer", state.text)
        assertTrue(state.error is AppError.StreamInterrupted)
    }

    @Test
    fun `closing after done does not change a completed turn`() {
        var state = submitting()
        state = StreamReducer.reduce(state, StreamEvent.Token("done already"))
        state = StreamReducer.reduce(state, StreamEvent.Done)
        val completed = state
        assertEquals(completed, StreamReducer.onStreamClosed(state))
    }

    @Test
    fun `a user stop before any token cancels with nothing to keep`() {
        val state = StreamReducer.onUserStop(submitting())
        assertEquals(StreamPhase.Cancelled, state.phase)
        assertEquals("", state.text)
    }

    @Test
    fun `transport loss is an interruption carrying the transport error`() {
        var state = submitting()
        state = StreamReducer.reduce(state, StreamEvent.Token("partial"))
        state = StreamReducer.onTransportLoss(state, AppError.Timeout())
        assertEquals(StreamPhase.Interrupted, state.phase)
        assertTrue(state.error is AppError.Timeout)
    }

    @Test
    fun `malformed frames count as anomalies and change nothing else`() {
        var state = submitting()
        state = StreamReducer.reduce(state, StreamEvent.Token("text"))
        val before = state
        state = StreamReducer.reduce(state, StreamEvent.Malformed("not json"))
        assertEquals(before.text, state.text)
        assertEquals(before.phase, state.phase)
        assertEquals(1, state.anomalies)
    }

    @Test
    fun `unknown events are ignored without counting as anomalies`() {
        var state = submitting()
        state = StreamReducer.reduce(state, StreamEvent.Unknown(listOf("future_key")))
        assertEquals(0, state.anomalies)
        assertEquals(StreamPhase.Submitting, state.phase)
    }
}
