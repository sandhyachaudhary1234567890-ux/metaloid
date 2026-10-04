package com.metaloid.core.ui

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

/**
 * Time, as a person reads it.
 *
 * The server sends ISO-8601 timestamps. Rendering them raw is the kind of thing
 * that makes an app look like a debug console, so they are formatted relative to
 * *now*, with the exact value available in the accessibility label rather than
 * on the face of the list.
 *
 * Everything here is pure and timezone-aware; the caller passes `nowMs` so the
 * result is testable and does not silently depend on the device clock at render
 * time.
 */
object TimeFormat {

    private val time = DateTimeFormatter.ofPattern("HH:mm")
    private val day = DateTimeFormatter.ofPattern("d MMM")
    private val full = DateTimeFormatter.ofPattern("d MMM yyyy, HH:mm")

    /** Parses an ISO timestamp, or returns null when the server did not send one. */
    fun parse(iso: String?): Instant? {
        if (iso.isNullOrBlank()) return null
        return runCatching { Instant.parse(iso) }.getOrNull()
    }

    /**
     * "just now", "4 min ago", "3 h ago", "yesterday", "12 Mar", "12 Mar 2025".
     *
     * A null or unparsable timestamp returns "—", never "now": inventing a time
     * is how a stale cached list starts looking live.
     */
    fun relative(iso: String?, nowMs: Long, zone: ZoneId = ZoneId.systemDefault()): String {
        val instant = parse(iso) ?: return "—"
        val seconds = ChronoUnit.SECONDS.between(instant, Instant.ofEpochMilli(nowMs))
        val localDate = instant.atZone(zone).toLocalDate()
        val today = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()
        return when {
            seconds < 0 -> absolute(instant, today, zone) // clock skew: show the real time
            seconds < 45 -> "just now"
            seconds < 3_600 -> "${seconds / 60} min ago"
            seconds < 86_400 -> "${seconds / 3_600} h ago"
            localDate == today.minusDays(1) -> "yesterday"
            localDate.year == today.year -> day.format(instant.atZone(zone))
            else -> full.format(instant.atZone(zone)).substringBefore(',')
        }
    }

    /** The exact timestamp, for accessibility labels and detail views. */
    fun exact(iso: String?, zone: ZoneId = ZoneId.systemDefault()): String {
        val instant = parse(iso) ?: return "unknown time"
        return full.format(instant.atZone(zone))
    }

    private fun absolute(instant: Instant, today: LocalDate, zone: ZoneId): String {
        val localDate = instant.atZone(zone).toLocalDate()
        return when {
            localDate == today -> "today at ${time.format(instant.atZone(zone))}"
            localDate == today.minusDays(1) -> "yesterday at ${time.format(instant.atZone(zone))}"
            else -> day.format(instant.atZone(zone))
        }
    }

    /** "3 min 20 s", "1.4 s" — for a latency the server actually measured. */
    fun duration(ms: Long?): String {
        if (ms == null || ms < 0) return "—"
        return when {
            ms < 1_000 -> "$ms ms"
            ms < 60_000 -> String.format("%.1f s", ms / 1000.0)
            else -> "${ms / 60_000} min ${(ms % 60_000) / 1000} s"
        }
    }

    /** "12.4 KB" — a real byte count, never a rounded-up pretend one. */
    fun bytes(count: Long?): String {
        if (count == null || count < 0) return "unknown size"
        val units = listOf("B", "KB", "MB", "GB")
        var value = count.toDouble()
        var unit = 0
        while (value >= 1024 && unit < units.lastIndex) {
            value /= 1024
            unit += 1
        }
        return if (unit == 0) "${count} B" else String.format("%.1f %s", value, units[unit])
    }
}
