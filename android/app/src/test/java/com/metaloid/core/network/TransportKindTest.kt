package com.metaloid.core.network

import java.io.IOException
import java.net.ConnectException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLHandshakeException
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Offline is not the same failure as unreachable, and the difference is made
 * here rather than guessed at in a ViewModel.
 *
 * A device with no network fails a connection the same way whether the user is
 * on a plane or the gateway is down: an [UnknownHostException]. Only the
 * connectivity signal can tell those apart, so the classifier must be able to
 * see it — and must *not* use it to excuse an SSL failure, which means the phone
 * reached something that answered.
 */
class TransportKindTest {

    @Test
    fun `a connection failure with no network is offline`() {
        assertEquals(
            TransportFailureKind.NoNetwork,
            classifyTransportError(UnknownHostException("gateway.example.com"), online = false),
        )
        assertEquals(
            TransportFailureKind.NoNetwork,
            classifyTransportError(ConnectException("no route to host"), online = false),
        )
    }

    @Test
    fun `the same failure with a network is unreachable`() {
        assertEquals(
            TransportFailureKind.Unreachable,
            classifyTransportError(UnknownHostException("gateway.example.com"), online = true),
        )
        assertEquals(
            TransportFailureKind.Unreachable,
            classifyTransportError(ConnectException("connection refused"), online = true),
        )
    }

    @Test
    fun `a timeout stays a timeout even if connectivity flipped mid-call`() {
        assertEquals(
            TransportFailureKind.Timeout,
            classifyTransportError(SocketTimeoutException("read timed out"), online = true),
        )
        assertEquals(
            TransportFailureKind.Timeout,
            classifyTransportError(SocketTimeoutException("read timed out"), online = false),
        )
    }

    @Test
    fun `a tls failure is unreachable, never offline`() {
        // The socket connected; saying "you're offline" here would be false.
        assertEquals(
            TransportFailureKind.Unreachable,
            classifyTransportError(SSLHandshakeException("bad certificate"), online = false),
        )
    }

    @Test
    fun `an offline socket error is offline, and an unknown io error is not`() {
        assertEquals(
            TransportFailureKind.NoNetwork,
            classifyTransportError(SocketException("network is unreachable"), online = false),
        )
        assertEquals(
            TransportFailureKind.Unreachable,
            classifyTransportError(IOException("something else"), online = true),
        )
    }

    @Test
    fun `the default assumes a network, so an old call site cannot claim offline`() {
        assertEquals(TransportFailureKind.Unreachable, classifyTransportError(UnknownHostException("x")))
    }
}
