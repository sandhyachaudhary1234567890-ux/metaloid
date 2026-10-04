package com.metaloid.feature.diagnostics

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.metaloid.app.AppViewModel
import com.metaloid.app.MetaTopBar
import com.metaloid.core.common.MetaLog
import com.metaloid.core.designsystem.MetaButton
import com.metaloid.core.designsystem.MetaButtonVariant
import com.metaloid.core.designsystem.MetaDivider
import com.metaloid.core.designsystem.MetaIoidTheme
import com.metaloid.core.designsystem.MetaLabel
import com.metaloid.core.designsystem.MetaType
import com.metaloid.core.designsystem.Radii
import com.metaloid.core.designsystem.Space
import com.metaloid.core.designsystem.StatusDot
import com.metaloid.core.designsystem.Stroke

/**
 * Diagnostics: what this app knows about itself, and nothing it does not.
 *
 * The value of this screen is that it is *redacted by construction*: the log it
 * shows passed through `MetaLog`, which strips bearer tokens, JWTs, API keys and
 * email addresses before they are ever stored. Copying this text into a bug
 * report is therefore safe, which is the point of having it.
 *
 * It shows the capability report from the last health check in full, because
 * "the feature is missing" is almost always "the server reported it as
 * unavailable" — and that answer should not require a laptop.
 */
@Composable
fun DiagnosticsScreen(appViewModel: AppViewModel) {
    val system by appViewModel.system.collectAsStateWithLifecycle()
    val colors = MetaIoidTheme.colors
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    val entries = remember(system.checkedAtMs) { MetaLog.snapshot() }

    Column(Modifier.fillMaxSize()) {
        MetaTopBar(title = "Diagnostics", onBack = { appViewModel.back() })

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Space.lg),
            verticalArrangement = Arrangement.spacedBy(Space.md),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                StatusDot(system.status)
                Spacer(Modifier.height(Space.xs))
                MetaLabel(text = system.detail ?: system.status.name.lowercase())
            }

            InfoBlock(
                title = "This app",
                lines = listOf(
                    appViewModel.diagnostics(),
                    "Device: ${appViewModel.deviceSummary()}",
                ),
            )

            InfoBlock(
                title = "Capabilities reported by the server",
                lines = listOf(
                    "chat: ${system.capabilities.chat}",
                    "memory: ${system.capabilities.memory}",
                    "files: ${system.capabilities.files}",
                    "research: ${system.capabilities.research}",
                    "missions: ${system.capabilities.missions}",
                    "voice: ${system.capabilities.voice}",
                ),
            )

            system.health?.let { health ->
                InfoBlock(
                    title = "Last health response",
                    lines = buildList {
                        add("ok: ${health.ok} · ai: ${health.ai} · degraded: ${health.degraded}")
                        add("provider: ${health.provider ?: "not reported"}")
                        add("database: ${health.database} · storage: ${health.storage?.ready ?: false}")
                        add("auth: configured=${health.auth?.configured ?: false} mode=${health.auth?.mode ?: "?"}")
                        health.build?.let { add("build: $it") }
                        health.at?.let { add("reported at: $it") }
                    },
                )
            }

            Column {
                MetaLabel(text = "Log (redacted)", color = colors.accent)
                Spacer(Modifier.height(Space.sm))
                if (entries.isEmpty()) {
                    MetaLabel(text = "Nothing logged since the app started.")
                } else {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(Radii.sm))
                            .background(colors.codeSurface)
                            .border(Stroke.hairline, colors.border, RoundedCornerShape(Radii.sm))
                            .padding(Space.md),
                    ) {
                        entries.forEach { entry ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .horizontalScroll(rememberScrollState()),
                            ) {
                                Text(
                                    text = "${entry.level.name.first()} ${entry.tag}: ${entry.message}",
                                    style = MetaType.code,
                                    color = when (entry.level) {
                                        MetaLog.Level.ERROR -> colors.danger
                                        MetaLog.Level.WARN -> colors.warning
                                        else -> colors.fgSecondary
                                    },
                                )
                            }
                        }
                    }
                }
            }

            MetaDivider()
            MetaButton(
                text = if (copied) "Copied" else "Copy diagnostics",
                onClick = {
                    val text = buildString {
                        appendLine(appViewModel.diagnostics())
                        appendLine("Device: ${appViewModel.deviceSummary()}")
                        appendLine("Status: ${system.status} ${system.detail ?: ""}")
                        appendLine("Log:")
                        entries.forEach { appendLine("${it.level} ${it.tag}: ${it.message}") }
                    }
                    clipboard.setText(AnnotatedString(text))
                    copied = true
                },
            )
            MetaButton("Clear log", { MetaLog.clear(); copied = false }, variant = MetaButtonVariant.Quiet)
            Spacer(Modifier.height(Space.massive))
        }
    }
}

@Composable
private fun InfoBlock(title: String, lines: List<String>) {
    val colors = MetaIoidTheme.colors
    Column {
        MetaLabel(text = title, color = colors.accent)
        Spacer(Modifier.height(Space.sm))
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Radii.sm))
                .background(colors.surface)
                .border(Stroke.hairline, colors.border, RoundedCornerShape(Radii.sm))
                .padding(Space.md),
        ) {
            lines.forEach { line ->
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
                    Text(line, style = MetaType.code, color = colors.fgSecondary)
                }
            }
        }
    }
}
