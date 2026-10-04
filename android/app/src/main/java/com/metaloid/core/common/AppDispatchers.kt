package com.metaloid.core.common

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers

/**
 * Dispatchers, injected rather than hard-coded.
 *
 * Every class that needs a thread says so through this interface, which is what
 * lets a unit test run a repository on a `TestDispatcher` with a virtual clock
 * instead of on a real background thread with real timeouts. Hard-coding
 * `Dispatchers.IO` inside a class makes that class untestable without
 * `runBlocking`, and `runBlocking` is how "deterministic" tests stop being one.
 */
interface AppDispatchers {
    val main: CoroutineDispatcher
    val io: CoroutineDispatcher
    val default: CoroutineDispatcher
}

/** Production wiring. */
object SystemDispatchers : AppDispatchers {
    override val main: CoroutineDispatcher = Dispatchers.Main
    override val io: CoroutineDispatcher = Dispatchers.IO
    override val default: CoroutineDispatcher = Dispatchers.Default
}
