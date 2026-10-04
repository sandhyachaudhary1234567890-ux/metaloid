package com.metaloid.core.session

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The sign-in default decides whether a new user can sign in at all, so it is a
 * rule with tests rather than a line of UI code.
 */
class AuthModePreferenceTest {

    @Test
    fun `the deployment's first supported mode is the default`() {
        assertEquals(
            AuthMode.SUPABASE,
            AuthModePreference.resolve(listOf(AuthMode.SUPABASE, AuthMode.GATEWAY), AuthMode.GATEWAY, userChose = false),
        )
        // A self-hosted server with no identity provider: local accounts only.
        assertEquals(
            AuthMode.GATEWAY,
            AuthModePreference.resolve(listOf(AuthMode.GATEWAY), AuthMode.GATEWAY, userChose = false),
        )
    }

    @Test
    fun `a late mode list does not move a user who already chose`() {
        assertEquals(
            AuthMode.GATEWAY,
            AuthModePreference.resolve(listOf(AuthMode.SUPABASE, AuthMode.GATEWAY), AuthMode.GATEWAY, userChose = true),
        )
    }

    @Test
    fun `a user's chosen tab is followed when the list changes under it`() {
        // The Supabase tab can only be offered once `/api/config` has answered;
        // if the user picked the gateway tab before that, they keep it.
        assertEquals(
            AuthMode.SUPABASE,
            AuthModePreference.resolve(listOf(AuthMode.SUPABASE, AuthMode.GATEWAY), AuthMode.SUPABASE, userChose = true),
        )
        // But if the chosen mode disappears (config said there is no provider),
        // the app must offer something that exists rather than nothing.
        assertEquals(
            AuthMode.GATEWAY,
            AuthModePreference.resolve(listOf(AuthMode.GATEWAY), AuthMode.SUPABASE, userChose = true),
        )
    }

    @Test
    fun `an empty list still resolves to something`() {
        assertEquals(AuthMode.GATEWAY, AuthModePreference.resolve(emptyList(), AuthMode.SUPABASE, userChose = true))
    }
}
