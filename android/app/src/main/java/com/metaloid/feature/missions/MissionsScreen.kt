package com.metaloid.feature.missions

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
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
import androidx.compose.ui.draw.clip
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
import com.metaloid.core.designsystem.MetaIcons
import com.metaloid.core.designsystem.MetaIoidTheme
import com.metaloid.core.designsystem.MetaLabel
import com.metaloid.core.designsystem.MetaSpinner
import com.metaloid.core.designsystem.MetaType
import com.metaloid.core.designsystem.Radii
import com.metaloid.core.designsystem.Space
import com.metaloid.core.designsystem.Stroke
import com.metaloid.core.ui.TimeFormat
import com.metaloid.core.ui.rememberFeatureViewModel
import com.metaloid.data.dto.MissionDto
import com.metaloid.data.dto.MissionTaskDto
import com.metaloid.di.AppContainer
import com.metaloid.feature.library.MissionsViewModel
import kotlinx.serialization.json.JsonPrimitive

/**
 * Missions: objectives the server works on across several steps.
 *
 * A mission's status is the server's word, in the server's vocabulary
 * (`RUNNING`, `BLOCKED`, `VERIFIED`), because those words mean specific things
 * and translating them into "In progress" loses the part that matters. The
 * screen polls a live mission and *says* that it is polling.
 */
@Composable
fun MissionsScreen(container: AppContainer, onOpen: (String) -> Unit) {
    val viewModel = rememberFeatureViewModel(container) { MissionsViewModel(it) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val colors = MetaIoidTheme.colors
    var composing by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { viewModel.load() }

    Column(Modifier.fillMaxSize()) {
        MetaTopBar(
            title = "Missions",
            actions = {
                MetaIconButton(Icons.Filled.Refresh, "Refresh", { viewModel.load() })
                MetaIconButton(Icons.Filled.Add, "New mission", { composing = true }, tint = colors.accent)
            },
        )

        when {
            state.loading && state.missions.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                MetaSpinner(size = 20.dp)
            }
            state.error != null && state.missions.isEmpty() -> Box(Modifier.fillMaxSize()) {
                MetaErrorState(error = state.error!!, onRetry = { viewModel.load() })
            }
            state.missions.isEmpty() -> Box(Modifier.fillMaxSize()) {
                MetaEmptyState(
                    title = "No missions",
                    message = "A mission is an objective with a plan, tasks and a result the server can verify. Start one and its real progress appears here.",
                    actionLabel = "New mission",
                    onAction = { composing = true },
                )
            }
            else -> LazyColumn(Modifier.fillMaxSize()) {
                items(state.missions, key = { it.id }) { mission ->
                    MissionRow(mission = mission, onOpen = { onOpen(mission.id) })
                    MetaDivider(color = colors.borderSubtle)
                }
            }
        }

        state.error?.let { error ->
            if (state.missions.isNotEmpty()) {
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
        NewMissionDialog(
            busy = state.busy,
            onDismiss = { composing = false },
            onConfirm = { objective, constraints -> viewModel.create(objective, constraints) },
        )
    }
}

@Composable
private fun MissionRow(mission: MissionDto, onOpen: () -> Unit) {
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
                text = mission.objective,
                style = MetaType.ui,
                color = colors.fg,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(Space.xs))
            Row(verticalAlignment = Alignment.CenterVertically) {
                StatusPill(status = mission.status)
                MetaLabel(
                    text = " · ${mission.tasks.size} task${if (mission.tasks.size == 1) "" else "s"}" +
                        " · ${TimeFormat.relative(mission.updatedAt ?: mission.createdAt, System.currentTimeMillis())}",
                    color = colors.fgSubtle,
                )
            }
        }
    }
}

@Composable
internal fun StatusPill(status: String) {
    val colors = MetaIoidTheme.colors
    val tint = when (status) {
        "VERIFIED", "COMPLETED" -> colors.success
        "FAILED" -> colors.danger
        "BLOCKED" -> colors.warning
        "PAUSED" -> colors.fgMuted
        else -> colors.accent
    }
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(Radii.xs))
            .background(tint.copy(alpha = 0.12f))
            .border(Stroke.hairline, tint.copy(alpha = 0.3f), RoundedCornerShape(Radii.xs))
            .padding(horizontal = Space.sm, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(status, style = MetaType.micro, color = tint)
    }
}

@Composable
private fun NewMissionDialog(
    busy: Boolean,
    onDismiss: () -> Unit,
    onConfirm: (String, String?) -> Unit,
) {
    var objective by remember { mutableStateOf("") }
    var constraints by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("New mission", style = MetaType.title) },
        text = {
            Column {
                OutlinedTextField(
                    value = objective,
                    onValueChange = { objective = it.take(2000) },
                    label = { Text("Objective") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(Space.sm))
                OutlinedTextField(
                    value = constraints,
                    onValueChange = { constraints = it.take(2000) },
                    label = { Text("Constraints (optional)") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(Space.sm))
                MetaLabel(
                    text = "The server plans and runs this; nothing is executed on this device.",
                )
            }
        },
        confirmButton = {
            MetaButton(
                text = if (busy) "Creating…" else "Create",
                onClick = { onConfirm(objective, constraints) },
                enabled = objective.isNotBlank() && !busy,
            )
        },
        dismissButton = { MetaButton("Cancel", onDismiss, variant = MetaButtonVariant.Quiet) },
    )
}

/**
 * One mission: status, the plan the server produced, and the controls the API
 * actually exposes (run, pause, cancel, verify).
 */
@Composable
fun MissionDetailScreen(
    container: AppContainer,
    missionId: String,
    onBack: () -> Unit,
    onOpenMissions: () -> Unit,
) {
    val viewModel = rememberFeatureViewModel(container) { MissionsViewModel(it) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val colors = MetaIoidTheme.colors

    LaunchedEffect(missionId) { viewModel.openDetail(missionId) }

    Column(Modifier.fillMaxSize()) {
        MetaTopBar(title = "Mission", onBack = onBack)

        val mission = state.detail
        when {
            state.loading && mission == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                MetaSpinner(size = 20.dp)
            }
            state.error != null && mission == null -> Box(Modifier.fillMaxSize()) {
                MetaErrorState(
                    error = state.error!!,
                    onRetry = { viewModel.openDetail(missionId) },
                    onSecondary = onOpenMissions,
                    secondaryLabel = "All missions",
                )
            }
            mission == null -> Box(Modifier.fillMaxSize()) {
                MetaEmptyState(
                    title = "Mission not found",
                    message = "The server has no mission with this id.",
                    actionLabel = "All missions",
                    onAction = onOpenMissions,
                )
            }
            else -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(Space.lg),
            ) {
                item {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        StatusPill(mission.status)
                        if (state.polling) {
                            Spacer(Modifier.width(Space.sm))
                            MetaSpinner()
                            Spacer(Modifier.width(Space.sm))
                            MetaLabel(text = "refreshing every few seconds")
                        }
                    }
                    Spacer(Modifier.height(Space.md))
                    Text(mission.objective, style = MetaType.read, color = colors.fg)
                    mission.error?.let { error ->
                        Spacer(Modifier.height(Space.md))
                        MetaBanner(
                            message = error,
                            tone = BannerTone.Error,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    Spacer(Modifier.height(Space.lg))
                }

                item {
                    Row {
                        val busy = state.busy
                        when (mission.status) {
                            "QUEUED", "PAUSED" -> MetaButton(
                                text = "Run",
                                onClick = { viewModel.run(mission.id) },
                                enabled = !busy,
                            )
                            "RUNNING" -> MetaButton(
                                text = "Pause",
                                onClick = { viewModel.pause(mission.id) },
                                enabled = !busy,
                                icon = MetaIcons.Pause,
                            )
                            "COMPLETED" -> MetaButton(
                                text = "Verify",
                                onClick = { viewModel.verify(mission.id, note = null) },
                                enabled = !busy,
                                icon = Icons.Filled.Check,
                            )
                            else -> Unit
                        }
                        if (mission.status !in setOf("COMPLETED", "FAILED", "VERIFIED", "CANCELLED")) {
                            Spacer(Modifier.width(Space.sm))
                            MetaButton(
                                text = "Cancel",
                                onClick = { viewModel.cancel(mission.id) },
                                enabled = !busy,
                                variant = MetaButtonVariant.Danger,
                            )
                        }
                    }
                }

                if (mission.tasks.isNotEmpty()) {
                    item {
                        Spacer(Modifier.height(Space.xl))
                        Text("Plan", style = MetaType.title, color = colors.fg)
                        Spacer(Modifier.height(Space.sm))
                    }
                    items(mission.tasks, key = { it.id }) { task ->
                        TaskRow(task)
                    }
                }

                if (mission.timeline.isNotEmpty()) {
                    item {
                        Spacer(Modifier.height(Space.xl))
                        Text("Timeline", style = MetaType.title, color = colors.fg)
                        Spacer(Modifier.height(Space.sm))
                    }
                    items(mission.timeline.size) { index ->
                        val entry = mission.timeline[index]
                        Column(Modifier.fillMaxWidth().padding(vertical = Space.sm)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    imageVector = MetaIcons.History,
                                    contentDescription = null,
                                    tint = colors.fgSubtle,
                                    modifier = Modifier.size(13.dp),
                                )
                                Spacer(Modifier.width(Space.sm))
                                entry.event?.let { MetaLabel(text = it) }
                                entry.at?.let { MetaLabel(text = " · $it", color = colors.fgSubtle) }
                            }
                            entry.detail?.let { detail ->
                                Spacer(Modifier.height(2.dp))
                                Text(detail, style = MetaType.body, color = colors.fgSecondary)
                            }
                        }
                    }
                }

                mission.result?.let { result ->
                    item {
                        Spacer(Modifier.height(Space.xl))
                        Text("Result", style = MetaType.title, color = colors.fg)
                        Spacer(Modifier.height(Space.sm))
                        // The result is a server object; it is shown as data, not
                        // prettified into prose the server did not write.
                        Text(
                            text = result.toString(),
                            style = MetaType.code,
                            color = colors.fgSecondary,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun TaskRow(task: MissionTaskDto) {
    val colors = MetaIoidTheme.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = Space.sm),
        verticalAlignment = Alignment.Top,
    ) {
        StatusPill(task.status)
        Spacer(Modifier.width(Space.sm))
        Column(Modifier.weight(1f)) {
            Text(
                text = task.title ?: task.id,
                style = MetaType.ui,
                color = colors.fg,
            )
            task.error?.let { error ->
                MetaLabel(text = error, color = colors.danger)
            }
            task.output?.let { output ->
                if (output is JsonPrimitive && output.isString && output.content.isNotBlank()) {
                    MetaLabel(text = output.content.take(240), color = colors.fgSubtle)
                }
            }
        }
    }
}
