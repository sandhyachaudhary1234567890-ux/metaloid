package com.metaloid.feature.conversations

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
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
import androidx.compose.ui.text.style.TextOverflow
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
import com.metaloid.core.designsystem.MetaIcons
import com.metaloid.core.designsystem.MetaIoidTheme
import com.metaloid.core.designsystem.MetaLabel
import com.metaloid.core.designsystem.MetaType
import com.metaloid.core.designsystem.Radii
import com.metaloid.core.designsystem.SkeletonLine
import com.metaloid.core.designsystem.Space
import com.metaloid.core.ui.TimeFormat
import com.metaloid.core.ui.rememberFeatureViewModel
import com.metaloid.data.dto.ConversationDto
import com.metaloid.di.AppContainer

/**
 * The conversation list: the app's home.
 *
 * What it shows is decided entirely by fetched state — a spinner only while a
 * first fetch is genuinely in flight, a labelled cache when the server could not
 * be reached, an error with the server's own reason otherwise. Empty means empty
 * (Section 6).
 */
@Composable
fun ConversationsScreen(
    container: AppContainer,
    appViewModel: AppViewModel,
    onOpenConversation: (String) -> Unit,
) {
    val viewModel = rememberFeatureViewModel(container) { ConversationsViewModel(it) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val system by appViewModel.system.collectAsStateWithLifecycle()
    val colors = MetaIoidTheme.colors
    val nowMs = System.currentTimeMillis()
    var renameTarget by remember { mutableStateOf<ConversationDto?>(null) }
    var deleteTarget by remember { mutableStateOf<ConversationDto?>(null) }

    androidx.compose.runtime.LaunchedEffect(Unit) { viewModel.load() }

    // A shared text has no conversation yet: create a real one and open it. The
    // text itself is claimed later, by the chat screen's composer.
    //
    // The key is the pending text, not `Unit`: a share that arrives while this
    // screen is already composed must still be placed, and `createForPendingShare`
    // refuses to create a second conversation for a share that already has one.
    val waitingShare by com.metaloid.core.share.PendingShare.waiting.collectAsStateWithLifecycle()
    androidx.compose.runtime.LaunchedEffect(waitingShare) {
        if (!waitingShare.isNullOrBlank()) viewModel.createForPendingShare(onCreated = onOpenConversation)
    }

    Column(Modifier.fillMaxSize()) {
        MetaTopBar(
            title = "Conversations",
            actions = {
                MetaIconButton(
                    icon = Icons.Filled.Add,
                    contentDescription = "New conversation",
                    onClick = { viewModel.create(onCreated = onOpenConversation) },
                    tint = colors.accent,
                )
            },
        )

        when {
            state.loading && state.conversations.isEmpty() -> LoadingList()

            state.error != null && state.conversations.isEmpty() -> Box(Modifier.fillMaxSize()) {
                MetaErrorState(
                    error = state.error!!,
                    onRetry = {
                        viewModel.load(force = true)
                        // A share that could not be placed is retried by the
                        // same button: it is one of the things that failed.
                        if (com.metaloid.core.share.PendingShare.needsConversation) {
                            viewModel.createForPendingShare(onCreated = onOpenConversation)
                        }
                    },
                    onSecondary = { appViewModel.navigate(com.metaloid.app.Route.Diagnostics) },
                    secondaryLabel = "Diagnostics",
                )
            }

            state.isEmpty -> Box(Modifier.fillMaxSize()) {
                MetaEmptyState(
                    title = "No conversations yet",
                    message = "Start one and it will appear here, on this device and any other signed in to this account.",
                    actionLabel = "New conversation",
                    onAction = { viewModel.create(onCreated = onOpenConversation) },
                )
            }

            else -> Column(Modifier.fillMaxSize()) {
                if (state.showingCache) {
                    MetaBanner(
                        message = cacheMessage(state.cacheAgeMs),
                        tone = BannerTone.Warning,
                        actionLabel = "Retry",
                        onAction = { viewModel.load(force = true) },
                        modifier = Modifier.padding(horizontal = Space.lg, vertical = Space.sm),
                    )
                }
                if (system.status == com.metaloid.core.designsystem.SystemStatus.Degraded && system.detail != null) {
                    MetaBanner(
                        message = "Server note: ${system.detail}",
                        tone = BannerTone.Neutral,
                        modifier = Modifier.padding(horizontal = Space.lg, vertical = Space.sm),
                    )
                }
                OutlinedTextField(
                    value = state.query,
                    onValueChange = viewModel::onQueryChange,
                    label = { Text("Search conversations") },
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = Space.lg, vertical = Space.sm),
                )
                if (state.visible.isEmpty()) {
                    MetaEmptyState(
                        title = "No matches",
                        message = "Nothing in the loaded conversations matches “${state.query}”.",
                    )
                } else {
                    LazyColumn(Modifier.fillMaxSize()) {
                        items(state.visible, key = { it.id }) { conversation ->
                            ConversationRow(
                                conversation = conversation,
                                nowMs = nowMs,
                                onOpen = { onOpenConversation(conversation.id) },
                                onRename = { renameTarget = conversation },
                                onDelete = { deleteTarget = conversation },
                            )
                            MetaDivider(color = colors.borderSubtle)
                        }
                    }
                }
            }
        }
    }

    renameTarget?.let { target ->
        RenameDialog(
            initial = target.title,
            onDismiss = { renameTarget = null },
            onConfirm = { title ->
                viewModel.rename(target.id, title)
                renameTarget = null
            },
        )
    }

    deleteTarget?.let { target ->
        ConfirmDeleteDialog(
            title = target.title,
            onDismiss = { deleteTarget = null },
            onConfirm = {
                viewModel.delete(target.id)
                deleteTarget = null
            },
        )
    }

    state.error?.let { error ->
        if (state.conversations.isNotEmpty()) {
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

@Composable
private fun ConversationRow(
    conversation: ConversationDto,
    nowMs: Long,
    onOpen: () -> Unit,
    onRename: () -> Unit,
    onDelete: () -> Unit,
) {
    val colors = MetaIoidTheme.colors
    var menuOpen by remember { mutableStateOf(false) }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onOpen)
            .padding(start = Space.lg, end = Space.sm, top = Space.md, bottom = Space.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                text = conversation.title.ifBlank { "New conversation" },
                style = MetaType.title,
                color = colors.fg,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(Space.xs))
            Row(verticalAlignment = Alignment.CenterVertically) {
                MetaLabel(text = TimeFormat.relative(conversation.updatedAt ?: conversation.createdAt, nowMs))
                conversation.model?.let { model ->
                    MetaLabel(text = " · $model", color = colors.fgSubtle, modifier = Modifier.padding(start = 2.dp))
                }
            }
        }
        Box {
            Icon(
                imageVector = Icons.Filled.MoreVert,
                contentDescription = "Conversation actions",
                tint = colors.fgMuted,
                modifier = Modifier
                    .clip(RoundedCornerShape(Radii.xs))
                    .clickable { menuOpen = true }
                    .padding(Space.md),
            )
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                DropdownMenuItem(
                    text = { Text("Rename", style = MetaType.ui) },
                    onClick = { menuOpen = false; onRename() },
                )
                DropdownMenuItem(
                    text = { Text("Delete", style = MetaType.ui, color = colors.danger) },
                    onClick = { menuOpen = false; onDelete() },
                )
            }
        }
    }
}

@Composable
private fun LoadingList() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(Space.lg),
        verticalArrangement = Arrangement.spacedBy(Space.md),
    ) {
        repeat(6) {
            Column(Modifier.fillMaxWidth().padding(vertical = Space.sm)) {
                SkeletonLine(widthFraction = 0.55f, height = 14.dp)
                Spacer(Modifier.height(Space.sm))
                SkeletonLine(widthFraction = 0.3f, height = 10.dp)
            }
        }
    }
}

private fun cacheMessage(ageMs: Long?): String {
    val age = ageMs?.let { TimeFormat.duration(it) } ?: "unknown age"
    return "Showing the copy saved on this device ($age ago). The server could not be reached."
}

@Composable
private fun RenameDialog(initial: String, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var value by remember { mutableStateOf(initial) }
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Rename conversation", style = MetaType.title) },
        text = {
            OutlinedTextField(
                value = value,
                onValueChange = { value = it.take(120) },
                singleLine = true,
                label = { Text("Title") },
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = {
            MetaButton("Save", { onConfirm(value) }, enabled = value.isNotBlank())
        },
        dismissButton = {
            MetaButton("Cancel", onDismiss, variant = MetaButtonVariant.Quiet)
        },
    )
}

@Composable
private fun ConfirmDeleteDialog(title: String, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Delete “$title”?", style = MetaType.title) },
        text = {
            Text(
                "The conversation and its messages are removed from the server. This cannot be undone.",
                style = MetaType.body,
                color = MetaIoidTheme.colors.fgMuted,
            )
        },
        confirmButton = {
            MetaButton("Delete", onConfirm, variant = MetaButtonVariant.Danger)
        },
        dismissButton = {
            MetaButton("Keep", onDismiss, variant = MetaButtonVariant.Quiet)
        },
    )
}
