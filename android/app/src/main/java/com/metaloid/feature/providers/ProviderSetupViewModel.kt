package com.metaloid.feature.providers

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.metaloid.app.AiReadinessPolicy
import com.metaloid.app.ProviderSetupIssue
import com.metaloid.core.common.AppError
import com.metaloid.core.common.MetaLog
import com.metaloid.core.network.ApiResult
import com.metaloid.data.dto.HealthDto
import com.metaloid.data.dto.ModelListDto
import com.metaloid.data.dto.ProviderCatalogDto
import com.metaloid.data.dto.ProviderCredentialMetadataDto
import com.metaloid.data.dto.ProviderCredentialMetadataListDto
import com.metaloid.data.dto.ProviderHelpDto
import com.metaloid.data.dto.ProviderManifestDto
import com.metaloid.data.dto.ProviderModelDto
import com.metaloid.data.dto.ProviderSettingsDto
import com.metaloid.data.dto.ProviderSettingsEnvelope
import kotlinx.coroutines.flow.asStateFlow
import com.metaloid.di.AppContainer
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

/** Statuses are set only from request progress or a backend response. */
enum class ProviderSetupStatus {
    Loading,
    NotConfigured,
    Saved,
    Connecting,
    Connected,
    InvalidCredential,
    ProviderUnavailable,
    ModelUnavailable,
    EncryptionUnavailable,
    Saving,
    Complete,
}

data class ProviderSetupUiState(
    val providers: List<ProviderManifestDto> = emptyList(),
    val selectedProviderId: String? = null,
    val selectedRouteProviderId: String? = null,
    val selectedModelId: String? = null,
    val settings: ProviderSettingsDto? = null,
    val credentials: List<ProviderCredentialMetadataDto> = emptyList(),
    val sharedProviderReady: Boolean = false,
    val sharedProviderId: String? = null,
    val sharedModels: List<ProviderModelDto> = emptyList(),
    val providerModels: List<ProviderModelDto> = emptyList(),
    val modelCatalogLive: Boolean? = null,
    val help: ProviderHelpDto? = null,
    val loading: Boolean = false,
    val providersLoading: Boolean = false,
    val helpLoading: Boolean = false,
    val modelsLoading: Boolean = false,
    val saving: Boolean = false,
    val testing: Boolean = false,
    val finishing: Boolean = false,
    val status: ProviderSetupStatus = ProviderSetupStatus.Loading,
    val issue: ProviderSetupIssue? = null,
    val message: String? = null,
    val loadError: AppError? = null,
    val setupComplete: Boolean = false,
) {
    val connectedProviderIds: Set<String>
        get() = credentials.asSequence()
            .filter { it.isActive && (it.status.equals("valid", true) || it.status.equals("connected", true)) }
            .map { it.providerId }
            .toSet()

    val canFinish: Boolean
        get() = !finishing && !saving && !testing && (sharedProviderReady || connectedProviderIds.isNotEmpty())
}

private data class ProviderSetupLoadResults(
    val catalog: ApiResult<ProviderCatalogDto>,
    val credentials: ApiResult<ProviderCredentialMetadataListDto>,
    val settings: ApiResult<ProviderSettingsEnvelope>,
    val health: ApiResult<HealthDto>,
    val models: ApiResult<ModelListDto>,
)

/**
 * First-run BYOS and account provider settings. Secrets are never kept in this
 * state object: [connect] forwards the one-shot value to the authenticated
 * server write and does not log, persist, or return it.
 */
class ProviderSetupViewModel(private val container: AppContainer) : ViewModel() {
    companion object {
        private const val TAG = "providers"
        private val SECRET_AUTH_TYPES = setOf("api_key", "bearer_token")
        private val VERIFIED_STATUSES = setOf("valid", "connected")
    }

    private val api get() = container.api
    private var loadJob: Job? = null
    private var providerJob: Job? = null
    private var loadGeneration = 0L

    private val mutableState = kotlinx.coroutines.flow.MutableStateFlow(ProviderSetupUiState())
    val state = mutableState.asStateFlow()

    fun load(force: Boolean = false) {
        if (loadJob?.isActive == true) return
        if (!force && mutableState.value.providers.isNotEmpty()) return
        val generation = ++loadGeneration
        loadJob = viewModelScope.launch {
            mutableState.value = mutableState.value.copy(loading = true, providersLoading = true, loadError = null)
            val initial = coroutineScope {
                val catalogJob = async { api.providerCatalog() }
                val credentialsJob = async { api.providerCredentialMetadata() }
                val settingsJob = async { api.providerSettings() }
                val healthJob = async { api.health() }
                val modelsJob = async { api.listModels() }
                ProviderSetupLoadResults(
                    catalog = catalogJob.await(),
                    credentials = credentialsJob.await(),
                    settings = settingsJob.await(),
                    health = healthJob.await(),
                    models = modelsJob.await(),
                )
            }

            val catalogResult = initial.catalog as? ApiResult.Ok ?: run {
                val error = (initial.catalog as? ApiResult.Err)?.error ?: AppError.Unknown("provider catalogue missing")
                publishIfCurrent(generation) {
                    it.copy(loading = false, providersLoading = false, loadError = error, message = error.userMessage)
                }
                return@launch
            }
            val credentialsResult = initial.credentials as? ApiResult.Ok ?: run {
                val error = (initial.credentials as? ApiResult.Err)?.error ?: AppError.Unknown("credential metadata missing")
                publishIfCurrent(generation) {
                    it.copy(loading = false, providersLoading = false, loadError = error, message = error.userMessage)
                }
                return@launch
            }
            val settings = (initial.settings as? ApiResult.Ok)?.value?.settings
            val health = (initial.health as? ApiResult.Ok)?.value
            val sharedModels = (initial.models as? ApiResult.Ok)?.value
            val sharedReady = health?.let(AiReadinessPolicy::hasRealSharedProvider) == true
            val providers = catalogResult.value.providers.filter { provider ->
                provider.adapter && provider.authType?.lowercase()?.let { it in SECRET_AUTH_TYPES } == true
            }
            val credentials = credentialsResult.value.credentials
            val preferredProvider = mutableState.value.selectedProviderId
                ?.takeIf { selected -> providers.any { it.providerId == selected } }
                ?: settings?.defaultProvider?.takeIf { selected -> providers.any { it.providerId == selected } }
                ?: credentials.firstOrNull { it.isActive }?.providerId?.takeIf { selected -> providers.any { it.providerId == selected } }
                ?: providers.firstOrNull()?.providerId
            val sharedProviderId = sharedModels?.provider?.takeIf { sharedReady && !sharedModels.mock }
            val sharedChoices = if (sharedReady && !sharedModels?.mock.orFalse()) {
                sharedModels?.models.orEmpty().map { model ->
                    ProviderModelDto(
                        modelId = model.id,
                        displayName = model.name,
                        free = model.free,
                        unavailable = model.unavailable,
                        availability = if (model.unavailable) "unavailable" else "available",
                        contextLimit = model.context,
                    )
                }
            } else {
                emptyList()
            }
            val savedRouteModel = settings?.defaultModel?.takeIf { it.isNotBlank() }
            val initialStatus = statusFor(preferredProvider, credentials, sharedReady)
            publishIfCurrent(generation) {
                it.copy(
                    providers = providers,
                    selectedProviderId = preferredProvider,
                    selectedRouteProviderId = settings?.defaultProvider,
                    selectedModelId = savedRouteModel,
                    settings = settings,
                    credentials = credentials,
                    sharedProviderReady = sharedReady,
                    sharedProviderId = sharedProviderId,
                    sharedModels = sharedChoices,
                    loading = false,
                    providersLoading = false,
                    status = initialStatus.first,
                    issue = initialStatus.second,
                    message = when {
                        initial.settings is ApiResult.Err -> initial.settings.error.userMessage
                        initial.health is ApiResult.Err -> initial.health.error.userMessage
                        sharedReady -> "MetaIoid reports a live shared AI provider. Smart Connect is ready."
                        credentials.isEmpty() -> "No provider key is connected yet. Choose a backend-supported provider to continue."
                        else -> null
                    },
                    loadError = null,
                )
            }
            preferredProvider?.let { providerId ->
                selectProvider(
                    providerId,
                    loadModels = credentials.any { row -> row.providerId == providerId && row.status.lowercase() in VERIFIED_STATUSES },
                )
            }
        }
    }

    fun selectProvider(providerId: String, loadModels: Boolean = true) {
        val provider = mutableState.value.providers.firstOrNull { it.providerId == providerId } ?: return
        providerJob?.cancel()
        mutableState.value = mutableState.value.copy(
            selectedProviderId = providerId,
            help = null,
            providerModels = emptyList(),
            modelCatalogLive = null,
            helpLoading = true,
            modelsLoading = false,
            message = null,
        )
        providerJob = viewModelScope.launch {
            val helpResult = api.providerHelp(providerId)
            if (mutableState.value.selectedProviderId == providerId) {
                mutableState.value = mutableState.value.copy(
                    help = (helpResult as? ApiResult.Ok)?.value,
                    helpLoading = false,
                )
            }
            val saved = mutableState.value.credentials.firstOrNull { it.providerId == providerId && it.isActive }
            if (loadModels && saved != null && saved.status in VERIFIED_STATUSES) {
                loadProviderModels(providerId, refresh = false)
            }
            if (provider.authType?.lowercase()?.let { it in SECRET_AUTH_TYPES } != true) {
                mutableState.value = mutableState.value.copy(
                    status = ProviderSetupStatus.ProviderUnavailable,
                    issue = ProviderSetupIssue.ProviderUnavailable,
                    message = "This provider's authentication flow is not supported by the mobile key form.",
                )
            } else {
                updateSelectedProviderStatus(providerId)
            }
        }
    }

    /** Saves through the V1 encrypted account contract, then tests via the provider adapter. */
    fun connect(providerId: String, oneShotKey: String) {
        val cleanProviderId = providerId.takeIf { id -> mutableState.value.providers.any { it.providerId == id } } ?: return
        if (oneShotKey.isBlank() || mutableState.value.saving || mutableState.value.testing) return
        mutableState.value = mutableState.value.copy(
            saving = true,
            testing = false,
            status = ProviderSetupStatus.Saving,
            issue = null,
            message = "Saving the key to your MetaIoid server…",
            setupComplete = false,
        )
        viewModelScope.launch {
            when (val saved = api.putCredential(cleanProviderId, oneShotKey)) {
                is ApiResult.Err -> {
                    val issue = when (saved.error) {
                        is AppError.EncryptionUnconfigured -> ProviderSetupIssue.EncryptionUnavailable
                        else -> ProviderSetupIssue.ProviderUnavailable
                    }
                    MetaLog.w(TAG, "provider credential save failed: %s", saved.error.javaClass.simpleName)
                    mutableState.value = mutableState.value.copy(
                        saving = false,
                        status = if (issue == ProviderSetupIssue.EncryptionUnavailable) ProviderSetupStatus.EncryptionUnavailable else ProviderSetupStatus.ProviderUnavailable,
                        issue = issue,
                        message = saved.error.userMessage,
                    )
                    return@launch
                }
                is ApiResult.Ok -> Unit
            }
            mutableState.value = mutableState.value.copy(
                saving = false,
                testing = true,
                status = ProviderSetupStatus.Saved,
                message = "Key saved securely. Checking it with the provider…",
            )
            testStoredCredential(cleanProviderId)
        }
    }

    fun testSavedCredential(providerId: String) {
        if (mutableState.value.testing || mutableState.value.saving) return
        if (mutableState.value.credentials.none { it.providerId == providerId && it.isActive }) return
        mutableState.value = mutableState.value.copy(
            testing = true,
            status = ProviderSetupStatus.Connecting,
            issue = null,
            message = "Checking the saved key with the provider…",
        )
        viewModelScope.launch { testStoredCredential(providerId) }
    }

    private suspend fun testStoredCredential(providerId: String) {
        val credentialList = when (val result = api.providerCredentialMetadata()) {
            is ApiResult.Ok -> result.value.credentials
            is ApiResult.Err -> {
                mutableState.value = mutableState.value.copy(
                    testing = false,
                    status = ProviderSetupStatus.ProviderUnavailable,
                    issue = ProviderSetupIssue.ProviderUnavailable,
                    message = result.error.userMessage,
                )
                return
            }
        }
        val credential = credentialList.firstOrNull { it.providerId == providerId && it.isActive }
        if (credential == null) {
            mutableState.value = mutableState.value.copy(
                credentials = credentialList,
                testing = false,
                status = ProviderSetupStatus.NotConfigured,
                issue = ProviderSetupIssue.NotConfigured,
                message = "The server did not return a saved credential row. Try saving the key again.",
            )
            return
        }
        when (val test = api.testProviderCredential(credential.id)) {
            is ApiResult.Err -> {
                val issue = if (test.error is AppError.ProviderCredentialUnreadable) {
                    ProviderSetupIssue.InvalidCredential
                } else {
                    ProviderSetupIssue.ProviderUnavailable
                }
                mutableState.value = mutableState.value.copy(
                    credentials = credentialList,
                    testing = false,
                    status = if (issue == ProviderSetupIssue.InvalidCredential) ProviderSetupStatus.InvalidCredential else ProviderSetupStatus.ProviderUnavailable,
                    issue = issue,
                    message = test.error.userMessage,
                )
            }
            is ApiResult.Ok -> {
                if (!test.value.ok || !AiReadinessPolicy.verifiedTestStatus(test.value.status)) {
                    val issue = AiReadinessPolicy.testIssue(test.value.status, test.value.code)
                    mutableState.value = mutableState.value.copy(
                        credentials = credentialList,
                        testing = false,
                        status = if (issue == ProviderSetupIssue.InvalidCredential) ProviderSetupStatus.InvalidCredential else ProviderSetupStatus.ProviderUnavailable,
                        issue = issue,
                        message = providerTestMessage(test.value.status, test.value.detail),
                    )
                    return
                }
                val updatedRows = when (val result = api.providerCredentialMetadata()) {
                    is ApiResult.Ok -> result.value.credentials
                    is ApiResult.Err -> credentialList.map { row ->
                        if (row.id == credential.id) row.copy(status = "valid") else row
                    }
                }
                mutableState.value = mutableState.value.copy(
                    credentials = updatedRows,
                    selectedProviderId = providerId,
                    selectedRouteProviderId = null,
                    selectedModelId = null,
                    testing = false,
                    status = ProviderSetupStatus.Connected,
                    issue = null,
                    message = "Connected. The key was accepted by ${mutableState.value.providers.firstOrNull { it.providerId == providerId }?.name ?: "the provider"}.",
                    setupComplete = false,
                )
                loadProviderModels(providerId, refresh = true)
            }
        }
    }

    private suspend fun loadProviderModels(providerId: String, refresh: Boolean) {
        if (mutableState.value.selectedProviderId != providerId) return
        mutableState.value = mutableState.value.copy(modelsLoading = true, providerModels = emptyList())
        var live: Boolean? = null
        if (refresh) {
            when (val refreshed = api.refreshProviderModels(providerId)) {
                is ApiResult.Ok -> live = refreshed.value.live
                is ApiResult.Err -> MetaLog.i(TAG, "live model refresh unavailable for %s: %s", providerId, refreshed.error.javaClass.simpleName)
            }
        }
        when (val result = api.providerModels(providerId)) {
            is ApiResult.Ok -> {
                val usable = result.value.models.filter { it.modelId.isNotBlank() }
                mutableState.value = mutableState.value.copy(
                    providerModels = usable,
                    modelsLoading = false,
                    modelCatalogLive = live,
                    status = if (usable.isEmpty()) ProviderSetupStatus.ModelUnavailable else ProviderSetupStatus.Connected,
                    issue = if (usable.isEmpty()) ProviderSetupIssue.ModelUnavailable else null,
                    message = if (usable.isEmpty()) {
                        "The provider key was accepted, but its backend model catalogue is empty. Smart Connect remains available."
                    } else if (live == false) {
                        "Provider verified. These models are from the backend registry; live model discovery was not available."
                    } else {
                        mutableState.value.message
                    },
                )
            }
            is ApiResult.Err -> {
                mutableState.value = mutableState.value.copy(
                    modelsLoading = false,
                    modelCatalogLive = live,
                    status = ProviderSetupStatus.ModelUnavailable,
                    issue = ProviderSetupIssue.ModelUnavailable,
                    message = result.error.userMessage,
                )
            }
        }
    }

    fun selectSmartConnect() {
        mutableState.value = mutableState.value.copy(
            selectedRouteProviderId = null,
            selectedModelId = null,
            issue = null,
            status = if (mutableState.value.sharedProviderReady || mutableState.value.connectedProviderIds.isNotEmpty()) {
                ProviderSetupStatus.Connected
            } else {
                ProviderSetupStatus.NotConfigured
            },
            message = null,
        )
    }

    fun selectModel(providerId: String, model: ProviderModelDto) {
        if (model.unavailable == true || model.modelId.isBlank()) {
            mutableState.value = mutableState.value.copy(
                status = ProviderSetupStatus.ModelUnavailable,
                issue = ProviderSetupIssue.ModelUnavailable,
                message = "The backend currently marks this model unavailable.",
            )
            return
        }
        val canUseProvider = providerId == mutableState.value.sharedProviderId || providerId in mutableState.value.connectedProviderIds
        if (!canUseProvider) return
        mutableState.value = mutableState.value.copy(
            selectedRouteProviderId = providerId,
            selectedModelId = model.modelId,
            issue = null,
            status = ProviderSetupStatus.Connected,
            message = null,
        )
    }

    fun removeCredential(credentialId: String) {
        if (mutableState.value.saving || mutableState.value.testing || mutableState.value.finishing) return
        viewModelScope.launch {
            when (val result = api.removeProviderCredential(credentialId)) {
                is ApiResult.Ok -> load(force = true)
                is ApiResult.Err -> mutableState.value = mutableState.value.copy(
                    issue = ProviderSetupIssue.ProviderUnavailable,
                    status = ProviderSetupStatus.ProviderUnavailable,
                    message = result.error.userMessage,
                )
            }
        }
    }

    fun finishSetup(onComplete: () -> Unit) {
        val current = mutableState.value
        if (!current.canFinish || current.setupComplete) return
        val modelId = current.selectedModelId
        if (modelId != null) {
            val row = current.providerModels.firstOrNull { it.modelId == modelId }
                ?: current.sharedModels.firstOrNull { it.modelId == modelId }
            if (row == null || row.unavailable == true) {
                mutableState.value = current.copy(
                    status = ProviderSetupStatus.ModelUnavailable,
                    issue = ProviderSetupIssue.ModelUnavailable,
                    message = "The selected model is no longer in the backend catalogue. Choose Smart Connect or reload models.",
                )
                return
            }
        }
        mutableState.value = current.copy(
            finishing = true,
            status = ProviderSetupStatus.Saving,
            issue = null,
            message = "Saving your routing choice and verifying it with the backend…",
        )
        viewModelScope.launch {
            val providerId = if (modelId == null) null else current.selectedRouteProviderId
            when (val update = api.setProviderRoute(providerId, modelId)) {
                is ApiResult.Err -> {
                    mutableState.value = mutableState.value.copy(
                        finishing = false,
                        status = ProviderSetupStatus.ProviderUnavailable,
                        issue = ProviderSetupIssue.ProviderUnavailable,
                        message = update.error.userMessage,
                    )
                    return@launch
                }
                is ApiResult.Ok -> {
                    val persisted = update.value.settings
                    if (persisted == null || persisted.defaultProvider != providerId || persisted.defaultModel != modelId) {
                        mutableState.value = mutableState.value.copy(
                            finishing = false,
                            status = ProviderSetupStatus.ProviderUnavailable,
                            issue = ProviderSetupIssue.ProviderUnavailable,
                            message = "The backend did not confirm the saved routing choice. Retry setup.",
                        )
                        return@launch
                    }
                }
            }
            val health = when (val result = api.health()) {
                is ApiResult.Ok -> result.value
                is ApiResult.Err -> {
                    mutableState.value = mutableState.value.copy(
                        finishing = false,
                        status = ProviderSetupStatus.ProviderUnavailable,
                        issue = ProviderSetupIssue.ProviderUnavailable,
                        message = result.error.userMessage,
                    )
                    return@launch
                }
            }
            val credentials = when (val result = api.providerCredentialMetadata()) {
                is ApiResult.Ok -> result.value.credentials
                is ApiResult.Err -> {
                    mutableState.value = mutableState.value.copy(
                        finishing = false,
                        status = ProviderSetupStatus.ProviderUnavailable,
                        issue = ProviderSetupIssue.ProviderUnavailable,
                        message = result.error.userMessage,
                    )
                    return@launch
                }
            }
            val ready = AiReadinessPolicy.hasRealSharedProvider(health) ||
                AiReadinessPolicy.verifiedCredential(health, credentials) != null
            if (!ready) {
                mutableState.value = mutableState.value.copy(
                    credentials = credentials,
                    finishing = false,
                    status = ProviderSetupStatus.ProviderUnavailable,
                    issue = ProviderSetupIssue.ProviderUnavailable,
                    message = "The backend saved the route but did not confirm a healthy AI provider. Test the provider again.",
                )
                return@launch
            }
            mutableState.value = mutableState.value.copy(
                settings = updateSettings(providerId, modelId, current.settings),
                credentials = credentials,
                finishing = false,
                status = ProviderSetupStatus.Complete,
                issue = null,
                message = "Connected and verified. Smart Connect is ready.",
                setupComplete = true,
            )
            onComplete()
        }
    }

    private fun updateSettings(providerId: String?, modelId: String?, previous: ProviderSettingsDto?) =
        (previous ?: ProviderSettingsDto()).copy(defaultProvider = providerId, defaultModel = modelId)

    private fun updateSelectedProviderStatus(providerId: String) {
        val (status, issue) = statusFor(providerId, mutableState.value.credentials, mutableState.value.sharedProviderReady)
        mutableState.value = mutableState.value.copy(status = status, issue = issue)
    }

    private fun statusFor(
        providerId: String?,
        credentials: List<ProviderCredentialMetadataDto>,
        sharedReady: Boolean,
    ): Pair<ProviderSetupStatus, ProviderSetupIssue?> {
        if (providerId == null) return if (sharedReady) ProviderSetupStatus.Connected to null else ProviderSetupStatus.NotConfigured to ProviderSetupIssue.NotConfigured
        val credential = credentials.firstOrNull { it.providerId == providerId && it.isActive }
        return when (credential?.status?.lowercase()) {
            "valid", "connected" -> ProviderSetupStatus.Connected to null
            "invalid" -> ProviderSetupStatus.InvalidCredential to ProviderSetupIssue.InvalidCredential
            "unverified" -> ProviderSetupStatus.Saved to ProviderSetupIssue.NeedsVerification
            else -> ProviderSetupStatus.NotConfigured to ProviderSetupIssue.NotConfigured
        }
    }

    private fun providerTestMessage(status: String?, detail: String?): String = when (status?.lowercase()) {
        "auth_failed", "invalid" -> "The provider rejected this key. Check it and replace it if needed."
        "rate_limited" -> "The provider is rate-limited right now. Retry the check later; the key is not marked connected."
        "unavailable" -> "The provider could not be reached from the MetaIoid server. Retry the check."
        "unreadable" -> "The server cannot decrypt this saved key. Replace it to reconnect."
        else -> detail?.take(180) ?: "Provider verification did not succeed. Try again."
    }

    private fun publishIfCurrent(generation: Long, transform: (ProviderSetupUiState) -> ProviderSetupUiState) {
        if (generation == loadGeneration) mutableState.value = transform(mutableState.value)
    }

    private fun Boolean?.orFalse(): Boolean = this == true

}
