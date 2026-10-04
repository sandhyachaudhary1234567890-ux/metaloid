package com.metaloid.core.system

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import com.metaloid.core.common.MetaLog
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged

/**
 * "Does the device have a network right now?"
 *
 * This answers only that question. It is deliberately **not** the app's notion of
 * "is MetaIoid reachable": a connected network does not mean the gateway
 * answers, and the app's status is decided from real request outcomes combined
 * with this signal (Section 9.1). Treating this as health is the classic bug
 * where an app shows LIVE on a captive-portal Wi-Fi.
 */
class ConnectivityMonitor(private val context: Context) {

    private val manager: ConnectivityManager? =
        context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager

    /** Emits the current state immediately, then on every change. */
    fun observe(): Flow<Boolean> = callbackFlow {
        val connectivity = manager
        if (connectivity == null) {
            trySend(true) // No manager: do not invent an offline state.
            awaitClose { }
            return@callbackFlow
        }
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                trySend(currentlyOnline(connectivity))
            }

            override fun onLost(network: Network) {
                trySend(currentlyOnline(connectivity))
            }

            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
                trySend(currentlyOnline(connectivity))
            }
        }
        trySend(currentlyOnline(connectivity))
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        runCatching { connectivity.registerNetworkCallback(request, callback) }
            .onFailure { MetaLog.w(TAG, "could not observe connectivity: %s", it.javaClass.simpleName) }
        awaitClose {
            runCatching { connectivity.unregisterNetworkCallback(callback) }
        }
    }.distinctUntilChanged()

    fun currentlyOnline(connectivity: ConnectivityManager = manager ?: return true): Boolean {
        val network = connectivity.activeNetwork ?: return false
        val capabilities = connectivity.getNetworkCapabilities(network) ?: return false
        val hasTransport = capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ||
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) ||
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
        return hasTransport && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private companion object {
        const val TAG = "connectivity"
    }
}
