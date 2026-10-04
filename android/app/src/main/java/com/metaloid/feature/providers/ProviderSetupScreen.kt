package com.metaloid.feature.providers

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.metaloid.app.MetaTopBar
import com.metaloid.app.ProviderSetupIssue
import com.metaloid.core.designsystem.BannerTone
import com.metaloid.core.designsystem.BrandMark
import com.metaloid.core.designsystem.MetaBanner
import com.metaloid.core.designsystem.MetaButton
import com.metaloid.core.designsystem.MetaButtonVariant
import com.metaloid.core.designsystem.MetaDivider
import com.metaloid.core.designsystem.MetaLabel
import com.metaloid.core.designsystem.MetaSpinner
import com.metaloid.core.designsystem.MetaSurface
import com.metaloid.core.designsystem.MetaIoidTheme
import com.metaloid.core.designsystem.MetaType
import com.metaloid.core.designsystem.Radii
import com.metaloid.core.designsystem.Space
import com.metaloid.core.designsystem.Stroke
import com.metaloid.core.ui.rememberFeatureViewModel
import com.metaloid.data.dto.ProviderManifestDto
import com.metaloid.data.dto.ProviderModelDto
import com.metaloid.di.AppContainer

/**
 * Secure first-run provider setup and the account's backend-owned model route.
 * Provider manifests, help links, credential verdicts and models are all read
 * from the authenticated gateway. The key itself exists only in this screen's
 * transient text state and the one request that writes it to the server.
 */
@Composable
fun ProviderSetupScreen(
    container: AppContainer,
    forced: Boolean,
    onBack: () -> Unit,
    onConfigured: () -> Unit,
) {
    val viewModel = rememberFeatureViewModel(container) { ProviderSetupViewModel(it) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val colors = MetaIoidTheme.colors
    val context = LocalContext.current
    val keyboard = LocalSoftwareKeyboardController.current
    val selectedProvider = state.providers.firstOrNull { it.providerId == state.selectedProviderId }

    var apiKey by remember(state.selectedProviderId) { mutableStateOf("") }
    var providerMenuOpen by remember { mutableStateOf(false) }
    var removeCredential by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(forced) { viewModel.load(force = true) }
    BackHandler(enabled = !forced) { onBack() }

    Column(Modifier.fillMaxSize()) {
        MetaTopBar(
            title = if (forced) "Connect AI" else "AI providers",
            onBack = if (forced) null else onBack,
        )
        Column(
            modifier = Modifier
                .fillMaxSize()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = Space.lg, vertical = Space.lg),
            verticalArrangement = Arrangement.spacedBy(Space.md),
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                BrandMark(modifier = Modifier.size(40.dp), color = colors.fg)
                Spacer(Modifier.height(Space.sm))
                Text(
                    text = if (forced) "Your AI, your provider" else "Provider and model settings",
                    style = MetaType.heading,
                    color = colors.fg,
                )
                Text(
                    text = if (forced) {
                        "Connect a provider before starting AI chats. MetaIoid will verify the key with the provider before continuing."
                    } else {
                        "Choose Smart Connect or a model supplied by your MetaIoid backend."
                    },
                    style = MetaType.body,
                    color = colors.fgMuted,
                    modifier = Modifier.padding(top = Space.xs),
                )
            }

            if (state.loading || state.providersLoading) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = Space.md),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    MetaSpinner()
                    Spacer(Modifier.width(Space.sm))
                    Text("Checking your MetaIoid server…", style = MetaType.body, color = colors.fgMuted)
                }
            }

            if (state.sharedProviderReady) {
                MetaBanner(
                    message = "A live shared AI provider is available on this MetaIoid server. Smart Connect is ready.",
                    tone = BannerTone.Accent,
                )
            }

            state.loadError?.let { error ->
                MetaBanner(message = error.userMessage, tone = BannerTone.Error)
                MetaButton("Retry", { viewModel.load(force = true) }, variant = MetaButtonVariant.Secondary)
            }

            if (state.credentials.isNotEmpty()) {
                SetupSectionTitle("Saved provider keys")
                state.credentials.filter { it.isActive }.forEach { credential ->
                    CredentialRow(
                        provider = state.providers.firstOrNull { it.providerId == credential.providerId },
                        providerId = credential.providerId,
                        masked = credential.redacted,
                        status = credential.status,
                        onTest = { viewModel.testSavedCredential(credential.providerId) },
                        onRemove = { removeCredential = credential.id },
                        enabled = !state.testing && !state.saving && !state.finishing,
                    )
                }
            }

            if (state.providers.isNotEmpty()) {
                SetupSectionTitle("1 · Choose a provider")
                Box {
                    MetaSurface(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { providerMenuOpen = true }
                            .semantics { contentDescription = "Choose an AI provider" },
                        shape = RoundedCornerShape(Radii.sm),
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(horizontal = Space.lg, vertical = Space.md),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(selectedProvider?.name ?: "Choose provider", style = MetaType.ui, color = colors.fg)
                                MetaLabel(text = selectedProvider?.providerId ?: "Backend-supported providers")
                            }
                            Icon(Icons.Filled.ArrowDropDown, contentDescription = null, tint = colors.fgMuted)
                        }
                    }
                    DropdownMenu(expanded = providerMenuOpen, onDismissRequest = { providerMenuOpen = false }) {
                        state.providers.forEach { provider ->
                            DropdownMenuItem(
                                text = {
                                    Column {
                                        Text(provider.name, style = MetaType.ui)
                                        MetaLabel(provider.providerId)
                                    }
                                },
                                onClick = {
                                    providerMenuOpen = false
                                    apiKey = ""
                                    viewModel.selectProvider(provider.providerId)
                                },
                            )
                        }
                    }
                }

                selectedProvider?.let { provider ->
                    if (state.helpLoading) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            MetaSpinner()
                            Spacer(Modifier.width(Space.sm))
                            MetaLabel("Loading provider instructions…")
                        }
                    }
                    state.help?.let { help ->
                        if (!help.keyUrl.isNullOrBlank()) {
                            MetaButton(
                                text = "Get ${provider.name} API key",
                                onClick = { openOfficialUrl(context, help.keyUrl) },
                                variant = MetaButtonVariant.Quiet,
                            )
                        }
                        help.steps.takeIf { it.isNotEmpty() }?.let { steps ->
                            MetaLabel(text = steps.joinToString("  ·  "), color = colors.fgSubtle)
                        }
                    }
                    val providerCredential = state.credentials.firstOrNull { it.providerId == provider.providerId && it.isActive }
                    if (providerCredential == null || providerCredential.status.equals("invalid", true)) {
                        OutlinedTextField(
                            value = apiKey,
                            onValueChange = { apiKey = it.take(400) },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            label = { Text("${provider.name} API key") },
                            placeholder = { Text("Paste your key") },
                            visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Password,
                                imeAction = ImeAction.Done,
                                autoCorrect = false,
                            ),
                            supportingText = {
                                Text(
                                    "Sent to your MetaIoid server for encrypted storage and provider verification. Not saved in app preferences.",
                                )
                            },
                            enabled = !state.saving && !state.testing && !state.finishing,
                        )
                        MetaButton(
                            text = when {
                                state.saving -> "Saving securely…"
                                state.testing -> "Checking provider…"
                                else -> "Save and verify key"
                            },
                            onClick = {
                                val oneShot = apiKey
                                apiKey = ""
                                keyboard?.hide()
                                viewModel.connect(provider.providerId, oneShot)
                            },
                            enabled = apiKey.isNotBlank() && !state.saving && !state.testing && !state.finishing,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    } else {
                        MetaLabel(
                            text = "Saved key: ${providerCredential.redacted ?: "••••"} · ${credentialStatusLabel(providerCredential.status)}",
                            color = if (providerCredential.status.equals("invalid", true)) colors.danger else colors.fgMuted,
                        )
                        if (!providerCredential.status.equals("valid", true) && !providerCredential.status.equals("connected", true)) {
                            MetaButton(
                                "Test saved key",
                                onClick = { viewModel.testSavedCredential(provider.providerId) },
                                enabled = !state.testing && !state.saving,
                                variant = MetaButtonVariant.Secondary,
                            )
                        }
                        OutlinedTextField(
                            value = apiKey,
                            onValueChange = { apiKey = it.take(400) },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            label = { Text("Replace API key") },
                            placeholder = { Text("Leave empty to keep the saved key") },
                            visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Password,
                                imeAction = ImeAction.Done,
                                autoCorrect = false,
                            ),
                            supportingText = { Text("The new key replaces the existing server-side key after save.") },
                            enabled = !state.saving && !state.testing && !state.finishing,
                        )
                        if (apiKey.isNotBlank()) {
                            MetaButton(
                                "Replace and verify key",
                                onClick = {
                                    val oneShot = apiKey
                                    apiKey = ""
                                    keyboard?.hide()
                                    viewModel.connect(provider.providerId, oneShot)
                                },
                                enabled = !state.saving && !state.testing && !state.finishing,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                    }
                }
            } else if (!state.loading && !state.sharedProviderReady && state.loadError == null) {
                MetaBanner(
                    message = "This backend did not report any key-based LLM adapters. No provider options have been invented.",
                    tone = BannerTone.Warning,
                )
            }

            state.message?.let { message ->
                MetaBanner(
                    message = message,
                    tone = when (state.status) {
                        ProviderSetupStatus.InvalidCredential,
                        ProviderSetupStatus.ProviderUnavailable,
                        ProviderSetupStatus.ModelUnavailable,
                        ProviderSetupStatus.EncryptionUnavailable -> BannerTone.Error
                        ProviderSetupStatus.Connected,
                        ProviderSetupStatus.Complete -> BannerTone.Accent
                        else -> BannerTone.Neutral
                    },
                )
            }

            if (state.testing || state.saving || state.finishing) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    MetaSpinner()
                    Spacer(Modifier.width(Space.sm))
                    Text(statusLabel(state.status), style = MetaType.small, color = colors.fgMuted)
                }
            }

            if (state.sharedProviderReady || state.connectedProviderIds.isNotEmpty()) {
                SetupSectionTitle("2 · Choose a model (optional)")
                RouteChoiceRow(
                    title = "Smart Connect",
                    subtitle = "Let the MetaIoid backend choose the route for each request.",
                    selected = state.selectedModelId == null,
                    onClick = viewModel::selectSmartConnect,
                )

                if (state.sharedModels.isNotEmpty()) {
                    val sharedName = state.sharedProviderId?.let { id -> state.providers.firstOrNull { it.providerId == id }?.name } ?: "Shared provider"
                    Text(sharedName, style = MetaType.ui, color = colors.fgSecondary)
                    state.sharedModels.forEach { model ->
                        ModelChoiceRow(
                            providerId = state.sharedProviderId.orEmpty(),
                            model = model,
                            selected = state.selectedRouteProviderId == state.sharedProviderId && state.selectedModelId == model.modelId,
                            catalogLive = true,
                            onClick = { state.sharedProviderId?.let { viewModel.selectModel(it, model) } },
                        )
                    }
                }

                selectedProvider?.let { provider ->
                    if (state.providerModels.isNotEmpty() || state.modelsLoading) {
                        Text(provider.name, style = MetaType.ui, color = colors.fgSecondary)
                    }
                    if (state.modelsLoading) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            MetaSpinner()
                            Spacer(Modifier.width(Space.sm))
                            Text("Loading backend models…", style = MetaType.small, color = colors.fgMuted)
                        }
                    } else {
                        state.providerModels.forEach { model ->
                            ModelChoiceRow(
                                providerId = provider.providerId,
                                model = model,
                                selected = state.selectedRouteProviderId == provider.providerId && state.selectedModelId == model.modelId,
                                catalogLive = state.modelCatalogLive == true,
                                onClick = { viewModel.selectModel(provider.providerId, model) },
                            )
                        }
                    }
                }
                MetaLabel(
                    text = "Pricing is shown only when supplied by the backend. Unknown pricing is not a free-model claim; check the provider before selecting.",
                    color = colors.fgSubtle,
                )
            } else if (state.status == ProviderSetupStatus.Connected) {
                SetupSectionTitle("2 · Choose a model")
                RouteChoiceRow(
                    title = "Smart Connect",
                    subtitle = "The backend will choose a model for each request.",
                    selected = true,
                    onClick = viewModel::selectSmartConnect,
                )
            }

            if (state.providers.isNotEmpty() || state.sharedProviderReady) {
                SetupSectionTitle("3 · Save and verify")
                MetaLabel(
                    text = when (state.status) {
                        ProviderSetupStatus.NotConfigured -> "Connect and verify a provider before continuing."
                        ProviderSetupStatus.Saved -> "Key is saved on the backend; provider verification is in progress."
                        ProviderSetupStatus.Connecting -> "The backend is testing the saved key with the provider."
                        ProviderSetupStatus.Connected -> "Provider is verified. Save Smart Connect or the selected model to finish."
                        ProviderSetupStatus.InvalidCredential -> "The provider rejected the key. Replace it and test again."
                        ProviderSetupStatus.ProviderUnavailable -> "The provider could not be confirmed. Retry when the provider and server are reachable."
                        ProviderSetupStatus.ModelUnavailable -> "The provider is connected, but the chosen model is unavailable. Choose Smart Connect or another listed model."
                        ProviderSetupStatus.EncryptionUnavailable -> "The server has not confirmed secure key storage. Configure server encryption before continuing."
                        ProviderSetupStatus.Saving -> "Saving account routing preferences on the backend."
                        ProviderSetupStatus.Complete -> "Setup has been verified."
                        ProviderSetupStatus.Loading -> "Checking provider configuration."
                    },
                    color = colors.fgMuted,
                )
                MetaButton(
                    text = if (state.setupComplete) "Connected" else "Save & continue",
                    onClick = { viewModel.finishSetup(onConfigured) },
                    enabled = state.canFinish && !state.setupComplete,
                    modifier = Modifier.fillMaxWidth(),
                )
                if (!forced) {
                    MetaButton("Done", onBack, variant = MetaButtonVariant.Quiet, modifier = Modifier.fillMaxWidth())
                }
            }
            Spacer(Modifier.height(Space.xxl))
        }
    }

    removeCredential?.let { credentialId ->
        AlertDialog(
            onDismissRequest = { removeCredential = null },
            title = { Text("Remove provider key?", style = MetaType.title) },
            text = {
                Text(
                    "The credential is removed from your MetaIoid account on the server. Other providers remain connected.",
                    style = MetaType.body,
                    color = colors.fgMuted,
                )
            },
            confirmButton = {
                MetaButton(
                    "Remove key",
                    onClick = {
                        removeCredential = null
                        viewModel.removeCredential(credentialId)
                    },
                    variant = MetaButtonVariant.Danger,
                )
            },
            dismissButton = { MetaButton("Cancel", { removeCredential = null }, variant = MetaButtonVariant.Quiet) },
        )
    }
}

@Composable
private fun SetupSectionTitle(text: String) {
    MetaLabel(text = text, color = MetaIoidTheme.colors.accent)
    Spacer(Modifier.height(Space.xs))
}

@Composable
private fun CredentialRow(
    provider: ProviderManifestDto?,
    providerId: String,
    masked: String?,
    status: String,
    onTest: () -> Unit,
    onRemove: () -> Unit,
    enabled: Boolean,
) {
    val colors = MetaIoidTheme.colors
    MetaSurface(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(Radii.sm)) {
        Column(Modifier.padding(horizontal = Space.md, vertical = Space.sm)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Filled.CheckCircle,
                    contentDescription = null,
                    tint = if (status.equals("valid", true) || status.equals("connected", true)) colors.success else colors.warning,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(Modifier.width(Space.sm))
                Column(Modifier.weight(1f)) {
                    Text(provider?.name ?: providerId, style = MetaType.ui, color = colors.fg)
                    MetaLabel(text = "${masked ?: "Key stored"} · ${credentialStatusLabel(status)}")
                }
                Text(
                    "Test",
                    style = MetaType.small,
                    color = colors.accent,
                    modifier = Modifier
                        .clip(RoundedCornerShape(Radii.xs))
                        .clickable(enabled = enabled, onClick = onTest)
                        .padding(horizontal = Space.sm, vertical = Space.md)
                        .semantics { contentDescription = "Test ${provider?.name ?: providerId} key" },
                )
                Icon(
                    Icons.Filled.Delete,
                    contentDescription = "Remove ${provider?.name ?: providerId} key",
                    tint = colors.danger,
                    modifier = Modifier
                        .clip(RoundedCornerShape(Radii.xs))
                        .clickable(enabled = enabled, onClick = onRemove)
                        .padding(Space.sm),
                )
            }
        }
    }
}

@Composable
private fun RouteChoiceRow(title: String, subtitle: String, selected: Boolean, onClick: () -> Unit) {
    val colors = MetaIoidTheme.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Radii.sm))
            .background(if (selected) colors.accentSubtle else colors.surface)
            .border(Stroke.hairline, if (selected) colors.accentRing else colors.border, RoundedCornerShape(Radii.sm))
            .selectable(selected = selected, onClick = onClick, role = Role.RadioButton)
            .padding(horizontal = Space.md, vertical = Space.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MetaType.ui, color = colors.fg)
            MetaLabel(subtitle)
        }
        if (selected) Text("Selected", style = MetaType.small, color = colors.accent)
    }
}

@Composable
private fun ModelChoiceRow(
    providerId: String,
    model: ProviderModelDto,
    selected: Boolean,
    catalogLive: Boolean,
    onClick: () -> Unit,
) {
    val colors = MetaIoidTheme.colors
    val unavailable = model.unavailable == true
    val price = when {
        model.free == true -> "Free"
        model.free == false -> "Paid"
        model.pricing != null -> "Pricing supplied"
        else -> "Pricing unknown"
    }
    val availability = when {
        unavailable -> "Unavailable"
        model.availability.equals("available", true) || catalogLive -> "Available"
        else -> "Availability not confirmed"
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Radii.sm))
            .background(if (selected) colors.accentSubtle else colors.surface)
            .border(Stroke.hairline, if (selected) colors.accentRing else colors.border, RoundedCornerShape(Radii.sm))
            .selectable(selected = selected, enabled = !unavailable, onClick = onClick, role = Role.RadioButton)
            .padding(horizontal = Space.md, vertical = Space.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                text = model.displayName?.takeIf { it.isNotBlank() } ?: model.modelId,
                style = MetaType.ui,
                color = if (unavailable) colors.fgSubtle else colors.fg,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            MetaLabel(text = "$providerId · ${model.modelId}", color = colors.fgSubtle)
            MetaLabel(
                text = "$price · $availability${model.contextLimit?.let { " · ${it / 1000}k context" } ?: ""}",
                color = if (unavailable) colors.danger else colors.fgMuted,
            )
        }
        if (selected) Text("In use", style = MetaType.small, color = colors.accent)
        else if (unavailable) Text("Unavailable", style = MetaType.small, color = colors.danger)
    }
}

private fun credentialStatusLabel(status: String): String = when (status.lowercase()) {
    "valid", "connected" -> "connected · verified"
    "invalid" -> "key rejected"
    else -> "saved · not verified"
}

private fun statusLabel(status: ProviderSetupStatus): String = when (status) {
    ProviderSetupStatus.Loading -> "Loading provider configuration…"
    ProviderSetupStatus.NotConfigured -> "Not configured"
    ProviderSetupStatus.Saved -> "Saved"
    ProviderSetupStatus.Connecting -> "Connecting"
    ProviderSetupStatus.Connected -> "Connected"
    ProviderSetupStatus.InvalidCredential -> "Invalid credential"
    ProviderSetupStatus.ProviderUnavailable -> "Provider unavailable"
    ProviderSetupStatus.ModelUnavailable -> "Model unavailable"
    ProviderSetupStatus.EncryptionUnavailable -> "Secure storage unavailable"
    ProviderSetupStatus.Saving -> "Saving"
    ProviderSetupStatus.Complete -> "Connected"
}

private fun openOfficialUrl(context: Context, value: String) {
    val uri = runCatching { Uri.parse(value) }.getOrNull() ?: return
    if (uri.scheme != "https" || uri.host.isNullOrBlank() || !uri.userInfo.isNullOrBlank()) return
    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, uri)) }
}
