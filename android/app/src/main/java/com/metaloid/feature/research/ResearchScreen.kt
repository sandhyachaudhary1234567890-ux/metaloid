package com.metaloid.feature.research

import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.metaloid.app.MetaTopBar
import com.metaloid.core.designsystem.BannerTone
import com.metaloid.core.designsystem.MetaBanner
import com.metaloid.core.designsystem.MetaButton
import com.metaloid.core.designsystem.MetaButtonVariant
import com.metaloid.core.designsystem.MetaDivider
import com.metaloid.core.designsystem.MetaEmptyState
import com.metaloid.core.designsystem.MetaErrorState
import com.metaloid.core.designsystem.MetaIconButton
import com.metaloid.core.designsystem.MetaIoidTheme
import com.metaloid.core.designsystem.MetaLabel
import com.metaloid.core.designsystem.MetaSpinner
import com.metaloid.core.designsystem.MetaType
import com.metaloid.core.designsystem.Space
import com.metaloid.core.ui.rememberFeatureViewModel
import com.metaloid.data.dto.ResearchDto
import com.metaloid.data.dto.ResearchFindingDto
import com.metaloid.di.AppContainer
import com.metaloid.feature.library.ResearchViewModel
import com.metaloid.feature.missions.StatusPill

/**
 * Research: investigations and the findings they produced.
 *
 * This is the one feature the gateway reports availability for separately
 * (`/api/osint/*`), and the app treats a "not available on this deployment"
 * answer as information rather than an error — the server's own words are shown
 * (Section 6).
 */
@Composable
fun ResearchScreen(container: AppContainer, onOpen: (String) -> Unit) {
    val viewModel = rememberFeatureViewModel(container) { ResearchViewModel(it) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val colors = MetaIoidTheme.colors
    var composing by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { viewModel.load() }

    Column(Modifier.fillMaxSize()) {
        MetaTopBar(
            title = "Research",
            actions = {
                MetaIconButton(Icons.Filled.Refresh, "Refresh", { viewModel.load() })
                MetaIconButton(Icons.Filled.Add, "New investigation", { composing = true }, tint = colors.accent)
            },
        )

        when {
            state.loading && state.investigations.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                MetaSpinner(size = 20.dp)
            }
            state.error != null && state.investigations.isEmpty() -> Box(Modifier.fillMaxSize()) {
                MetaErrorState(error = state.error!!, onRetry = { viewModel.load() })
            }
            state.investigations.isEmpty() -> Box(Modifier.fillMaxSize()) {
                MetaEmptyState(
                    title = "No investigations",
                    message = "An investigation collects findings from the sources this deployment can reach. Nothing is shown until the server has actually found something.",
                    actionLabel = "New investigation",
                    onAction = { composing = true },
                )
            }
            else -> LazyColumn(Modifier.fillMaxSize()) {
                items(state.investigations, key = { it.id }) { investigation ->
                    InvestigationRow(investigation = investigation, onOpen = { onOpen(investigation.id) })
                    MetaDivider(color = colors.borderSubtle)
                }
            }
        }

        state.error?.let { error ->
            if (state.investigations.isNotEmpty()) {
                MetaBanner(
                    message = error.userMessage,
                    tone = BannerTone.Error,
                    actionLabel = "Dismiss",
                    onAction = viewModel::dismissError,
                    modifier = Modifier.padding(Space.lg),
                )
            }
        }
    }

    if (composing) {
        AlertDialog(
            onDismissRequest = { composing = false },
            title = { Text("New investigation", style = MetaType.title) },
            text = {
                var target by remember { mutableStateOf("") }
                Column {
                    OutlinedTextField(
                        value = target,
                        onValueChange = { target = it.take(500) },
                        label = { Text("What should be investigated?") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(Space.sm))
                    MetaLabel(text = "A person, an organisation, a domain or a question.")
                    Spacer(Modifier.height(Space.md))
                    MetaButton(
                        text = if (state.busy) "Creating…" else "Create and run",
                        onClick = {
                            viewModel.create(target)
                            composing = false
                        },
                        enabled = target.isNotBlank() && !state.busy,
                    )
                }
            },
            confirmButton = {},
            dismissButton = { MetaButton("Cancel", { composing = false }, variant = MetaButtonVariant.Quiet) },
        )
    }
}

@Composable
private fun InvestigationRow(investigation: ResearchDto, onOpen: () -> Unit) {
    val colors = MetaIoidTheme.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onOpen)
            .padding(horizontal = Space.lg, vertical = Space.md),
        verticalAlignment = Alignment.Top,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                text = investigation.target,
                style = MetaType.ui,
                color = colors.fg,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(Space.xs))
            Row(verticalAlignment = Alignment.CenterVertically) {
                StatusPill(investigation.status)
                investigation.progress?.let { progress ->
                    MetaLabel(text = " · $progress%")
                }
                investigation.findingCount?.let { count ->
                    MetaLabel(text = " · $count finding${if (count == 1) "" else "s"}", color = colors.fgSubtle)
                }
            }
        }
    }
}

/** One investigation: its collectors, timeline and findings — all server data. */
@Composable
fun ResearchDetailScreen(container: AppContainer, investigationId: String, onBack: () -> Unit) {
    val viewModel = rememberFeatureViewModel(container) { ResearchViewModel(it) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val colors = MetaIoidTheme.colors

    LaunchedEffect(investigationId) { viewModel.openDetail(investigationId) }

    Column(Modifier.fillMaxSize()) {
        MetaTopBar(
            title = "Investigation",
            onBack = onBack,
            actions = {
                MetaIconButton(Icons.Filled.Refresh, "Reload", { viewModel.openDetail(investigationId) })
            },
        )

        val investigation = state.detail
        when {
            state.loading && investigation == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                MetaSpinner(size = 20.dp)
            }
            state.error != null && investigation == null -> Box(Modifier.fillMaxSize()) {
                MetaErrorState(error = state.error!!, onRetry = { viewModel.openDetail(investigationId) })
            }
            investigation == null -> Box(Modifier.fillMaxSize()) {
                MetaEmptyState(
                    title = "Investigation not found",
                    message = "The server has no investigation with this id.",
                )
            }
            else -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(Space.lg),
            ) {
                item {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        StatusPill(investigation.status)
                        investigation.progress?.let { MetaLabel(text = " · $it%", color = colors.fgMuted) }
                    }
                    Spacer(Modifier.height(Space.md))
                    Text(investigation.target, style = MetaType.read, color = colors.fg)
                    if (investigation.status in setOf("queued", "paused", "draft")) {
                        Spacer(Modifier.height(Space.lg))
                        MetaButton(
                            text = "Run",
                            onClick = { viewModel.run(investigation.id) },
                            enabled = !state.busy,
                        )
                    }
                }

                if (investigation.collectors.isNotEmpty()) {
                    item {
                        Spacer(Modifier.height(Space.xl))
                        Text("Collectors", style = MetaType.title, color = colors.fg)
                        Spacer(Modifier.height(Space.sm))
                    }
                    items(investigation.collectors.size) { index ->
                        val collector = investigation.collectors[index]
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = Space.xs),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                text = collector.name ?: collector.id ?: "collector",
                                style = MetaType.ui,
                                color = colors.fg,
                                modifier = Modifier.weight(1f),
                            )
                            collector.state?.let { MetaLabel(text = it) }
                        }
                    }
                }

                if (investigation.timeline.isNotEmpty()) {
                    item {
                        Spacer(Modifier.height(Space.xl))
                        Text("Timeline", style = MetaType.title, color = colors.fg)
                        Spacer(Modifier.height(Space.sm))
                    }
                    items(investigation.timeline.size) { index ->
                        val entry = investigation.timeline[index]
                        Column(Modifier.fillMaxWidth().padding(vertical = Space.sm)) {
                            entry.event?.let { MetaLabel(text = it) }
                            entry.detail?.let { detail ->
                                Text(detail, style = MetaType.body, color = colors.fgSecondary)
                            }
                        }
                    }
                }

                item {
                    Spacer(Modifier.height(Space.xl))
                    Text("Findings", style = MetaType.title, color = colors.fg)
                    Spacer(Modifier.height(Space.sm))
                }

                if (state.findings.isEmpty()) {
                    item {
                        MetaEmptyState(
                            title = "No findings yet",
                            message = if (investigation.status in setOf("queued", "running")) {
                                "The investigation is still running."
                            } else {
                                "This investigation produced no findings. An empty result is a result."
                            },
                        )
                    }
                } else {
                    items(state.findings.size) { index ->
                        FindingRow(state.findings[index])
                    }
                }
            }
        }
    }
}

@Composable
private fun FindingRow(finding: ResearchFindingDto) {
    val colors = MetaIoidTheme.colors
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = Space.md),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            finding.type?.let {
                MetaLabel(text = it, color = colors.accent)
                Spacer(Modifier.width(Space.sm))
            }
            finding.confidence?.let { MetaLabel(text = "confidence: $it", color = colors.fgSubtle) }
        }
        Spacer(Modifier.height(Space.xs))
        Text(
            text = finding.value ?: "(no value reported)",
            style = MetaType.body,
            color = colors.fg,
        )
        finding.evidence?.let { evidence ->
            Spacer(Modifier.height(Space.xs))
            Text(evidence, style = MetaType.small, color = colors.fgMuted)
        }
        finding.source?.let { source ->
            Spacer(Modifier.height(Space.xs))
            MetaLabel(
                text = if (finding.sourceUrl != null) "$source · ${finding.sourceUrl}" else source,
                color = colors.fgSubtle,
            )
        }
    }
}
