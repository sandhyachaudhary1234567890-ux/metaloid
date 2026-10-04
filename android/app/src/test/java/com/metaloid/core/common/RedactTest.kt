package com.metaloid.core.common

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Redaction is a security control, not a formatting nicety: everything this app
 * logs passes through it, and a failure here is how a token ends up in a bug
 * report.
 */
class RedactTest {

    @Test
    fun `strips a bearer token`() {
        val out = Redact.text("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abcdefghij.klmnopqr")
        assertFalse(out.contains("eyJhbGciOiJIUzI1NiJ9"))
        assertTrue(out.contains("Bearer"))
    }

    @Test
    fun `strips a bare jwt anywhere in a message`() {
        val jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSM"
        val out = Redact.text("request failed with token=$jwt while calling /api/chat")
        assertFalse(out.contains(jwt))
        assertTrue(out.contains("/api/chat"))
    }

    @Test
    fun `strips provider api keys`() {
        val out = Redact.text("openrouter key sk-or-v1-abcdefghijklmnop failed")
        assertFalse(out.contains("sk-or-v1-abcdefghijklmnop"))
        assertTrue(out.contains("failed"))
    }

    @Test
    fun `strips an email address`() {
        val out = Redact.text("signed in as someone@example.com")
        assertFalse(out.contains("someone@example.com"))
    }

    @Test
    fun `header values are replaced wholesale`() {
        assertEquals("«redacted»", Redact.headerValue("authorization", "Bearer xyz"))
        assertEquals("«redacted»", Redact.headerValue("Cookie", "a=b"))
        assertEquals("application/json", Redact.headerValue("Content-Type", "application/json"))
    }

    @Test
    fun `a url keeps its origin and loses its query`() {
        val out = Redact.url("https://metaloid.example.com/api/v1/usage?cursor=abc&token=xyz")
        assertEquals("https://metaloid.example.com/api/v1/usage", out)
    }

    @Test
    fun `a key=value secret is masked but its field name survives`() {
        val out = Redact.text("refresh=abcdefghijklmnopqrstuvwxyz012345")
        assertFalse(out.contains("abcdefghijklmnopqrstuvwxyz012345"))
        assertTrue(out.contains("refresh="))
    }

    @Test
    fun `a very long message is truncated`() {
        val out = Redact.text("x".repeat(2_000))
        assertTrue(out.length <= 601)
        assertTrue(out.endsWith("…"))
    }

    @Test
    fun `identity keeps two leading characters of a handle and nothing of an email`() {
        assertEquals("sa«account»", Redact.identity("sandhya"))
        assertFalse(Redact.identity("someone@example.com").contains("example.com"))
        assertEquals("«account»", Redact.identity("ab"))
        assertEquals("unknown", Redact.identity(null))
    }

    @Test
    fun `null and empty are safe`() {
        assertEquals("", Redact.text(null))
        assertEquals("", Redact.text(""))
    }
}
