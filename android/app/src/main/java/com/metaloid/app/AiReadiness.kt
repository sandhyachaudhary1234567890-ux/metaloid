package com.metaloid.app

import com.metaloid.core.common.AppError
import com.metaloid.data.dto.HealthDto
import com.metaloid.data.dto.ProviderCredentialMetadataDto

/** States the shell uses before it allows normal AI requests. */
sealed interface AiAccessState {
    data object Checking : AiAccessState
    data object Ready : AiAccessState
    data object Offline : AiAccessState
    data object NotSignedIn : AiAccessState
    data class NeedsSetup(
        val issue: ProviderSetupIssue,
        val providerId: String? = null,
        val credentialId: String? = null,
        val detail: String? = null,
    ) : AiAccessState
    data class Unavailable(val error: AppError) : AiAccessState
}

enum class ProviderSetupIssue {
    NotConfigured,
    NeedsVerification,
    InvalidCredential,
    ProviderUnavailable,
    ModelUnavailable,
    EncryptionUnavailable,
}

/**
 * A small, testable gate. A readable credential row is not proof that the
 * provider accepted it; only a stored positive adapter test plus the backend's
 * own BYOK readiness report opens the gate.
 */
object AiReadinessPolicy {
    fun hasRealSharedProvider(health: HealthDto): Boolean =
        health.ok && health.ai && !health.degraded && !health.provider.equals("local-mock", ignoreCase = true)

    fun verifiedCredential(
        health: HealthDto,
        credentials: List<ProviderCredentialMetadataDto>,
    ): ProviderCredentialMetadataDto? {
        if (!health.ok || !health.byok) return null
        return credentials.firstOrNull {
            it.isActive && it.status.equals("valid", ignoreCase = true)
        } ?: credentials.firstOrNull {
            it.isActive && it.status.equals("connected", ignoreCase = true)
        }
    }

    fun issue(
        health: HealthDto,
        credentials: List<ProviderCredentialMetadataDto>,
    ): AiAccessState.NeedsSetup {
        val credential = credentials.firstOrNull { it.isActive && it.status.equals("unverified", true) }
        if (credential != null) {
            return AiAccessState.NeedsSetup(
                issue = ProviderSetupIssue.NeedsVerification,
                providerId = credential.providerId,
                credentialId = credential.id,
                detail = "A saved provider key needs a live check.",
            )
        }

        val rejected = credentials.firstOrNull { it.isActive && it.status.equals("invalid", true) }
        if (rejected != null || health.byokRejected.isNotEmpty() || health.byokUnreadable.isNotEmpty()) {
            return AiAccessState.NeedsSetup(
                issue = ProviderSetupIssue.InvalidCredential,
                providerId = rejected?.providerId ?: health.byokRejected.firstOrNull() ?: health.byokUnreadable.firstOrNull(),
                credentialId = rejected?.id,
                detail = if (health.byokUnreadable.isNotEmpty()) {
                    "The server cannot decrypt a saved key. Replace it to reconnect."
                } else {
                    "The provider rejected a saved key. Replace it or test it again."
                },
            )
        }

        val saved = credentials.firstOrNull { it.isActive }
        if (saved != null && !health.byok) {
            return AiAccessState.NeedsSetup(
                issue = ProviderSetupIssue.ProviderUnavailable,
                providerId = saved.providerId,
                credentialId = saved.id,
                detail = health.byokError ?: "The backend has not confirmed a usable provider key.",
            )
        }

        return AiAccessState.NeedsSetup(issue = ProviderSetupIssue.NotConfigured)
    }

    fun verifiedTestStatus(status: String?): Boolean =
        status.equals("healthy", ignoreCase = true) || status.equals("valid", ignoreCase = true) ||
            status.equals("connected", ignoreCase = true)

    fun testIssue(status: String?, code: String? = null): ProviderSetupIssue = when {
        code.equals("credential_unreadable", ignoreCase = true) || status.equals("unreadable", ignoreCase = true) ->
            ProviderSetupIssue.InvalidCredential
        status.equals("auth_failed", ignoreCase = true) || status.equals("invalid", ignoreCase = true) ->
            ProviderSetupIssue.InvalidCredential
        else -> ProviderSetupIssue.ProviderUnavailable
    }
}
