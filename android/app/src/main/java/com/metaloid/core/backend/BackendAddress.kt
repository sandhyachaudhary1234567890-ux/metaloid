package com.metaloid.core.backend

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Where the user's MetaIoid gateway lives.
 *
 * A MetaIoid deployment is a URL a person owns: a Vercel project, a Render
 * service, a machine on their desk. The app therefore *asks* for it (first run)
 * rather than guessing, and remembers it. A build-time default can be baked in
 * for a specific deployment; when it is, the user never sees this screen.
 *
 * The value is validated and normalised here, once, because every request in
 * the app is built from it:
 *   * only http/https, and only a bare origin (no userinfo, no query, no
 *     fragment) — a URL with credentials embedded in it must never be stored;
 *   * trailing slashes are removed, so path joining cannot double a separator;
 *   * the debug variant allows plain HTTP for a laptop/emulator; the release
 *     variant's network security config refuses cleartext traffic outright, so
 *     an http URL is rejected in a release build rather than failing later with
 *     an opaque TLS error.
 */
class BackendAddress(initial: String? = null, private val allowCleartext: Boolean) {

    private val _url: MutableStateFlow<HttpUrl?> = MutableStateFlow(null)

    init {
        val seeded = initial?.trim().orEmpty()
        if (seeded.isNotEmpty()) {
            when (val parsed = parse(seeded)) {
                is ParseResult.Success -> _url.value = parsed.value
                is ParseResult.Failure -> Unit
            }
        }
    }

    val url: StateFlow<HttpUrl?> = _url.asStateFlow()

    fun current(): HttpUrl? = _url.value

    /** True once a gateway is configured — the app is not usable before that. */
    val configured: Boolean get() = _url.value != null

    fun set(raw: String): BackendValidation {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) {
            _url.value = null
            return BackendValidation.Empty
        }
        return when (val parsed = parse(trimmed)) {
            is ParseResult.Success -> {
                _url.value = parsed.value
                BackendValidation.Ok(parsed.value)
            }
            is ParseResult.Failure -> BackendValidation.Invalid(parsed.message)
        }
    }

    private sealed interface ParseResult {
        data class Success(val value: HttpUrl) : ParseResult
        data class Failure(val message: String) : ParseResult
    }

    private fun parse(raw: String): ParseResult {
        val withScheme = if (raw.startsWith("http://") || raw.startsWith("https://")) raw else "https://$raw"
        val url = withScheme.trimEnd('/').toHttpUrlOrNull()
            ?: return ParseResult.Failure("That doesn't look like a web address.")
        if (!url.isHttps && !allowCleartext) {
            return ParseResult.Failure("MetaIoid needs an https:// address.")
        }
        if (url.username.isNotEmpty() || url.password.isNotEmpty()) {
            return ParseResult.Failure("Remove the username and password from the address.")
        }
        if (url.query != null || url.fragment != null) {
            return ParseResult.Failure("Use just the address — no query or fragment.")
        }
        // A path is allowed (a gateway can be mounted under one, e.g.
        // https://host/metaloid); only the leading slash is normalised away.
        return ParseResult.Success(url)
    }
}

sealed interface BackendValidation {
    data class Ok(val url: HttpUrl) : BackendValidation
    data class Invalid(val message: String) : BackendValidation
    data object Empty : BackendValidation
}
