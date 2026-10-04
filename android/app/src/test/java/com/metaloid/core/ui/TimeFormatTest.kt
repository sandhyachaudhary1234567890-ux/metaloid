package com.metaloid.core.ui

import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Relative time is how the list reads the server's ISO timestamps. The cases
 * that matter are the honest ones: an absent timestamp is "—", and a clock skew
 * is shown as the real time rather than as "in the future".
 */
class TimeFormatTest {

    private val utc = ZoneId.of("UTC")

    /** 2026-03-12T09:30:00Z */
    private val base = "2026-03-12T09:30:00Z"

    private fun at(iso: String) = TimeFormat.parse(iso)!!.toEpochMilli()

    @Test
    fun `an absent or unparsable timestamp is a dash, never now`() {
        assertEquals("—", TimeFormat.relative(null, 0L, utc))
        assertEquals("—", TimeFormat.relative("", 0L, utc))
        assertEquals("—", TimeFormat.relative("not a date", 0L, utc))
    }

    @Test
    fun `seconds ago`() {
        assertEquals("just now", TimeFormat.relative(base, at(base) + 20_000, utc))
    }

    @Test
    fun `minutes and hours ago`() {
        assertEquals("4 min ago", TimeFormat.relative(base, at(base) + 4 * 60_000, utc))
        assertEquals("3 h ago", TimeFormat.relative(base, at(base) + 3 * 3_600_000, utc))
    }

    @Test
    fun `yesterday`() {
        assertEquals("yesterday", TimeFormat.relative(base, at(base) + 24 * 3_600_000 + 60_000, utc))
    }

    @Test
    fun `older than yesterday in the same year is a date`() {
        assertEquals("12 Mar", TimeFormat.relative(base, at("2026-03-20T00:00:00Z"), utc))
    }

    @Test
    fun `a previous year is a full date`() {
        // Read from 2026, a March 2025 timestamp needs the year spelled out.
        assertEquals("12 Mar 2025", TimeFormat.relative("2025-03-12T09:30:00Z", at("2026-01-05T00:00:00Z"), utc))
    }

    @Test
    fun `a timestamp in the future from clock skew reads as a real time`() {
        val out = TimeFormat.relative(base, at(base) - 3_600_000, utc)
        assertTrue("expected a clock time, got $out", out.contains("today at") || out.contains(":"))
    }

    @Test
    fun `durations`() {
        assertEquals("—", TimeFormat.duration(null))
        assertEquals("—", TimeFormat.duration(-5))
        assertEquals("420 ms", TimeFormat.duration(420))
        assertEquals("1.4 s", TimeFormat.duration(1_400))
        assertEquals("2 min 5 s", TimeFormat.duration(125_000))
    }

    @Test
    fun `byte counts`() {
        assertEquals("unknown size", TimeFormat.bytes(null))
        assertEquals("512 B", TimeFormat.bytes(512))
        assertEquals("1.5 KB", TimeFormat.bytes(1536))
        assertEquals("2.0 MB", TimeFormat.bytes(2L * 1024 * 1024))
    }
}
