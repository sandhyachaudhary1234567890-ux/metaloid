package com.metaloid.feature.memory

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
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Star
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
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.metaloid.app.AppViewModel
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
import com.metaloid.core.designsystem.MetaType
import com.metaloid.core.designsystem.Radii
import com.metaloid.core.designsystem.Space
import com.metaloid.core.ui.TimeFormat
import com.metaloid.core.ui.rememberFeatureViewModel
import com.metaloid.data.dto.MemoryDto
import com.metaloid.di.AppContainer
import com.metaloid.feature.library.MemoryViewModel

/**
 * What the assistant remembers.
 *
 * Pinned first — the server's `pinned` flag decides the order, not a local
 * preference. An empty memory is empty: the screen does not seed itself with an
 * example, because an example here would be indistinguishable from a real
 * memory the user did not write.
 */
@Composable
fun MemoryScreen(container: AppContainer, appViewModel: AppViewModel) {
    val viewModel = rememberFeatureViewModel(container) { MemoryViewModel(it) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val colors = MetaIoidTheme.colors
    var adding by remember { mutableStateOf(false) }
    var deleteTarget by remember { mutableStateOf<MemoryDto?>(null) }

    LaunchedEffect(Unit) { viewModel.load() }

    Column(Modifier.fillMaxSize()) {
        MetaTopBar(
            title = "Memory",
            actions = {
                MetaIconButton(Icons.Filled.Add, "Add a memory", { adding = true }, tint = colors.accent)
            },
        )

        when {
            state.error != null && state.memories.isEmpty() -> Box(Modifier.fillMaxSize()) {
                MetaErrorState(error = state.error!!, onRetry = { viewModel.load() })
            }
            state.memories.isEmpty() && !state.loading -> Box(Modifier.fillMaxSize()) {
                MetaEmptyState(
                    title = "Nothing remembered yet",
                    message = "Add a fact you want MetaIoid to keep, or mention one in a conversation — the server stores memories per account.",
                    actionLabel = "Add a memory",
                    onAction = { adding = true },
                )
            }
            else -> Column {
                OutlinedTextField(
                    value = state.query,
                    onValueChange = viewModel::onQueryChange,
                    label = { Text("Search memories") },
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = Space.lg, vertical = Space.sm),
                )
                LazyColumn(Modifier.fillMaxSize()) {
                    items(state.visible, key = { it.id }) { memory ->
                        MemoryRow(
                            memory = memory,
                            busy = state.busyId == memory.id,
                            onTogglePin = { viewModel.togglePin(memory) },
                            onDelete = { deleteTarget = memory },
                        )
                        MetaDivider(color = colors.borderSubtle)
                    }
                }
            }
        }

        state.error?.let { error ->
            if (state.memories.isNotEmpty()) {
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

    if (adding) {
        AddMemoryDialog(
            onDismiss = { adding = false },
            onConfirm = { content, category ->
                viewModel.add(content, category)
                adding = false
            },
        )
    }

    deleteTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text("Forget this?", style = MetaType.title) },
            text = {
                Text(
                    target.content,
                    style = MetaType.body,
                    color = colors.fgMuted,
                )
            },
            confirmButton = {
                MetaButton("Forget", {
                    viewModel.delete(target)
                    deleteTarget = null
                }, variant = MetaButtonVariant.Danger)
            },
            dismissButton = { MetaButton("Keep", { deleteTarget = null }, variant = MetaButtonVariant.Quiet) },
        )
    }
}

@Composable
private fun MemoryRow(memory: MemoryDto, busy: Boolean, onTogglePin: () -> Unit, onDelete: () -> Unit) {
    val colors = MetaIoidTheme.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = Space.lg, vertical = Space.md),
        verticalAlignment = Alignment.Top,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                text = memory.content,
                style = MetaType.body,
                color = colors.fg,
            )
            Spacer(Modifier.height(Space.xs))
            Row(verticalAlignment = Alignment.CenterVertically) {
                MetaLabel(text = memory.category)
                MetaLabel(text = " · ${memory.kind}", color = colors.fgSubtle)
                MetaLabel(
                    text = " · ${TimeFormat.relative(memory.createdAt, System.currentTimeMillis())}",
                    color = colors.fgSubtle,
                )
                if (memory.pinned) {
                    Spacer(Modifier.width(Space.xs))
                    Text("· pinned", style = MetaType.micro, color = colors.accent)
                }
            }
        }
        Icon(
            imageVector = Icons.Filled.Star,
            contentDescription = if (memory.pinned) "Unpin" else "Pin",
            tint = if (memory.pinned) colors.accent else colors.fgSubtle,
            modifier = Modifier
                .clip(RoundedCornerShape(Radii.xs))
                .clickable(enabled = !busy, onClick = onTogglePin)
                .padding(Space.sm)
                .size(18.dp),
        )
        Icon(
            imageVector = Icons.Filled.Delete,
            contentDescription = "Forget",
            tint = colors.fgMuted,
            modifier = Modifier
                .clip(RoundedCornerShape(Radii.xs))
                .clickable(onClick = onDelete)
                .padding(Space.sm)
                .size(18.dp),
        )
    }
}

@Composable
private fun AddMemoryDialog(onDismiss: () -> Unit, onConfirm: (String, String?) -> Unit) {
    var content by remember { mutableStateOf("") }
    var category by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Add a memory", style = MetaType.title) },
        text = {
            Column {
                Text(
                    "Stored on your account, visible to the assistant in later conversations.",
                    style = MetaType.small,
                    color = MetaIoidTheme.colors.fgMuted,
                )
                Spacer(Modifier.height(Space.md))
                OutlinedTextField(
                    value = content,
                    onValueChange = { content = it.take(2000) },
                    label = { Text("What should be remembered?") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(Space.sm))
                OutlinedTextField(
                    value = category,
                    onValueChange = { category = it.take(40) },
                    label = { Text("Category (optional)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            MetaButton("Save", { onConfirm(content, category.ifBlank { null }) }, enabled = content.isNotBlank())
        },
        dismissButton = { MetaButton("Cancel", onDismiss, variant = MetaButtonVariant.Quiet) },
    )
}
