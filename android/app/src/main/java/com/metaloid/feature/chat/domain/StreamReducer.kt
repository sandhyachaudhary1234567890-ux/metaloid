package com.metaloid.feature.chat.domain

import com.metaloid.core.common.AppError
import com.metaloid.core.common.MetaLog
import com.metaloid.core.streaming.StreamEvent

/**
 * The eight states one assistant turn can be in (Section 7.3).
 *
 * `Interrupted` is separate from `Failed` on purpose: a dropped connection is
 * recoverable (the partial answer is saved and the turn can continue), while a
 * provider failure is a finished attempt.
 */
enum class StreamPhase {
    Idle,
    Submitting,
    Connected,
    Streaming,
    Retrying,
    Completed,
    Failed,
    Cancelled,
    Interrupted,
    ;

    val isActive: Boolean get() = this == Submitting || this == Connected || this == Streaming || this == Retrying
    val isTerminal: Boolean get() = !isActive && this != Idle
}

/**
 * Everything the composer and the message list need to render one turn.
 *
 * Immutable and free of Android types, so the whole state machine is exercised
 * by plain JVM tests — including the ordering cases that are impossible to
 * reproduce reliably against a live server.
 */
data class StreamState(
    val phase: StreamPhase = StreamPhase.Idle,
    /** Always the latest cumulative text. Replaced, never appended to. */
    val text: String = "",
    val attempt: Int = 0,
    val model: String? = null,
    val tier: String? = null,
    val provider: String? = null,
    /** The gateway said the local sandbox provider answered: not a real model. */
    val demo: Boolean = false,
    /** Backend notice explaining a provider fallback (for example, a rejected BYOK key). */
    val notice: String? = null,
    val noticeCode: String? = null,
    val byok: Boolean? = null,
    /**
     * Text from an attempt the server abandoned (`retry`). Kept so the UI can
     * say what happened instead of silently rewriting history; it is *not* part
     * of the final message.
     */
    val supersededText: String = "",
    val error: AppError? = null,
    /** Server-side message id, once the first token produced a row. */
    val messageId: String? = null,
    val startedAtMs: Long = 0L,
    /** Counted, not shown; a non-zero value means the server misbehaved. */
    val anomalies: Int = 0,
) {
    /** True when the turn produced nothing at all — an honest empty state. */
    val isEmptyResult: Boolean get() = phase == StreamPhase.Completed && text.isBlank()

    val hasPartialText: Boolean get() = text.isNotBlank()
}

/**
 * The turn state machine, as a pure function.
 *
 * Rules implemented here (each one is a test in StreamReducerTest):
 *
 *  1. `token` **replaces** the buffer. Cumulative semantics; appending is the
 *     classic duplicate-text bug this project exists to avoid.
 *  2. A token shorter than the current text is only legitimate right after a
 *     `retry` reset. Otherwise it is an anomaly: the longer text is kept and the
 *     event is counted and logged, because a response that visibly shrinks
 *     mid-stream is a defect the user must never see.
 *  3. `retry` moves the current text to [StreamState.supersededText] and clears
 *     the visible text — the server discarded that attempt when it failed over
 *     to another model, and pretending otherwise would show a reply stitched
 *     together from two models.
 *  4. `done` without any token is a *completed empty* response, not a blank
 *     bubble: the UI renders "The model returned an empty response."
 *  5. A stream that ends with no terminal event is [StreamPhase.Interrupted],
 *     never `Completed` (case 7).
 *  6. `error` after partial text keeps the text (case 5); `error` before any
 *     token leaves no bubble behind (case 4).
 *  7. Events arriving after a terminal state are ignored, so a late frame from
 *     a dying socket cannot resurrect a finished turn.
 */
object StreamReducer {

    private const val TAG = "stream"

    fun reduce(state: StreamState, event: StreamEvent): StreamState {
        if (state.phase.isTerminal && event !is StreamEvent.Meta) {
            // A late token after `done`/`error` is a server-side ordering
            // anomaly; ignoring it keeps the transcript stable.
            if (event is StreamEvent.Token || event is StreamEvent.Done || event is StreamEvent.ServerError) {
                MetaLog.w(TAG, "ignoring %s after terminal phase %s", event::class.simpleName, state.phase)
                return state
            }
        }
        return when (event) {
            StreamEvent.Connected -> when (state.phase) {
                StreamPhase.Submitting, StreamPhase.Idle -> state.copy(phase = StreamPhase.Connected)
                else -> state
            }

            is StreamEvent.Meta -> state.copy(
                model = event.model ?: state.model,
                tier = event.tier ?: state.tier,
                provider = event.provider ?: state.provider,
                demo = event.demo ?: state.demo,
                notice = event.notice ?: state.notice,
                noticeCode = event.noticeCode ?: state.noticeCode,
                byok = event.byok ?: state.byok,
                phase = if (state.phase == StreamPhase.Submitting) StreamPhase.Connected else state.phase,
            )

            is StreamEvent.Retry -> state.copy(
                phase = StreamPhase.Retrying,
                attempt = state.attempt + 1,
                supersededText = state.text.ifBlank { state.supersededText },
                model = event.modelSlug,
                provider = null,
                demo = false,
                notice = null,
                noticeCode = null,
                byok = null,
                text = "",
                error = null,
            )

            is StreamEvent.Token -> {
                val incoming = event.cumulativeText
                if (incoming.length < state.text.length) {
                    // Legitimate only immediately after a retry reset (which is
                    // a different phase); otherwise keep the longer text.
                    if (state.phase == StreamPhase.Retrying || state.text.isEmpty()) {
                        state.copy(phase = StreamPhase.Streaming, text = incoming)
                    } else {
                        MetaLog.w(
                            TAG,
                            "token shrank (%d -> %d chars); keeping the longer text",
                            state.text.length,
                            incoming.length,
                        )
                        state.copy(phase = StreamPhase.Streaming, anomalies = state.anomalies + 1)
                    }
                } else {
                    state.copy(phase = StreamPhase.Streaming, text = incoming, error = null)
                }
            }

            StreamEvent.Done -> if (state.phase.isTerminal) {
                state
            } else {
                state.copy(phase = StreamPhase.Completed)
            }

            is StreamEvent.ServerError -> {
                val mapped = com.metaloid.core.network.ErrorMapper.fromStreamCode(event.code, event.message)
                if (mapped is AppError.Stopped) {
                    // The server acknowledged a client-side cancellation.
                    state.copy(phase = StreamPhase.Cancelled)
                } else {
                    state.copy(
                        phase = StreamPhase.Failed,
                        error = mapped,
                        // Partial text is kept: it is real output the server
                        // already produced and the user already read.
                    )
                }
            }

            is StreamEvent.Failed -> state.copy(phase = StreamPhase.Failed, error = event.error)

            is StreamEvent.Malformed -> {
                MetaLog.w(TAG, "skipping malformed frame: %s", event.detail)
                state.copy(anomalies = state.anomalies + 1)
            }

            is StreamEvent.Unknown -> {
                MetaLog.i(TAG, "ignoring unknown stream event: %s", event.keys.joinToString(","))
                state
            }
        }
    }

    /** Called when the stream ended without a terminal event (case 7). */
    fun onStreamClosed(state: StreamState): StreamState = when (state.phase) {
        StreamPhase.Completed, StreamPhase.Failed, StreamPhase.Cancelled -> state
        StreamPhase.Submitting, StreamPhase.Connected ->
            state.copy(phase = StreamPhase.Failed, error = AppError.StreamInterrupted("closed before first token"))
        else -> state.copy(phase = StreamPhase.Interrupted, error = AppError.StreamInterrupted("closed mid-stream"))
    }

    /** Called when the user pressed stop (case 8). */
    fun onUserStop(state: StreamState): StreamState = when (state.phase) {
        // Stopping before anything arrived is a cancellation with nothing to
        // keep; the UI removes the bubble rather than leaving an empty one.
        StreamPhase.Submitting, StreamPhase.Connected -> state.copy(phase = StreamPhase.Cancelled, error = null)
        else -> state.copy(phase = StreamPhase.Cancelled, error = null)
    }

    /** Called when the transport died (offline, timeout). */
    fun onTransportLoss(state: StreamState, error: AppError): StreamState =
        state.copy(phase = StreamPhase.Interrupted, error = error)
}
