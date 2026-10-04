package com.metaloid.feature.chat

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.metaloid.core.designsystem.BannerTone
import com.metaloid.core.designsystem.MetaBanner
import com.metaloid.core.designsystem.MetaButton
import com.metaloid.core.designsystem.MetaButtonVariant
import com.metaloid.core.designsystem.MetaDivider
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
import com.metaloid.core.ui.MarkdownText
import com.metaloid.core.ui.TimeFormat
import com.metaloid.core.ui.rememberFeatureViewModel
import com.metaloid.di.AppContainer

/**
 * A conversation.
 *
 * The screen owns no logic: [ChatViewModel] holds the transcript, the stream
 * state and the failure state, and this file decides only *presentation*. The
 * three things that matter visually:
 *
 *  1. **The transcript is the truth.** A bubble is only shown as sent once the
 *     server returned the row; a streaming answer shows the text it currently
 *     has, and a stopped or failed turn keeps its partial text and is labelled.
 *  2. **The status line is real.** "Sandbox reply" appears only when the server
 *     said `demo: true`; the model name shown is the one the server reported.
 *  3. **Nothing is lost.** The draft survives a process death; a partial answer
 *     is written to the server before the turn is abandoned, by the runner.
 */
@Composable
fun ChatScreen(
    container: AppContainer,
    conversationId: String,
    onBack: () -> Unit,
) {
    val viewModel = rememberFeatureViewModel(container) { ChatViewModel(it) }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val colors = MetaIoidTheme.colors

    LaunchedEffect(conversationId) { viewModel.open(conversationId) }

    var showModelPicker by remember { mutableStateOf(false) }
    var showRename by remember { mutableStateOf(false) }
    var showDelete by remember { mutableStateOf(false) }
    var menuOpen by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri != null) {
            runCatching {
                context.contentResolver.takePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION,
                )
            }
            viewModel.attach(uri, context)
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .imePadding(),
    ) {
        ChatTopBar(
            title = state.conversation?.title?.ifBlank { "Conversation" } ?: "Conversation",
            model = state.selectedModel ?: state.stream.model,
            onBack = onBack,
            onModelClick = { showModelPicker = true },
            onMenu = { menuOpen = true },
        )

        Box(Modifier.weight(1f)) {
            when {
                state.loading && state.messages.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    MetaSpinner()
                }
                state.loadError != null && state.messages.isEmpty() -> Box(Modifier.fillMaxSize()) {
                    MetaErrorState(
                        error = state.loadError!!,
                        onRetry = { viewModel.open(conversationId) },
                    )
                }
                else -> Transcript(
                    state = state,
                    onLink = { url -> openExternal(context, url) },
                    onCopy = { text -> clipboard.setText(AnnotatedString(text)) },
                )
            }
        }

        if (state.showingCachedData) {
            MetaBanner(
                message = "Showing the transcript saved on this device. Reconnecting will replace it with the server's copy.",
                tone = BannerTone.Warning,
                modifier = Modifier.padding(horizontal = Space.lg, vertical = Space.sm),
            )
        }

        state.stream.error?.let { error ->
            if (state.stream.phase.isTerminal) {
                MetaBanner(
                    message = error.userMessage,
                    tone = BannerTone.Error,
                    actionLabel = if (error.retryable) "Retry" else null,
                    onAction = if (error.retryable) ({ viewModel.retryLast() }) else null,
                    modifier = Modifier.padding(horizontal = Space.lg, vertical = Space.sm),
                )
            }
        }

        state.sendError?.let { error ->
            MetaBanner(
                message = error.userMessage,
                tone = BannerTone.Error,
                actionLabel = "Dismiss",
                onAction = viewModel::clearSendError,
                modifier = Modifier.padding(horizontal = Space.lg, vertical = Space.sm),
            )
        }

        // The draft lives here, so a failed turn leaves the user's words intact.
        if (state.attachments.isNotEmpty()) {
            AttachmentStrip(
                attachments = state.attachments,
                onRemove = viewModel::removeAttachment,
            )
        }

        Composer(
            draft = state.draft,
            streaming = state.isStreaming,
            canSend = state.canSend,
            uploadsEnabled = state.uploadsEnabled,
            onDraftChange = viewModel::onDraftChange,
            onSend = viewModel::send,
            onStop = viewModel::stop,
            onAttach = { picker.launch(arrayOf("*/*")) },
        )
    }

    val renameTarget = state.conversation
    if (showRename && renameTarget != null) {
        RenameConversationDialog(
            initial = renameTarget.title,
            onDismiss = { showRename = false },
            onConfirm = { title ->
                viewModel.rename(title)
                showRename = false
            },
        )
    }

    if (showDelete) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { showDelete = false },
            title = { Text("Delete this conversation?", style = MetaType.title) },
            text = {
                Text(
                    "The conversation and its messages are removed from the server. This cannot be undone.",
                    style = MetaType.body,
                    color = colors.fgMuted,
                )
            },
            confirmButton = {
                MetaButton("Delete", {
                    showDelete = false
                    viewModel.delete(onDeleted = onBack)
                }, variant = MetaButtonVariant.Danger)
            },
            dismissButton = { MetaButton("Keep", { showDelete = false }, variant = MetaButtonVariant.Quiet) },
        )
    }

    if (showModelPicker) {
        ModelPickerSheet(
            models = state.models.map { it.id to it.name },
            selected = state.selectedModel,
            loading = state.models.isEmpty(),
            onSelect = { id ->
                viewModel.selectModel(id)
                showModelPicker = false
            },
            onDismiss = { showModelPicker = false },
        )
    }

    // The conversation menu, anchored to the top bar's overflow control.
    if (menuOpen) {
        // A dialog-free menu: the actions are few and destructive ones confirm.
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { menuOpen = false },
            title = { Text("Conversation", style = MetaType.title) },
            text = {
                Column {
                    MenuAction("Rename") { menuOpen = false; showRename = true }
                    MenuAction("Regenerate the last answer", enabled = !state.isStreaming) {
                        menuOpen = false
                        viewModel.regenerate()
                    }
                    MenuAction("Delete", destructive = true) { menuOpen = false; showDelete = true }
                }
            },
            confirmButton = {
                MetaButton("Close", { menuOpen = false }, variant = MetaButtonVariant.Quiet)
            },
        )
    }
}

@Composable
private fun ChatTopBar(
    title: String,
    model: String?,
    onBack: () -> Unit,
    onModelClick: () -> Unit,
    onMenu: () -> Unit,
) {
    val colors = MetaIoidTheme.colors
    Column {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(colors.bg)
                .padding(horizontal = Space.sm, vertical = Space.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            MetaIconButton(Icons.Filled.ArrowBack, "Back", onBack)
            Column(
                modifier = Modifier
                    .weight(1f)
                    .padding(horizontal = Space.sm),
            ) {
                Text(
                    text = title,
                    style = MetaType.title,
                    color = colors.fg,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = model ?: "server decides the model",
                        style = MetaType.small,
                        color = if (model != null) colors.fgMuted else colors.fgSubtle,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier
                            .clip(RoundedCornerShape(Radii.xs))
                            .clickable(onClick = onModelClick)
                            .padding(vertical = 2.dp, horizontal = 2.dp),
                    )
                }
            }
            MetaIconButton(Icons.Filled.MoreVert, "Conversation menu", onMenu)
        }
        MetaDivider(color = colors.borderSubtle)
    }
}

@Composable
private fun Transcript(
    state: ChatViewModel.UiState,
    onLink: (String) -> Unit,
    onCopy: (String) -> Unit,
) {
    val listState = rememberLazyListState()
    val lastIndex = state.messages.lastIndex

    // Follow the stream, but never steal the user's scroll position: if they
    // have scrolled up to read, new tokens do not yank them back down.
    val autoScroll = remember { mutableStateOf(true) }
    androidx.compose.runtime.LaunchedEffect(listState) {
        androidx.compose.runtime.snapshotFlow { listState.firstVisibleItemIndex }
            .collect { index ->
                val atBottom = lastIndex - index <= 1
                autoScroll.value = atBottom
            }
    }
    LaunchedEffect(state.messages.size, state.stream.text) {
        if (autoScroll.value && lastIndex >= 0) {
            listState.animateScrollToItem(lastIndex)
        }
    }

    if (state.messages.isEmpty()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(Space.xxl),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("Ask MetaIoid anything", style = MetaType.heading, color = MetaIoidTheme.colors.fg)
            Spacer(Modifier.height(Space.sm))
            Text(
                "Answers come from the provider this deployment is connected to. Anything the assistant cannot do is disabled here rather than promised.",
                style = MetaType.body,
                color = MetaIoidTheme.colors.fgMuted,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        }
        return
    }

    LazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            start = Space.lg,
            end = Space.lg,
            top = Space.lg,
            bottom = Space.lg,
        ),
        verticalArrangement = Arrangement.spacedBy(Space.lg),
    ) {
        items(state.messages, key = { it.id }) { message ->
            MessageBubble(message = message, onLink = onLink, onCopy = onCopy)
        }
    }
}

@Composable
private fun MessageBubble(message: ChatMessage, onLink: (String) -> Unit, onCopy: (String) -> Unit) {
    val colors = MetaIoidTheme.colors
    val isUser = message.role == MessageRole.User
    val shape = RoundedCornerShape(Radii.lg)
    var copyOpen by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = if (isUser) Alignment.End else Alignment.Start,
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth(if (isUser) 0.88f else 1f)
                .clip(shape)
                .background(if (isUser) colors.accentSubtle else colors.surface)
                .border(
                    Stroke.hairline,
                    if (isUser) colors.accentRing else colors.border,
                    shape,
                )
                .clickable { copyOpen = !copyOpen }
                .padding(horizontal = Space.lg, vertical = Space.md),
        ) {
            Column {
                if (message.text.isBlank() && message.state == MessageState.Streaming) {
                    // A turn that has connected but produced no text yet: a
                    // spinner is the honest thing to show, not an empty bubble.
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        MetaSpinner()
                        Spacer(Modifier.width(Space.sm))
                        Text("Waiting for the first token…", style = MetaType.small, color = colors.fgMuted)
                    }
                } else if (message.text.isBlank() && message.state == MessageState.Completed) {
                    Text(
                        "The model returned an empty answer.",
                        style = MetaType.body,
                        color = colors.fgMuted,
                    )
                } else {
                    MarkdownText(text = message.text, onLink = onLink)
                }

                if (message.state == MessageState.Streaming) {
                    Text("▍", style = MetaType.read, color = colors.accent)
                }

                Spacer(Modifier.height(Space.sm))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    MetaLabel(text = stateLabel(message))
                    message.provider?.let { provider ->
                        MetaLabel(text = " · $provider", color = colors.fgSubtle)
                    }
                    message.errorText?.let { detail ->
                        MetaLabel(text = " · $detail", color = colors.danger)
                    }
                }
            }
        }

        if (copyOpen) {
            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(Radii.xs))
                    .clickable { onCopy(message.text) }
                    .padding(horizontal = Space.sm, vertical = Space.xs),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(MetaIcons.Copy, contentDescription = null, tint = colors.fgMuted, modifier = Modifier.size(13.dp))
                Spacer(Modifier.width(Space.xs))
                Text("Copy", style = MetaType.small, color = colors.fgMuted)
            }
        }
    }
}

private fun stateLabel(message: ChatMessage): String = when (message.state) {
    MessageState.Sending -> "Sending…"
    MessageState.Sent -> "Sent"
    MessageState.Streaming -> "Streaming"
    MessageState.Completed -> TimeFormat.relative(message.createdAt, System.currentTimeMillis())
    MessageState.Stopped -> "Stopped"
    MessageState.Failed -> "Failed"
    MessageState.Interrupted -> "Interrupted — the partial answer was saved"
    MessageState.Recovered -> "Interrupted earlier; the server closed this turn"
}

@Composable
private fun AttachmentStrip(
    attachments: List<ChatViewModel.PendingAttachment>,
    onRemove: (String) -> Unit,
) {
    val colors = MetaIoidTheme.colors
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = Space.lg, vertical = Space.xs),
        verticalArrangement = Arrangement.spacedBy(Space.xs),
    ) {
        attachments.forEach { attachment ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(Radii.sm))
                    .background(colors.surface)
                    .border(Stroke.hairline, colors.border, RoundedCornerShape(Radii.sm))
                    .padding(horizontal = Space.md, vertical = Space.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = MetaIcons.CloudUpload,
                    contentDescription = null,
                    tint = when (attachment.state) {
                        ChatViewModel.AttachmentState.Confirmed -> colors.success
                        ChatViewModel.AttachmentState.Failed -> colors.danger
                        else -> colors.fgMuted
                    },
                    modifier = Modifier.size(16.dp),
                )
                Spacer(Modifier.width(Space.sm))
                Column(Modifier.weight(1f)) {
                    Text(
                        text = attachment.displayName,
                        style = MetaType.ui,
                        color = colors.fg,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    MetaLabel(
                        text = when (attachment.state) {
                            ChatViewModel.AttachmentState.Selected -> "selected · ${TimeFormat.bytes(attachment.sizeBytes)}"
                            ChatViewModel.AttachmentState.Uploading -> {
                                val percent = attachment.progress?.let { "${(it * 100).toInt()}%" } ?: "starting"
                                "uploading · $percent"
                            }
                            ChatViewModel.AttachmentState.Confirmed -> "ready · will be sent with your next message"
                            ChatViewModel.AttachmentState.Failed ->
                                "failed · ${attachment.error?.userMessage ?: "upload failed"}"
                        },
                        color = if (attachment.state == ChatViewModel.AttachmentState.Failed) colors.danger else colors.fgMuted,
                    )
                }
                Icon(
                    imageVector = Icons.Filled.Close,
                    contentDescription = "Remove attachment",
                    tint = colors.fgMuted,
                    modifier = Modifier
                        .clip(RoundedCornerShape(Radii.xs))
                        .clickable { onRemove(attachment.localId) }
                        .padding(Space.sm),
                )
            }
        }
    }
}

/**
 * The composer.
 *
 * Two states, and no third: while a turn is running the send button *is* the
 * stop button. There is no queue, because a queued message the user cannot see
 * is a message they think they cancelled.
 */
@Composable
private fun Composer(
    draft: String,
    streaming: Boolean,
    canSend: Boolean,
    uploadsEnabled: Boolean,
    onDraftChange: (String) -> Unit,
    onSend: () -> Unit,
    onStop: () -> Unit,
    onAttach: () -> Unit,
) {
    val colors = MetaIoidTheme.colors
    Column(Modifier.background(colors.bg)) {
        MetaDivider(color = colors.borderSubtle)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = Space.md, vertical = Space.sm),
            verticalAlignment = Alignment.Bottom,
        ) {
            if (uploadsEnabled) {
                MetaIconButton(
                    icon = MetaIcons.Attach,
                    contentDescription = "Attach a file",
                    onClick = onAttach,
                    enabled = !streaming,
                )
            }
            TextField(
                value = draft,
                onValueChange = onDraftChange,
                modifier = Modifier
                    .weight(1f)
                    .heightIn(min = 48.dp, max = 168.dp)
                    .padding(horizontal = Space.xs),
                placeholder = {
                    Text(
                        if (streaming) "Answering…" else "Message MetaIoid",
                        style = MetaType.read,
                        color = colors.fgSubtle,
                    )
                },
                textStyle = MetaType.read,
                maxLines = 8,
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Sentences,
                    imeAction = ImeAction.Default,
                ),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = colors.surface,
                    unfocusedContainerColor = colors.surface,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent,
                    cursorColor = colors.accent,
                    focusedTextColor = colors.fg,
                    unfocusedTextColor = colors.fg,
                ),
                shape = RoundedCornerShape(Radii.lg),
            )
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .clip(RoundedCornerShape(Radii.pill))
                    .background(if (streaming || canSend) colors.accentSolid else colors.surfaceElevated)
                    .clickable(enabled = streaming || canSend) { if (streaming) onStop() else onSend() }
                    .semantics { contentDescription = if (streaming) "Stop" else "Send" },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = if (streaming) MetaIcons.Stop else Icons.Filled.Send,
                    contentDescription = null,
                    tint = if (streaming || canSend) colors.onAccentSolid else colors.fgSubtle,
                    modifier = Modifier.size(20.dp),
                )
            }
        }
    }
}

@Composable
private fun MenuAction(
    label: String,
    enabled: Boolean = true,
    destructive: Boolean = false,
    onClick: () -> Unit,
) {
    val colors = MetaIoidTheme.colors
    Text(
        text = label,
        style = MetaType.body,
        color = when {
            !enabled -> colors.fgSubtle
            destructive -> colors.danger
            else -> colors.fg
        },
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Radii.xs))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(vertical = Space.md),
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ModelPickerSheet(
    models: List<Pair<String, String?>>,
    selected: String?,
    loading: Boolean,
    onSelect: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val colors = MetaIoidTheme.colors
    androidx.compose.material3.ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(horizontal = Space.lg, vertical = Space.lg)) {
            Text("Model", style = MetaType.title, color = colors.fg)
            Spacer(Modifier.height(Space.xs))
            MetaLabel(
                text = "This preference is stored on the server for your account, so every device agrees.",
            )
            Spacer(Modifier.height(Space.lg))
            if (loading) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    MetaSpinner()
                    Spacer(Modifier.width(Space.sm))
                    Text("Loading the model list…", style = MetaType.body, color = colors.fgMuted)
                }
            } else if (models.isEmpty()) {
                Text(
                    "This deployment reported no usable models for your account. Nothing is selected on your behalf.",
                    style = MetaType.body,
                    color = colors.fgMuted,
                )
            } else {
                models.forEach { (id, name) ->
                    val isSelected = id == selected
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(Radii.sm))
                            .background(if (isSelected) colors.accentSubtle else Color.Transparent)
                            .clickable { onSelect(id) }
                            .padding(vertical = Space.md, horizontal = Space.sm),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(name ?: id, style = MetaType.ui, color = colors.fg)
                            MetaLabel(text = id, color = colors.fgSubtle)
                        }
                        if (isSelected) {
                            Text("In use", style = MetaType.small, color = colors.accent)
                        }
                    }
                }
            }
            Spacer(Modifier.height(Space.lg))
        }
    }
}

@Composable
private fun RenameConversationDialog(initial: String, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var value by remember { mutableStateOf(initial) }
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Rename conversation", style = MetaType.title) },
        text = {
            TextField(
                value = value,
                onValueChange = { value = it.take(120) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = { MetaButton("Save", { onConfirm(value) }, enabled = value.isNotBlank()) },
        dismissButton = { MetaButton("Cancel", onDismiss, variant = MetaButtonVariant.Quiet) },
    )
}

/**
 * Opens a link from an answer.
 *
 * Model output is untrusted input (Section 8.2): only `http`/`https` are opened,
 * and a URL with credentials embedded is refused outright rather than handed to
 * the system browser.
 */
private fun openExternal(context: Context, url: String) {
    val trimmed = url.trim()
    val parsed = runCatching { java.net.URI(trimmed) }.getOrNull() ?: return
    val scheme = parsed.scheme?.lowercase() ?: return
    if (scheme != "http" && scheme != "https") return
    if (parsed.userInfo != null) return
    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(trimmed))) }
}
