package com.metaloid.core.common

import android.util.Log
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.CopyOnWriteArrayList

/**
 * The app's only logging entry point.
 *
 * Two properties matter more than convenience:
 *
 *  1. **Redaction is not optional.** Every message and every argument passes
 *     through [Redact] before it reaches logcat, the in-memory ring buffer or a
 *     diagnostics export. There is deliberately no `raw(...)` escape hatch.
 *  2. **Release builds are quiet.** Debug logging is enabled only in a debug
 *     build; a release build keeps the ring buffer (so "Copy diagnostics" can
 *     still produce something useful after a failure) but writes nothing to
 *     logcat beyond warnings and errors, which are themselves redacted.
 */
object MetaLog {

    enum class Level { DEBUG, INFO, WARN, ERROR }

    data class Entry(
        val at: Long,
        val level: Level,
        val tag: String,
        val message: String,
    )

    /** Ring buffer size. Enough to diagnose the last failure, bounded forever. */
    private const val MAX_ENTRIES = 300

    /** Set from [MetaIoidBuildConfig] at application start; false in release. */
    @Volatile
    var verbose: Boolean = false

    /** A crash that the app caught and wants the user to be able to report. */
    @Volatile
    var lastCrash: String? = null

    private val buffer = CopyOnWriteArrayList<Entry>()
    private val timeFormat = SimpleDateFormat("HH:mm:ss.SSS", Locale.US)

    fun d(tag: String, message: String, vararg args: Any?) = write(Level.DEBUG, tag, message, args)

    fun i(tag: String, message: String, vararg args: Any?) = write(Level.INFO, tag, message, args)

    fun w(tag: String, message: String, vararg args: Any?) = write(Level.WARN, tag, message, args)

    fun e(tag: String, message: String, throwable: Throwable? = null, vararg args: Any?) {
        write(Level.ERROR, tag, if (throwable == null) message else "$message (${throwable.javaClass.simpleName}: ${Redact.text(throwable.message)})", args)
        lastCrash = "${timeFormat.format(Date())} $tag ${Redact.text(message)} ${throwable?.javaClass?.simpleName ?: ""}"
    }

    private fun write(level: Level, tag: String, message: String, args: Array<out Any?>) {
        val rendered = if (args.isEmpty()) message else runCatching { message.format(*args.map { Redact.text(it?.toString()) }.toTypedArray()) }.getOrElse { message }
        val safe = Redact.text(rendered)
        when (level) {
            Level.DEBUG -> if (verbose) Log.d(tag, safe)
            Level.INFO -> if (verbose) Log.i(tag, safe)
            Level.WARN -> Log.w(tag, safe)
            Level.ERROR -> Log.e(tag, safe)
        }
        buffer.add(Entry(System.currentTimeMillis(), level, tag, safe))
        while (buffer.size > MAX_ENTRIES) buffer.removeAt(0)
    }

    /**
     * A redacted snapshot for the "Copy diagnostics" action (Settings →
     * Diagnostics). It contains no tokens, no message content and no PII.
     */
    fun diagnostics(appVersion: String, gatewayHost: String, accountLabel: String?): String = buildString {
        appendLine("MetaIoid Android $appVersion")
        appendLine("Gateway: $gatewayHost")
        appendLine("Account: ${Redact.identity(accountLabel)}")
        appendLine("Build: ${if (verbose) "debug" else "release"}")
        lastCrash?.let { appendLine("Last caught error: $it") }
        appendLine("--- log (redacted, most recent last) ---")
        buffer.takeLast(120).forEach { appendLine("${timeFormat.format(Date(it.at))} ${it.level} ${it.tag}: ${it.message}") }
    }

    /** Test/maintenance hook: clears the buffer without touching configuration. */
    fun clear() = buffer.clear()

    fun snapshot(): List<Entry> = buffer.toList()
}
