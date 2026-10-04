package com.metaloid.feature.auth

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.metaloid.R
import com.metaloid.app.AppViewModel
import com.metaloid.core.designsystem.BannerTone
import com.metaloid.core.designsystem.MetaBanner
import com.metaloid.core.designsystem.MetaButton
import com.metaloid.core.designsystem.MetaButtonVariant
import com.metaloid.core.designsystem.MetaDivider
import com.metaloid.core.designsystem.MetaIoidTheme
import com.metaloid.core.designsystem.MetaLabel
import com.metaloid.core.designsystem.MetaType
import com.metaloid.core.designsystem.Radii
import com.metaloid.core.designsystem.Space
import com.metaloid.core.designsystem.Stroke
import com.metaloid.core.designsystem.SystemStatus
import com.metaloid.core.session.AuthMode
import com.metaloid.di.AppContainer
import androidx.compose.foundation.border

/**
 * The way in.
 *
 * Design notes that are decisions, not decoration:
 *   * the deployment address is shown on this screen, because "which server am I
 *     signing in to" is the first thing a self-hosted user needs to see;
 *   * the identity tab is chosen from what the server supports, not from a
 *     hard-coded preference;
 *   * the status line is the real `/api/health` result — if the gateway is down,
 *     the screen says so *before* the user types a password.
 */
@Composable
fun SignInScreen(container: AppContainer, appViewModel: AppViewModel) {
    val factory = remember(container) {
        viewModelFactory { initializer { AuthViewModel(container) } }
    }
    val authViewModel: AuthViewModel = viewModel(factory = factory)
    val state by authViewModel.state.collectAsStateWithLifecycle()
    val system by appViewModel.system.collectAsStateWithLifecycle()
    val colors = MetaIoidTheme.colors

    // The tab list follows the deployment: this reads the container's resolved
    // Supabase configuration, which was filled from build values or /api/config.
    DisposableEffect(container) {
        val modes = buildList {
            if (container.supabaseConfig.value != null) add(AuthMode.SUPABASE)
            add(AuthMode.GATEWAY)
        }
        authViewModel.setAvailableModes(modes)
        onDispose { }
    }

    var signingUp by remember { mutableStateOf(false) }
    var showGatewayEditor by remember { mutableStateOf(false) }

    if (showGatewayEditor) {
        GatewayEditorDialog(
            initial = container.backendAddress.current()?.toString().orEmpty(),
            onDismiss = { showGatewayEditor = false },
            onSubmit = { raw ->
                when (val validation = appViewModel.setGatewayUrl(raw)) {
                    is com.metaloid.core.backend.BackendValidation.Ok -> null
                    is com.metaloid.core.backend.BackendValidation.Invalid -> validation.message
                }
            },
        )
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.bg)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = Space.xxl)
            .padding(top = Space.massive, bottom = Space.xxl),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Image(
            painter = painterResource(R.drawable.metaloid_mark),
            contentDescription = null,
            modifier = Modifier.size(48.dp),
        )
        Spacer(Modifier.height(Space.lg))
        Text("MetaIoid", style = MetaType.display, color = colors.fg)
        Spacer(Modifier.height(Space.xs))
        Text(
            text = when {
                signingUp -> "Create an account on this deployment"
                else -> "Sign in to continue"
            },
            style = MetaType.body,
            color = colors.fgMuted,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(Space.xxl))

        // Real status, from the health check that already ran.
        when (system.status) {
            SystemStatus.Offline -> MetaBanner(
                message = "This device is offline. Sign-in will work once there is a connection.",
                tone = BannerTone.Warning,
                modifier = Modifier.fillMaxWidth().padding(bottom = Space.lg),
            )
            SystemStatus.Degraded -> MetaBanner(
                message = system.detail?.let { "The gateway is up, but $it." } ?: "The gateway reports a problem.",
                tone = BannerTone.Warning,
                modifier = Modifier.fillMaxWidth().padding(bottom = Space.lg),
            )
            else -> Unit
        }

        if (state.available.size > 1) {
            ModeTabs(
                available = state.available,
                selected = state.mode,
                onSelect = authViewModel::selectMode,
            )
            Spacer(Modifier.height(Space.xl))
        }

        when (state.mode) {
            AuthMode.SUPABASE -> {
                OutlinedTextField(
                    value = state.email,
                    onValueChange = authViewModel::onEmail,
                    label = { Text("Email") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Email,
                        imeAction = ImeAction.Next,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            AuthMode.GATEWAY -> {
                OutlinedTextField(
                    value = state.handle,
                    onValueChange = authViewModel::onHandle,
                    label = { Text("Handle") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                    modifier = Modifier.fillMaxWidth(),
                )
                if (signingUp) {
                    Spacer(Modifier.height(Space.md))
                    OutlinedTextField(
                        value = state.displayName,
                        onValueChange = authViewModel::onDisplayName,
                        label = { Text("Display name (optional)") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }

        Spacer(Modifier.height(Space.md))
        OutlinedTextField(
            value = state.passcode,
            onValueChange = authViewModel::onPasscode,
            label = { Text(if (signingUp) "Choose a passcode (8+ characters)" else "Passcode") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Password,
                imeAction = ImeAction.Done,
            ),
            modifier = Modifier.fillMaxWidth(),
        )

        if (state.notice != null) {
            Spacer(Modifier.height(Space.lg))
            MetaBanner(message = state.notice, tone = BannerTone.Accent, modifier = Modifier.fillMaxWidth())
        }
        if (state.error != null) {
            Spacer(Modifier.height(Space.lg))
            MetaBanner(
                message = state.error!!.userMessage,
                tone = BannerTone.Error,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        Spacer(Modifier.height(Space.xl))
        MetaButton(
            text = when {
                state.busy -> "Working…"
                signingUp -> "Create account"
                else -> "Sign in"
            },
            onClick = { if (signingUp) authViewModel.signUp() else authViewModel.signIn() },
            enabled = state.canSubmit,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(Space.md))
        Text(
            text = if (signingUp) "I already have an account" else "Create an account on this deployment",
            style = MetaType.small,
            color = colors.accent,
            modifier = Modifier
                .clip(RoundedCornerShape(Radii.xs))
                .clickable { signingUp = !signingUp }
                .padding(Space.sm),
        )

        Spacer(Modifier.height(Space.huge))
        MetaDivider()
        Spacer(Modifier.height(Space.lg))
        GatewayRow(container = container, onChange = { showGatewayEditor = true })
        Spacer(Modifier.height(Space.sm))
        MetaLabel(
            text = "Passcodes and tokens are stored in the device keystore; they never leave this phone except to this server.",
            color = colors.fgSubtle,
        )
    }
}

@Composable
private fun ModeTabs(
    available: List<AuthMode>,
    selected: AuthMode,
    onSelect: (AuthMode) -> Unit,
) {
    val colors = MetaIoidTheme.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Radii.sm))
            .background(colors.surfaceSunken)
            .border(Stroke.hairline, colors.borderSubtle, RoundedCornerShape(Radii.sm))
            .padding(Space.xs),
        horizontalArrangement = Arrangement.spacedBy(Space.xs),
    ) {
        available.forEach { mode ->
            val isSelected = mode == selected
            Box(
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(Radii.xs))
                    .background(if (isSelected) colors.surfaceElevated else colors.surfaceSunken)
                    .clickable { onSelect(mode) }
                    .padding(vertical = Space.sm),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = when (mode) {
                        AuthMode.SUPABASE -> "Email"
                        AuthMode.GATEWAY -> "Handle"
                    },
                    style = MetaType.ui,
                    color = if (isSelected) colors.fg else colors.fgMuted,
                )
            }
        }
    }
}

/**
 * The address of the server this app talks to.
 *
 * Editable from here because a user cannot sign in to a server they cannot
 * point the app at. The value is validated by the same code the Settings screen
 * uses, and a rejection is shown verbatim rather than replaced with "invalid".
 */
@Composable
private fun GatewayEditorDialog(
    initial: String,
    onDismiss: () -> Unit,
    onSubmit: (String) -> String?,
) {
    var value by remember { mutableStateOf(initial) }
    var error by remember { mutableStateOf<String?>(null) }
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Gateway address", style = MetaType.title) },
        text = {
            Column {
                Text(
                    text = "The https address of your MetaIoid server, for example https://metaloid.example.com",
                    style = MetaType.small,
                    color = MetaIoidTheme.colors.fgMuted,
                )
                Spacer(Modifier.height(Space.md))
                OutlinedTextField(
                    value = value,
                    onValueChange = { value = it; error = null },
                    singleLine = true,
                    label = { Text("https://…") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
                    modifier = Modifier.fillMaxWidth(),
                )
                if (error != null) {
                    Spacer(Modifier.height(Space.sm))
                    Text(error!!, style = MetaType.small, color = MetaIoidTheme.colors.danger)
                }
            }
        },
        confirmButton = {
            MetaButton(
                text = "Use this server",
                onClick = {
                    val problem = onSubmit(value)
                    if (problem == null) onDismiss() else error = problem
                },
            )
        },
        dismissButton = {
            MetaButton(text = "Cancel", onClick = onDismiss, variant = MetaButtonVariant.Quiet)
        },
    )
}

@Composable
private fun GatewayRow(container: AppContainer, onChange: () -> Unit) {
    val colors = MetaIoidTheme.colors
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            MetaLabel(text = "Gateway", color = colors.fgSubtle)
            Spacer(Modifier.height(Space.xs))
            Text(
                text = container.backendAddress.current()?.host ?: "Not configured",
                style = MetaType.ui,
                color = colors.fgSecondary,
            )
        }
        MetaButton(
            text = "Change",
            onClick = onChange,
            variant = MetaButtonVariant.Quiet,
        )
        Spacer(Modifier.width(Space.sm))
    }
}
