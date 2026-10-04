package com.metaloid.core.backend

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Every request in the app is built from this value, so its validation is a
 * security boundary rather than a form check: a URL with credentials in it, or
 * a cleartext address in a release build, must not be storable.
 */
class BackendAddressTest {

    private fun release() = BackendAddress(initial = null, allowCleartext = false)
    private fun debug() = BackendAddress(initial = null, allowCleartext = true)

    @Test
    fun `an https origin is accepted and stored`() {
        val address = release()
        val result = address.set("https://metaloid.example.com")
        assertTrue(result is BackendValidation.Ok)
        assertEquals("metaloid.example.com", address.current()?.host)
        assertTrue(address.configured)
    }

    @Test
    fun `a bare host is completed to https`() {
        val address = release()
        assertTrue(address.set("gateway.example.com") is BackendValidation.Ok)
        assertEquals("https", address.current()?.scheme)
    }

    @Test
    fun `a trailing slash is normalised away`() {
        val address = release()
        assertTrue(address.set("https://metaloid.example.com/") is BackendValidation.Ok)
        assertEquals("https://metaloid.example.com/", address.current().toString())
        // OkHttp normalises the origin to a single path segment; joining
        // `api/v1/...` onto it can never produce a double slash.
        val joined = address.current()!!.newBuilder().addPathSegments("api/v1/me").build()
        assertEquals("https://metaloid.example.com/api/v1/me", joined.toString())
    }

    @Test
    fun `cleartext is refused in a release build and allowed in debug`() {
        assertTrue(release().set("http://192.168.1.10:8787") is BackendValidation.Invalid)
        assertTrue(debug().set("http://192.168.1.10:8787") is BackendValidation.Ok)
    }

    @Test
    fun `credentials in the address are refused`() {
        val result = release().set("https://user:secret@metaloid.example.com")
        assertTrue(result is BackendValidation.Invalid)
    }

    @Test
    fun `a query or fragment is refused`() {
        assertTrue(release().set("https://metaloid.example.com/?token=abc") is BackendValidation.Invalid)
        assertTrue(release().set("https://metaloid.example.com/#x") is BackendValidation.Invalid)
    }

    @Test
    fun `nonsense is refused with a message the user can act on`() {
        val result = release().set("not a url")
        assertTrue(result is BackendValidation.Invalid)
        assertTrue((result as BackendValidation.Invalid).message.isNotBlank())
    }

    @Test
    fun `an empty value clears the address rather than storing a broken one`() {
        val address = release()
        assertTrue(address.set("https://metaloid.example.com") is BackendValidation.Ok)
        assertEquals(BackendValidation.Empty, address.set("   "))
        assertNull(address.current())
        assertFalse(address.configured)
    }

    @Test
    fun `a path prefix is preserved for a gateway mounted under one`() {
        val address = release()
        assertTrue(address.set("https://example.com/metaloid") is BackendValidation.Ok)
        val joined = address.current()!!.newBuilder().addPathSegments("api/health").build()
        assertEquals("https://example.com/metaloid/api/health", joined.toString())
    }
}
