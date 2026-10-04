package com.metaloid.feature.activity

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.metaloid.app.AppViewModel
import com.metaloid.app.MetaTopBar
import com.metaloid.core.designsystem.MetaDivider
import com.metaloid.core.designsystem.MetaEmptyState
import com.metaloid.core.designsystem.MetaErrorState
import com.metaloid.core.designsystem.MetaIconButton
import com.metaloid.core.designsystem.MetaIoidTheme
import com.metaloid.core.designsystem.MetaLabel
import com.metaloid.core.designsystem.MetaSpinner
import com.metaloid.core.designsystem.MetaType
import com.metaloid.core.designsystem.Space
import com.metaloid.core.ui.TimeFormat
import com.metaloid.core.ui.rememberFeatureViewModel
import com.metaloid.data.dto.JobDto
import com.metaloid.di.AppContainer
import com.metaloid.feature.library.ActivityViewModel
import com.metaloid.feature.missions.StatusPill

/**
 * Server-side work: the job queue.
 *
 * Jobs are what the server runs *for* the account in the background (missions,
 * research runs, uploads). The public job shape omits the internal function
 * name, and this screen does not try to reconstruct it — a job is shown as what
 * the server says it is: a kind, a label, a status and its result.
 */
@Composable
fun ActivityScreen(container: AppContainer, appViewModel: AppViewModel) {
    val viewModel = rememberFeatureViewModel(container) { ActivityViewModel(it) }
    val state by viewModel.state.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { viewModel.load() }

    Column(Modifier.fillMaxSize()) {
        MetaTopBar(
            title = "Activity",
            onBack = { appViewModel.back() },
            actions = { MetaIconButton(Icons.Filled.Refresh, "Refresh", { viewModel.load() }) },
        )
        MetaLabel(
            text = "Work the server is doing for your account",
            modifier = Modifier.padding(horizontal = Space.lg, vertical = Space.sm),
        )

        when {
            state.loading && state.jobs.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                MetaSpinner(size = 20.dp)
            }
            state.error != null && state.jobs.isEmpty() -> Box(Modifier.fillMaxSize()) {
                MetaErrorState(error = state.error!!, onRetry = { viewModel.load() })
            }
            state.jobs.isEmpty() -> Box(Modifier.fillMaxSize()) {
                MetaEmptyState(
                    title = "Nothing running",
                    message = "Missions, research runs and other server work appear here while they are queued or running.",
                )
            }
            else -> LazyColumn(Modifier.fillMaxSize()) {
                items(state.jobs, key = { it.id }) { job ->
                    JobRow(job)
                    MetaDivider(color = MetaIoidTheme.colors.borderSubtle)
                }
            }
        }
    }
}

@Composable
private fun JobRow(job: JobDto) {
    val colors = MetaIoidTheme.colors
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = Space.lg, vertical = Space.md),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            StatusPill(job.status.uppercase())
            Spacer(Modifier.height(Space.xs))
            MetaLabel(
                text = " · ${job.kind ?: "job"}",
                color = colors.fgMuted,
            )
        }
        Spacer(Modifier.height(Space.xs))
        Text(
            text = job.label ?: job.id,
            style = MetaType.ui,
            color = colors.fg,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(Space.xs))
        Row {
            MetaLabel(text = TimeFormat.relative(job.createdAt, System.currentTimeMillis()))
            job.endedAt?.let { ended ->
                MetaLabel(text = " · finished ${TimeFormat.relative(ended, System.currentTimeMillis())}", color = colors.fgSubtle)
            }
        }
        job.error?.let { error ->
            Spacer(Modifier.height(Space.xs))
            MetaLabel(text = error, color = colors.danger)
        }
    }
}
