package com.metaloid.core.common

/**
 * Redaction, applied on the way *into* every log line and every diagnostics
 * export.
 *
 * The rule this file exists to enforce: a session token, a provider API key or
 * a user's email address must never appear in a log, a crash report, a bug
 * report or a screenshot of the diagnostics screen. Redaction happens at the
 * boundary (one place), not at each call site, because a call site that forgets
 * is not a bug that shows up in testing — it is a leak.
 *
 * Everything here is pure and unit-tested (RedactTest).
 */
object Redact {

    private const val MASK = "«redacted»"

    /** `eyJ…`-shaped JWTs: Supabase access tokens, gateway session tokens. */
    private val JWT = Regex("""eyJ[A-Za-z0-9_\-]{6,}\.[A-Za-z0-9_\-]{6,}\.[A-Za-z0-9_\-]{4,}""")

    /** `Authorization: Bearer <anything>`. */
    private val BEARER = Regex("""(?i)\bbearer\s+[A-Za-z0-9._\-]{8,}""")

    /**
     * Provider key shapes. These are the vendors the gateway can hold keys for;
     * a key that reaches a log line is a key that has to be rotated.
     */
    private val PROVIDER_KEYS = Regex(
        """(?i)\b(sk-[A-Za-z0-9\-_]{8,}|nvapi-[A-Za-z0-9\-_]{8,}|AIza[0-9A-Za-z\-_]{10,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b"""
    )

    /** Email addresses — PII, and the identity label of an account. */
    private val EMAIL = Regex("""[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}""")

    /** Long opaque high-entropy strings (a session secret that is not a JWT). */
    private val OPAQUE_SECRET = Regex("""(?i)\b(?:token|secret|passcode|api[_-]?key|refresh)"?\s*[:=]\s*"?([A-Za-z0-9._\-]{16,})"?""")

    /** Anything longer than this in a *single* log argument is truncated. */
    private const val MAX_LENGTH = 600

    fun text(input: String?): String {
        if (input.isNullOrEmpty()) return ""
        var out = input
        out = JWT.replace(out, MASK)
        out = BEARER.replace(out, "Bearer $MASK")
        out = PROVIDER_KEYS.replace(out, MASK)
        // Keep the field name (`token=…`), drop the value.
        out = OPAQUE_SECRET.replace(out) { m -> m.value.substringBefore(m.groupValues[1]) + MASK }
        out = EMAIL.replace(out, MASK)
        return if (out.length > MAX_LENGTH) out.take(MAX_LENGTH) + "…" else out
    }

    /**
     * Header values. Authorization and cookies are dropped wholesale — a header
     * value is never partially useful in a log.
     */
    fun headerValue(name: String, value: String): String = when (name.lowercase()) {
        "authorization", "cookie", "set-cookie", "proxy-authorization", "apikey", "api-key" -> MASK
        else -> text(value)
    }

    /** A URL for logging: the origin and path are kept, the query is not. */
    fun url(raw: String): String {
        val q = raw.indexOf('?')
        val withoutQuery = if (q >= 0) raw.substring(0, q) else raw
        return text(withoutQuery)
    }

    /** Email, handle or whatever the account is labelled with, for diagnostics. */
    fun identity(label: String?): String {
        if (label.isNullOrBlank()) return "unknown"
        val at = label.indexOf('@')
        val name = if (at > 0) label.substring(0, at) else label
        return if (name.length <= 2) "«account»" else "${name.take(2)}«account»"
    }
}
