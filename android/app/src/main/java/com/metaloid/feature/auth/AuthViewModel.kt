package com.metaloid.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.metaloid.core.common.AppError
import com.metaloid.core.common.MetaLog
import com.metaloid.core.session.AuthMode
import com.metaloid.core.session.AuthModePreference
import com.metaloid.core.session.SignUpResult
import com.metaloid.di.AppContainer
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Sign-in state and the two real identity paths.
 *
 * There is no fake account, no "continue as guest" and no demo session: the
 * gateway has no anonymous mode for a real client (its loopback demo owner is
 * reachable only from the server's own loopback, and Section 6 forbids inventing
 * one). A user either signs in to the deployment they pointed the app at, or
 * they see the reason they cannot.
 *
 * Which of the two tabs is offered comes from the deployment itself: the
 * Supabase tab appears only when the app has a project URL and anon key (build
 * values or `/api/config`), and the gateway tab always exists because every
 * MetaIoid server has local accounts.
 */
class AuthViewModel(private val container: AppContainer) : ViewModel() {

    companion object {
        private const val TAG = "auth"
        private const val MIN_PASSCODE = 8
    }

    data class UiState(
        val mode: AuthMode = AuthMode.GATEWAY,
        val available: List<AuthMode> = listOf(AuthMode.GATEWAY),
        val email: String = "",
        val handle: String = "",
        val displayName: String = "",
        val passcode: String = "",
        val busy: Boolean = false,
        val error: AppError? = null,
        val notice: String? = null,
        /** True once the user tapped a tab, so a late mode list cannot move them. */
        val userChoseMode: Boolean = false,
    ) {
        val isSignUp: Boolean get() = false
        val canSubmit: Boolean
            get() = !busy && passcode.length >= MIN_PASSCODE && when (mode) {
                AuthMode.SUPABASE -> email.contains('@') && email.length >= 5
                AuthMode.GATEWAY -> handle.length >= 3
            }
    }

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    /**
     * Takes the deployment's list of usable identity modes.
     *
     * Called with what `/api/health` and `/api/config` actually reported, never
     * with a guess: offering the Supabase tab on a server with no Supabase
     * project would produce a sign-in that cannot possibly succeed.
     */
    fun setAvailableModes(modes: List<AuthMode>) {
        val effective = modes.ifEmpty { listOf(AuthMode.GATEWAY) }
        val current = _state.value
        _state.value = current.copy(
            available = effective,
            // The head of the list is the deployment's own preference (Supabase
            // where an identity provider exists, local accounts otherwise), and
            // `AuthModePreference` is what keeps a late-arriving list from
            // moving a user who has already tapped a tab.
            mode = AuthModePreference.resolve(effective, current.mode, current.userChoseMode),
        )
    }

    fun selectMode(mode: AuthMode) {
        _state.value = _state.value.copy(mode = mode, userChoseMode = true, error = null, notice = null)
    }

    fun onEmail(value: String) {
        _state.value = _state.value.copy(email = value.trim(), error = null)
    }

    fun onHandle(value: String) {
        _state.value = _state.value.copy(handle = value.trim(), error = null)
    }

    fun onDisplayName(value: String) {
        _state.value = _state.value.copy(displayName = value, error = null)
    }

    fun onPasscode(value: String) {
        _state.value = _state.value.copy(passcode = value, error = null)
    }

    fun signIn() {
        val state = _state.value
        if (state.busy) return
        if (state.passcode.length < MIN_PASSCODE) {
            _state.value = state.copy(error = AppError.WeakCredentials("passcodes are at least 8 characters"))
            return
        }
        _state.value = state.copy(busy = true, error = null, notice = null)
        viewModelScope.launch {
            val error = when (state.mode) {
                AuthMode.GATEWAY -> container.sessionManager.signInGateway(state.handle, state.passcode)
                AuthMode.SUPABASE -> container.sessionManager.signInSupabase(state.email, state.passcode)
            }
            _state.value = if (error == null) {
                _state.value.copy(busy = false, passcode = "")
            } else {
                MetaLog.w(TAG, "sign-in refused: %s", error.javaClass.simpleName)
                _state.value.copy(busy = false, error = error)
            }
        }
    }

    /**
     * Creates an account.
     *
     * The gateway's first account on a fresh deployment becomes the admin —
     * that is the server's rule, and this app simply reports the outcome.
     */
    fun signUp() {
        val state = _state.value
        if (state.busy) return
        if (state.passcode.length < MIN_PASSCODE) {
            _state.value = state.copy(error = AppError.WeakCredentials("passcodes are at least 8 characters"))
            return
        }
        _state.value = state.copy(busy = true, error = null, notice = null)
        viewModelScope.launch {
            val outcome = when (state.mode) {
                AuthMode.GATEWAY -> container.sessionManager.signUpGateway(
                    handle = state.handle,
                    displayName = state.displayName.ifBlank { state.handle },
                    passcode = state.passcode,
                )
                AuthMode.SUPABASE -> container.sessionManager.signUpSupabase(state.email, state.passcode)
            }
            _state.value = when (outcome) {
                is SignUpResult.SignedIn -> _state.value.copy(busy = false, passcode = "")
                is SignUpResult.EmailConfirmationRequired -> _state.value.copy(
                    busy = false,
                    passcode = "",
                    notice = "Check ${state.email} to confirm the address, then sign in.",
                )
                is SignUpResult.Failed -> {
                    MetaLog.w(TAG, "sign-up refused: %s", outcome.error.javaClass.simpleName)
                    _state.value.copy(busy = false, error = outcome.error)
                }
            }
        }
    }

    fun dismissError() {
        _state.value = _state.value.copy(error = null)
    }
}
