package com.metaloid.feature.usage

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.metaloid.app.AppViewModel
import com.metaloid.app.MetaTopBar
import com.metaloid.core.designsystem.MetaEmptyState
import com.metaloid.core.designsystem.MetaErrorState
import com.metaloid.core.designsystem.MetaIconButton
import com.metaloid.core.designsystem.MetaIoidTheme
import com.metaloid.core.designsystem.MetaLabel
import com.metaloid.core.designsystem.MetaSpinner
import com.metaloid.core.designsystem.MetaType
import com.metaloid.core.designsystem.Radii
import com.metaloid.core.designsystem.Space
import com.metaloid.core.designsystem.Stroke
import com.metaloid.core.ui.TimeFormat
import com.metaloid.core.ui.rememberFeatureViewModel
import com.metaloid.data.dto.UsageBucketDto
import com.metaloid.data.dto.UsageRowDto
import com.metaloid.di.AppContainer
import com.metaloid.feature.library.UsageViewModel

/**
 * Usage: what this account has actually spent and used.
 *
 * Two real sources, both shown: the account's summary from `/api/auth/me` and
 * the per-request rows from `/api/v1/usage`. A usage screen that shows a single
 * number with no evidence behind it is a lie with a progress bar.
 */
@Composable
fun UsageScreen(container: AppContainer, appViewModel: AppViewModel) {
    val viewModel = rememberFeatureViewModel(container) { UsageViewModel(it) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val colors = MetaIoidTheme.colors

    LaunchedEffect(Unit) { viewModel.load() }

    Column(Modifier.fillMaxSize()) {
        MetaTopBar(
            title = "Usage",
            onBack = { appViewModel.back() },
            actions = { MetaIconButton(Icons.Filled.Refresh, "Refresh", { viewModel.load() }) },
        )

        when {
            state.loading && state.rows.isEmpty() && state.summary == null ->
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { MetaSpinner(size = 20.dp) }

            state.error != null && state.rows.isEmpty() ->
                Box(Modifier.fillMaxSize()) { MetaErrorState(error = state.error!!, onRetry = { viewModel.load() }) }

            else -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(Space.lg),
                verticalArrangement = Arrangement.spacedBy(Space.md),
            ) {
                item {
                    Column {
                        Text(
                            text = state.planLabel ?: "Plan not reported by the server",
                            style = MetaType.title,
                            color = colors.fg,
                        )
                        Spacer(Modifier.height(Space.xs))
                        MetaLabel(
                            text = "Recorded server-side for this account; the app keeps no counter of its own.",
                        )
                    }
                }

                state.summary?.let { summary ->
                    item {
                        Column(verticalArrangement = Arrangement.spacedBy(Space.sm)) {
                            BucketRow("Chat", summary.chat)
                            BucketRow("Missions", summary.missions)
                            BucketRow("Research", summary.osint)
                            BucketRow("Voice", summary.voiceMinutes)
                        }
                    }
                }

                if (state.rows.isEmpty()) {
                    item {
                        MetaEmptyState(
                            title = "No requests recorded",
                            message = "This account has no usage rows yet. Rows appear after a reply is produced.",
                        )
                    }
                } else {
                    items(state.rows, key = { it.id ?: it.requestId ?: it.createdAt ?: "row" }) { row ->
                        UsageEventRow(row)
                    }
                }
            }
        }
    }
}

@Composable
private fun BucketRow(label: String, bucket: UsageBucketDto?) {
    val colors = MetaIoidTheme.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Radii.sm))
            .background(colors.surface)
            .border(Stroke.hairline, colors.border, RoundedCornerShape(Radii.sm))
            .padding(Space.lg),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MetaType.ui, color = colors.fg, modifier = Modifier.weight(1f))
        // These are the server's own counters. When it reports nothing, the row
        // says so instead of showing a zero it did not measure.
        if (bucket == null) {
            MetaLabel(text = "not reported")
        } else {
            val limit = when (val raw = bucket.limit) {
                null -> null
                is kotlinx.serialization.json.JsonPrimitive ->
                    if (raw.isString) raw.content else raw.content
                else -> raw.toString()
            }
            Text(
                text = if (limit == null) {
                    "today ${bucket.usedToday} · month ${bucket.usedMonth}"
                } else {
                    "today ${bucket.usedToday} · month ${bucket.usedMonth} · limit $limit"
                },
                style = MetaType.ui,
                color = colors.fgSecondary,
            )
        }
    }
}

@Composable
private fun UsageEventRow(row: UsageRowDto) {
    val colors = MetaIoidTheme.colors
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = Space.sm),
    ) {
        Text(
            text = row.model ?: row.provider ?: "request",
            style = MetaType.ui,
            color = colors.fg,
        )
        Spacer(Modifier.height(2.dp))
        Row {
            row.task?.let {
                MetaLabel(text = it)
                MetaLabel(text = " · ", color = colors.fgSubtle)
            }
            MetaLabel(text = TimeFormat.relative(row.createdAt, System.currentTimeMillis()))
            val tokensIn = row.tokensIn
            val tokensOut = row.tokensOut
            if (tokensIn != null || tokensOut != null) {
                Spacer(Modifier.width(Space.xs))
                MetaLabel(
                    text = " · ${tokensIn ?: 0} in / ${tokensOut ?: 0} out",
                    color = colors.fgSubtle,
                )
            }
            row.latencyMs?.let { latency ->
                MetaLabel(text = " · ${TimeFormat.duration(latency)}", color = colors.fgSubtle)
            }
            row.status?.let { status ->
                MetaLabel(
                    text = " · $status",
                    color = if (status == "error" || status == "failed") colors.danger else colors.fgSubtle,
                )
            }
        }
    }
}
