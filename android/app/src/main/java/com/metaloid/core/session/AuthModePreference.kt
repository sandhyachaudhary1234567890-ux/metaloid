package com.metaloid.core.session

/**
 * Which sign-in tab to show, given what the deployment actually offers.
 *
 * This exists as a pure function because the ordering rule is the difference
 * between a usable app and a dead end. A Supabase-backed deployment (the
 * production shape: `auth.mode` = `jwks`, data in Postgres) keeps its accounts in
 * the identity provider; its local user file, when it has one at all, lives on a
 * filesystem that a serverless host does not keep. A first-run user shown the
 * handle-and-passcode tab there types a password that cannot work.
 *
 * The list is the preference: `setAvailableModes` receives the modes in the order
 * the deployment supports them, so the head of the list is the default.
 *
 * The one thing this rule must not do is fight the user: once someone has tapped
 * a tab, a late-arriving mode list (the Supabase identifiers are fetched from
 * `/api/config`, which is a network round-trip) must not move them.
 */
object AuthModePreference {

    fun resolve(available: List<AuthMode>, current: AuthMode, userChose: Boolean): AuthMode {
        if (available.isEmpty()) return AuthMode.GATEWAY
        if (userChose && current in available) return current
        return available.first()
    }
}
