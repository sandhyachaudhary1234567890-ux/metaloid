package com.metaloid.core.designsystem

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Immutable
import androidx.compose.ui.unit.IntOffset

/**
 * The motion system, mirrored from the web client's `src/design/motion.ts`.
 *
 * Four durations and four easings. Every animation in the app picks one of
 * them — ad-hoc timings are what make motion feel amateur even when each
 * individual animation is fine.
 *
 * [reduced] is not a "nice to have": when the user has asked the system (or this
 * app) for reduced motion, every spec collapses to an instant state change and
 * the continuous indicators stop breathing. The label beside a state always
 * carries the meaning, so nothing is lost (Section 10.5).
 */
@Immutable
data class MotionConfig(val reduced: Boolean) {

    /** Press feedback, icon swaps, focus rings — under the perception threshold. */
    val microMs: Int = 120

    /** Menus, chips, small state flips. */
    val smallMs: Int = 180

    /** Panels, cross-fades, message arrival. */
    val mediumMs: Int = 260

    /** Boot, welcome entrance, voice overlay. Reserved for moments. */
    val largeMs: Int = 420

    val easeOut: Easing = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)
    val easeInOut: Easing = CubicBezierEasing(0.65f, 0f, 0.35f, 1f)
    val easePrecise: Easing = CubicBezierEasing(0.16f, 1f, 0.3f, 1f)

    fun <T> tween(durationMs: Int): FiniteAnimationSpec<T> =
        if (reduced) tween(durationMillis = 1) else tween(durationMillis = durationMs, easing = easeOut)

    /** Sheets and pickers: controlled, low bounce, never a toy spring. */
    fun <T> panelSpring(): FiniteAnimationSpec<T> = spring(
        dampingRatio = Spring.DampingRatioNoBouncy,
        stiffness = Spring.StiffnessMediumLow,
    )

    /** Buttons: a settle, not a wobble. */
    fun <T> pressSpring(): FiniteAnimationSpec<T> = spring(
        dampingRatio = Spring.DampingRatioNoBouncy,
        stiffness = Spring.StiffnessHigh,
    )

    /** Vertical travel for arriving content: 6dp — enough to read, not to jolt. */
    fun arriveOffset(): FiniteAnimationSpec<IntOffset> = tween(mediumMs)

    companion object {
        val Default = MotionConfig(reduced = false)
        val Reduced = MotionConfig(reduced = true)
    }
}
