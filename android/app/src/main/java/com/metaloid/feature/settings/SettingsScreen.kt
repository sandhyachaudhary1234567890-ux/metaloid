package com.metaloid.feature.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.metaloid.app.AppViewModel
import com.metaloid.app.MetaTopBar
import com.metaloid.app.Route
import com.metaloid.core.backend.BackendValidation
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
import com.metaloid.core.designsystem.ThemeMode
import com.metaloid.di.AppContainer

/**
 * Settings: the device-local preferences, the server address, and the account.
 *
 * Everything on this screen is either a real device setting or a real session
 * fact — no placeholder rows, no "coming soon", and no setting whose change does
 * not take effect. Sign-out says where it signs out from, because "sign out" and
 * "sign out everywhere" are different promises.
 */
@Composable
fun SettingsScreen(container: AppContainer, appViewModel: AppViewModel) {
    val preferences by appViewModel.preferences.collectAsStateWithLifecycle()
    val system by appViewModel.system.collectAsStateWithLifecycle()
    val authState by appViewModel.authState.collectAsStateWithLifecycle()
    val colors = MetaIoidTheme.colors

    var editingGateway by remember { mutableStateOf(false) }
    var confirmSignOut by remember { mutableStateOf(false) }
    var confirmSignOutEverywhere by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize()) {
        MetaTopBar(title = "Settings", onBack = { appViewModel.back() })

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Space.lg),
        ) {
            // ── account ────────────────────────────────────────────────────
            SectionTitle("Account")
            val label = (authState as? com.metaloid.core.session.AuthState.SignedIn)?.session?.label
                ?: (authState as? com.metaloid.core.session.AuthState.Offline)?.session?.label
                ?: "not signed in"
            InfoRow(label = "Signed in as", value = label)
            InfoRow(label = "Mode", value = appViewModel.deviceSummary())
            InfoRow(
                label = "Server",
                value = container.backendAddress.current()?.host ?: "not configured",
                action = "Change",
                onAction = { editingGateway = true },
            )
            InfoRow(label = "Server build", value = appViewModel.serverBuild ?: "not reported")
            Spacer(Modifier.height(Space.lg))
            MetaButton("Sign out on this device", { confirmSignOut = true }, variant = MetaButtonVariant.Secondary)
            Spacer(Modifier.height(Space.sm))
            MetaButton("Sign out everywhere", { confirmSignOutEverywhere = true }, variant = MetaButtonVariant.Danger)

            // ── appearance ─────────────────────────────────────────────────
            Spacer(Modifier.height(Space.xxl))
            SectionTitle("Appearance")
            InfoRow(label = "Theme", value = preferences.themeMode.name.lowercase(), action = "Change", onAction = {
                val next = when (preferences.themeMode) {
                    ThemeMode.SYSTEM -> ThemeMode.LIGHT
                    ThemeMode.LIGHT -> ThemeMode.DARK
                    ThemeMode.DARK -> ThemeMode.SYSTEM
                }
                appViewModel.setThemeMode(next)
            })
            InfoRow(label = "Accent", value = preferences.accentId, action = "Next", onAction = {
                val ids = com.metaloid.core.designsystem.MetaAccents.map { it.id }
                val index = ids.indexOf(preferences.accentId).coerceAtLeast(0)
                appViewModel.setAccent(ids[(index + 1) % ids.size])
            })
            InfoRow(
                label = "Reduced motion",
                value = when (preferences.reducedMotionOverride) {
                    null -> "follow the system"
                    true -> "always"
                    false -> "never"
                },
                action = "Change",
                onAction = {
                    appViewModel.setReducedMotion(
                        when (preferences.reducedMotionOverride) {
                            null -> true
                            true -> false
                            false -> null
                        },
                    )
                },
            )

            // ── activity and usage ─────────────────────────────────────────
            Spacer(Modifier.height(Space.xxl))
            SectionTitle("Your account on the server")
            NavigationRow("Activity", "Jobs the server ran for this account") { appViewModel.navigate(Route.Activity) }
            NavigationRow("Usage", "Requests, tokens and limits the server recorded") {
                appViewModel.navigate(Route.Usage)
            }
            NavigationRow("Diagnostics", "Capabilities, connection state and a redacted log") {
                appViewModel.navigate(Route.Diagnostics)
            }

            // ── about ──────────────────────────────────────────────────────
            Spacer(Modifier.height(Space.xxl))
            SectionTitle("About")
            InfoRow(label = "App version", value = appViewModel.diagnostics().lineSequence().firstOrNull() ?: "")
            InfoRow(label = "Gateway reachability", value = system.status.name.lowercase())
            system.detail?.let { detail ->
                MetaBanner(
                    message = detail,
                    tone = BannerTone.Neutral,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = Space.sm),
                )
            }
            Spacer(Modifier.height(Space.xxl))
            MetaLabel(
                text = if (system.capabilities.files) {
                    "Files are uploaded to this deployment's object storage."
                } else {
                    "This deployment reported no writable object storage, so attachments are hidden."
                },
            )
            Spacer(Modifier.height(Space.massive))
        }
    }

    if (editingGateway) {
        GatewayDialog(
            initial = container.backendAddress.current()?.toString().orEmpty(),
            onDismiss = { editingGateway = false },
            onSubmit = { raw ->
                when (val result = appViewModel.setGatewayUrl(raw)) {
                    is BackendValidation.Ok -> null
                    is BackendValidation.Invalid -> result.message
                    is BackendValidation.Empty -> "Enter the address of your MetaIoid server."
                }
            },
        )
    }

    if (confirmSignOut) {
        AlertDialog(
            onDismissRequest = { confirmSignOut = false },
            title = { Text("Sign out on this device?", style = MetaType.title) },
            text = {
                Text(
                    "The stored session is removed from this device. Other devices stay signed in.",
                    style = MetaType.body,
                    color = colors.fgMuted,
                )
            },
            confirmButton = {
                MetaButton("Sign out", {
                    confirmSignOut = false
                    appViewModel.signOut()
                }, variant = MetaButtonVariant.Danger)
            },
            dismissButton = { MetaButton("Cancel", { confirmSignOut = false }, variant = MetaButtonVariant.Quiet) },
        )
    }

    if (confirmSignOutEverywhere) {
        AlertDialog(
            onDismissRequest = { confirmSignOutEverywhere = false },
            title = { Text("Sign out everywhere?", style = MetaType.title) },
            text = {
                Text(
                    "Every session for this account is revoked on the server, including this device.",
                    style = MetaType.body,
                    color = colors.fgMuted,
                )
            },
            confirmButton = {
                MetaButton("Sign out everywhere", {
                    confirmSignOutEverywhere = false
                    appViewModel.signOutEverywhere()
                }, variant = MetaButtonVariant.Danger)
            },
            dismissButton = { MetaButton("Cancel", { confirmSignOutEverywhere = false }, variant = MetaButtonVariant.Quiet) },
        )
    }
}

@Composable
private fun SectionTitle(text: String) {
    MetaLabel(text = text, color = MetaIoidTheme.colors.accent)
    Spacer(Modifier.height(Space.sm))
}

@Composable
private fun InfoRow(label: String, value: String, action: String? = null, onAction: (() -> Unit)? = null) {
    val colors = MetaIoidTheme.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = Space.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(label, style = MetaType.ui, color = colors.fgSecondary)
            Text(value, style = MetaType.body, color = colors.fg)
        }
        if (action != null && onAction != null) {
            MetaButton(action, onAction, variant = MetaButtonVariant.Quiet)
        }
    }
}

@Composable
private fun NavigationRow(label: String, description: String, onClick: () -> Unit) {
    val colors = MetaIoidTheme.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Radii.sm))
            .background(colors.surface)
            .border(Stroke.hairline, colors.border, RoundedCornerShape(Radii.sm))
            .clickable(onClick = onClick)
            .padding(Space.lg)
            .padding(vertical = Space.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(label, style = MetaType.title, color = colors.fg)
            MetaLabel(text = description)
        }
        Text("›", style = MetaType.title, color = colors.fgMuted)
    }
    Spacer(Modifier.height(Space.sm))
}

@Composable
private fun GatewayDialog(initial: String, onDismiss: () -> Unit, onSubmit: (String) -> String?) {
    var value by remember { mutableStateOf(initial) }
    var error by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Server address", style = MetaType.title) },
        text = {
            Column {
                OutlinedTextField(
                    value = value,
                    onValueChange = { value = it; error = null },
                    singleLine = true,
                    label = { Text("https://…") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(Space.sm))
                MetaLabel(text = "Changing this re-checks what the new server supports.")
                error?.let {
                    Spacer(Modifier.height(Space.sm))
                    Text(it, style = MetaType.small, color = MetaIoidTheme.colors.danger)
                }
            }
        },
        confirmButton = {
            MetaButton("Use this server", {
                val problem = onSubmit(value)
                if (problem == null) onDismiss() else error = problem
            })
        },
        dismissButton = { MetaButton("Cancel", onDismiss, variant = MetaButtonVariant.Quiet) },
    )
}
