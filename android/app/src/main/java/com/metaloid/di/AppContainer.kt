package com.metaloid.di

import android.content.Context
import android.os.Build
import com.metaloid.app.BuildConfig
import com.metaloid.core.backend.BackendAddress
import com.metaloid.core.common.MetaLog
import com.metaloid.core.network.ApiClient
import com.metaloid.core.network.HttpClients
import com.metaloid.core.network.HttpEngine
import com.metaloid.core.network.NetworkContext
import com.metaloid.core.network.SessionRefresher
import com.metaloid.core.session.AuthMode
import com.metaloid.core.session.SessionManager
import com.metaloid.core.session.SessionStore
import com.metaloid.core.session.SupabaseAuthApi
import com.metaloid.core.storage.KeystoreSecretBox
import com.metaloid.core.storage.PreferencesStore
import com.metaloid.core.system.ConnectivityMonitor
import com.metaloid.core.storage.SecretFileVault
import com.metaloid.core.streaming.OkHttpStreamTransport
import com.metaloid.core.streaming.StreamTransport
import com.metaloid.data.api.MetaIoidApi
import com.metaloid.data.api.SupabaseAuthClient
import com.metaloid.data.api.SupabaseConfig
import com.metaloid.data.repo.AttachmentsRepository
import com.metaloid.data.repo.ConversationsRepository
import com.metaloid.feature.chat.data.ChatTurnRunner
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl

/**
 * Construction and wiring for the whole app.
 *
 * Hand-rolled instead of an annotation-based DI framework: the object graph is
 * about twenty nodes with no scopes, no generated code and no build step, and
 * the alternative would add a compiler plugin and ~1 MB of runtime to save a
 * file this size. Recorded in docs/android/DECISIONS.md; the layering rule it
 * must not break is that a *feature* never constructs its own dependencies.
 */
class AppContainer(context: Context) {

    private val appContext = context.applicationContext

    val preferences = PreferencesStore(appContext)

    /**
     * The device's own connectivity. One instance for the process: it is a thin
     * wrapper over the system service, and three copies would mean three
     * registrations of the same callback.
     */
    val connectivity = ConnectivityMonitor(appContext)

    /**
     * Where the gateway is. A build-time default may be baked in for a specific
     * deployment; when it is not, the user supplies it on first run.
     *
     * Cleartext is allowed only in a debug build (see
     * `src/debug/res/xml/network_security_config.xml`), and the release variant
     * refuses an `http://` address here rather than failing later with an
     * opaque TLS error.
     */
    val backendAddress = BackendAddress(
        initial = BuildConfig.GATEWAY_URL.takeIf { it.isNotBlank() },
        allowCleartext = BuildConfig.DEBUG,
    )

    private val sessionVault = SecretFileVault(
        file = File(appContext.filesDir, "metaloid.session"),
        box = KeystoreSecretBox(),
    )

    private val sessionStore = SessionStore(sessionVault)

    /** Set immediately after `sessionManager` exists; see [DelegatingRefresher]. */
    private val refresher = DelegatingRefresher()

    val httpClients: HttpClients = HttpEngine.create(
        tokenProvider = { sessionManagerRef?.accessToken() },
        userAgent = "MetaIoid-Android/${BuildConfig.VERSION_NAME} (${BuildConfig.BUILD_TYPE_NAME}; API ${Build.VERSION.SDK_INT})",
        verbose = BuildConfig.DEBUG,
    )

    private val networkContext = NetworkContext(
        baseUrlProvider = { backendAddress.current() },
        tokenProvider = { sessionManagerRef?.accessToken() },
        sessionExpired = { sessionManagerRef?.noteRejectedByServer() },
        online = { connectivity.currentlyOnline() },
    )

    val apiClient = ApiClient(
        clients = httpClients,
        context = networkContext,
        sessionRefresh = refresher,
        io = SystemDispatchersHolder.dispatchers.io,
        verbose = BuildConfig.DEBUG,
    )

    val api = MetaIoidApi(apiClient)

    /**
     * The deployment's identity provider, once known.
     *
     * Resolved from the build's public values first (no fetch), then from
     * `/api/config`, exactly as the web client does — so an APK built with no
     * Supabase values still connects to a Supabase-backed gateway.
     */
    private val _supabaseConfig = MutableStateFlow<SupabaseConfig?>(null)
    val supabaseConfig: StateFlow<SupabaseConfig?> = _supabaseConfig.asStateFlow()

    val supabaseAuth: SupabaseAuthApi = SupabaseAuthClient(apiClient) { _supabaseConfig.value }

    val sessionManager = SessionManager(
        gateway = api,
        supabase = supabaseAuth,
        store = sessionStore,
        deviceName = "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
    ).also { manager ->
        sessionManagerRef = manager
        refresher.target = manager
    }

    private var sessionManagerRef: SessionManager? = null

    val streamTransport: StreamTransport = OkHttpStreamTransport(
        clients = httpClients,
        io = SystemDispatchersHolder.dispatchers.io,
        verbose = BuildConfig.DEBUG,
        online = { connectivity.currentlyOnline() },
    )

    val conversations = ConversationsRepository(
        api = api,
        cacheFile = File(appContext.filesDir, "conversations.cache.json"),
    )

    val attachments = AttachmentsRepository(
        api = api,
        clients = httpClients,
        supabaseProvider = { _supabaseConfig.value },
        // Object storage authenticates as the *user*, so only a Supabase session
        // can write to it. A gateway-local account has no storage token, and the
        // app says so instead of failing with an opaque error.
        uploadTokenProvider = {
            val current = sessionManagerRef?.current()
            current?.takeIf { it.mode == AuthMode.SUPABASE }?.accessToken
        },
        uploadsAvailable = { storageUploadsEnabled() },
        io = SystemDispatchersHolder.dispatchers.io,
    )

    /** Set from the capability check: real storage, on a Supabase session. */
    @Volatile
    private var storageReady: Boolean = false

    fun setStorageReady(ready: Boolean) {
        storageReady = ready
    }

    private fun storageUploadsEnabled(): Boolean {
        val current = sessionManagerRef?.current() ?: return false
        return storageReady && _supabaseConfig.value != null && current.mode == AuthMode.SUPABASE
    }

    /**
     * Whether the attach affordance should be offered at all.
     *
     * False on a deployment with no writable object storage (the gateway reports
     * `storage.ready = false`, and `GET …/url` answers 501 `storage_unavailable`),
     * and false for an account whose session cannot authorise a storage write.
     * The UI hides the button and says why rather than failing on tap.
     */
    fun uploadsEnabled(): Boolean = storageUploadsEnabled()

    /** Files directory, for stores that own their own small JSON file. */
    fun appFilesDir(): File = appContext.filesDir

    /** Session label for diagnostics; redacted by the caller. */
    fun accountLabel(): String? = sessionManagerRef?.current()?.label

    val turnRunner = ChatTurnRunner(
        api = api,
        transport = streamTransport,
        // The *base* address: the runner appends `api/chat`. Passing the full
        // endpoint here would produce `/api/chat/api/chat`.
        chatUrlProvider = { backendAddress.current() },
        tokenProvider = { sessionManagerRef?.accessToken() },
    )

    /**
     * Remembers what the deployment turned out to support, so the sign-in screen
     * offers the identity methods that actually exist on this server.
     */
    fun updateAvailableAuthModes(modes: List<AuthMode>) {
        sessionManager.availableModes = modes
    }

    fun setSupabaseConfig(config: SupabaseConfig?) {
        _supabaseConfig.value = config
        MetaLog.i("container", "supabase identity provider %s", if (config == null) "absent" else "available")
    }

    /** Build-time public values, when they were supplied. */
    fun buildTimeSupabaseConfig(): SupabaseConfig? {
        val url = BuildConfig.SUPABASE_URL.takeIf { it.isNotBlank() } ?: return null
        val key = BuildConfig.SUPABASE_ANON_KEY.takeIf { it.isNotBlank() } ?: return null
        val parsed = runCatching { url.toHttpUrl() }.getOrNull() ?: return null
        return SupabaseConfig(url = parsed, anonKey = key)
    }
}

/**
 * Breaks the one genuine cycle in the graph.
 *
 * `ApiClient` needs a refresher, and the refresher is the `SessionManager`,
 * which needs the `ApiClient` to talk to `/api/auth/refresh`. The target is
 * assigned immediately after construction, before any request can run.
 */
private class DelegatingRefresher : SessionRefresher {
    @Volatile
    var target: SessionManager? = null

    override suspend fun refresh(): String? = target?.refresh()
}

/** One shared dispatcher holder, so no class hard-codes `Dispatchers.IO`. */
object SystemDispatchersHolder {
    val dispatchers = com.metaloid.core.common.SystemDispatchers
}
