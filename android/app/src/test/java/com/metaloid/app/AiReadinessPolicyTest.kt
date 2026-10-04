package com.metaloid.app

import com.metaloid.data.dto.HealthDto
import com.metaloid.data.dto.ProviderCredentialMetadataDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AiReadinessPolicyTest {
    @Test
    fun `a healthy shared provider is real readiness`() {
        val health = HealthDto(ok = true, ai = true, provider = "openrouter")
        assertTrue(AiReadinessPolicy.hasRealSharedProvider(health))
    }

    @Test
    fun `mock or degraded health is not a shared provider`() {
        assertFalse(AiReadinessPolicy.hasRealSharedProvider(HealthDto(ok = true, ai = true, provider = "local-mock")))
        assertFalse(AiReadinessPolicy.hasRealSharedProvider(HealthDto(ok = true, ai = true, degraded = true, provider = "openrouter")))
        assertFalse(AiReadinessPolicy.hasRealSharedProvider(HealthDto(ok = false, ai = true, provider = "openrouter")))
    }

    @Test
    fun `BYOK readiness needs a positive provider test as well as backend readiness`() {
        val health = HealthDto(ok = true, byok = true)
        val unverified = listOf(ProviderCredentialMetadataDto(id = "c1", providerId = "openai", status = "unverified"))
        val verified = listOf(ProviderCredentialMetadataDto(id = "c1", providerId = "openai", status = "valid"))

        assertNull(AiReadinessPolicy.verifiedCredential(health, unverified))
        assertNotNull(AiReadinessPolicy.verifiedCredential(health, verified))
        assertNull(AiReadinessPolicy.verifiedCredential(health.copy(byok = false), verified))
    }

    @Test
    fun `unverified and rejected keys get actionable setup states`() {
        val unverified = ProviderCredentialMetadataDto(id = "c1", providerId = "anthropic", status = "unverified")
        val unverifiedState = AiReadinessPolicy.issue(HealthDto(ok = true), listOf(unverified))
        assertEquals(ProviderSetupIssue.NeedsVerification, unverifiedState.issue)
        assertEquals("c1", unverifiedState.credentialId)

        val invalid = ProviderCredentialMetadataDto(id = "c2", providerId = "openai", status = "invalid")
        assertEquals(
            ProviderSetupIssue.InvalidCredential,
            AiReadinessPolicy.issue(HealthDto(ok = true), listOf(invalid)).issue,
        )
    }

    @Test
    fun `empty credential set asks for setup and backend-reported rejected keys remain visible`() {
        assertEquals(
            ProviderSetupIssue.NotConfigured,
            AiReadinessPolicy.issue(HealthDto(ok = true), emptyList()).issue,
        )
        assertEquals(
            ProviderSetupIssue.InvalidCredential,
            AiReadinessPolicy.issue(HealthDto(ok = true, byokRejected = listOf("gemini")), emptyList()).issue,
        )
    }

    @Test
    fun `provider test statuses distinguish live success from unusable outcomes`() {
        assertTrue(AiReadinessPolicy.verifiedTestStatus("healthy"))
        assertTrue(AiReadinessPolicy.verifiedTestStatus("valid"))
        assertEquals(ProviderSetupIssue.InvalidCredential, AiReadinessPolicy.testIssue("auth_failed"))
        assertEquals(ProviderSetupIssue.ProviderUnavailable, AiReadinessPolicy.testIssue("rate_limited"))
        assertEquals(ProviderSetupIssue.InvalidCredential, AiReadinessPolicy.testIssue("unreadable", "credential_unreadable"))
    }
}
