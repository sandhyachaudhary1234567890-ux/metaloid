package com.metaloid.app

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.metaloid.core.designsystem.MetaDivider
import com.metaloid.core.designsystem.MetaIcons
import com.metaloid.core.designsystem.MetaIoidTheme
import com.metaloid.core.designsystem.MetaType
import com.metaloid.core.designsystem.Space
import com.metaloid.core.session.AuthState
import com.metaloid.di.AppContainer
import com.metaloid.feature.activity.ActivityScreen
import com.metaloid.feature.auth.SignInScreen
import com.metaloid.feature.boot.BootScreen
import com.metaloid.feature.chat.ChatScreen
import com.metaloid.feature.conversations.ConversationsScreen
import com.metaloid.feature.diagnostics.DiagnosticsScreen
import com.metaloid.feature.memory.MemoryScreen
import com.metaloid.feature.missions.MissionDetailScreen
import com.metaloid.feature.missions.MissionsScreen
import com.metaloid.feature.research.ResearchDetailScreen
import com.metaloid.feature.research.ResearchScreen
import com.metaloid.feature.settings.SettingsScreen
import com.metaloid.feature.usage.UsageScreen

/**
 * The app itself: theme, the launch gate, the session gate, and the route stack.
 *
 * There is no third-party navigation library and no route table to keep in sync
 * with the screens — `when (route)` is exhaustive over a sealed interface, so
 * adding a destination without a screen is a compile error rather than a blank
 * page found in QA.
 *
 * Layering: this file may ask [AppViewModel] for anything (it *is* the shell) and
 * it passes the container down to screens. Screens never reach back up; they own
 * their feature ViewModel and render state.
 */
@Composable
fun MetaIoidApp(container: AppContainer, appViewModel: AppViewModel) {
    val preferences by appViewModel.preferences.collectAsStateWithLifecycle()
    val authState by appViewModel.authState.collectAsStateWithLifecycle()
    val system by appViewModel.system.collectAsStateWithLifecycle()
    val routes by appViewModel.routes.collectAsStateWithLifecycle()
    val bootstrapped by appViewModel.bootstrapComplete.collectAsStateWithLifecycle()

    val reducedMotion = preferences.reducedMotionOverride ?: false

    MetaIoidTheme(
        themeMode = preferences.themeMode,
        accentId = preferences.accentId,
        reducedMotion = reducedMotion,
        content = {
            val colors = MetaIoidTheme.colors
            Box(
                Modifier
                    .fillMaxSize()
                    .background(colors.bg),
            ) {
                // Re-check the gateway's capabilities when the app comes back to
                // the foreground. This is the only trigger besides connectivity
                // and an explicit user action; there is no polling anywhere.
                val lifecycleOwner = LocalLifecycleOwner.current
                DisposableEffect(lifecycleOwner) {
                    val observer = LifecycleEventObserver { _, event ->
                        if (event == Lifecycle.Event.ON_RESUME) appViewModel.checkHealth("resume")
                    }
                    lifecycleOwner.lifecycle.addObserver(observer)
                    onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
                }

                when {
                    !bootstrapped -> BootScreen(snapshot = system)
                    authState is AuthState.SignedOut -> SignInScreen(container = container, appViewModel = appViewModel)
                    else -> SignedInShell(
                        container = container,
                        appViewModel = appViewModel,
                        routes = routes,
                    )
                }
            }
        },
    )
}

/** Primary destinations, in the order the product puts them. */
private enum class PrimaryDestination(val route: Route, val label: String, val icon: ImageVector) {
    Conversations(Route.Conversations, "Chats", MetaIcons.Chat),
    Memory(Route.Memory, "Memory", MetaIcons.Memory),
    Missions(Route.Missions, "Missions", MetaIcons.Mission),
    Research(Route.Research, "Research", MetaIcons.Research),
}

@Composable
private fun SignedInShell(container: AppContainer, appViewModel: AppViewModel, routes: List<Route>) {
    val colors = MetaIoidTheme.colors
    val current = routes.lastOrNull() ?: Route.Conversations
    val showBar = current is Route.Conversations || current is Route.Memory ||
        current is Route.Missions || current is Route.Research

    Column(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f)) {
            AnimatedContent(
                targetState = current,
                transitionSpec = {
                    fadeIn(animationSpec = tween(180)) togetherWith fadeOut(animationSpec = tween(120))
                },
                label = "route",
            ) { route ->
                when (route) {
                    is Route.Conversations -> ConversationsScreen(
                        container = container,
                        appViewModel = appViewModel,
                        onOpenConversation = { id -> appViewModel.navigate(Route.Chat(id)) },
                    )
                    is Route.Chat -> ChatScreen(
                        container = container,
                        conversationId = route.conversationId,
                        onBack = { appViewModel.back() },
                    )
                    is Route.Memory -> MemoryScreen(container = container, appViewModel = appViewModel)
                    is Route.Missions -> MissionsScreen(
                        container = container,
                        onOpen = { id -> appViewModel.navigate(Route.MissionDetail(id)) },
                    )
                    is Route.MissionDetail -> MissionDetailScreen(
                        container = container,
                        missionId = route.missionId,
                        onBack = { appViewModel.back() },
                        onOpenMissions = { appViewModel.navigate(Route.Missions) },
                    )
                    is Route.Research -> ResearchScreen(
                        container = container,
                        onOpen = { id -> appViewModel.navigate(Route.ResearchDetail(id)) },
                    )
                    is Route.ResearchDetail -> ResearchDetailScreen(
                        container = container,
                        investigationId = route.investigationId,
                        onBack = { appViewModel.back() },
                    )
                    is Route.Activity -> ActivityScreen(container = container, appViewModel = appViewModel)
                    is Route.Settings -> SettingsScreen(container = container, appViewModel = appViewModel)
                    is Route.Usage -> UsageScreen(container = container, appViewModel = appViewModel)
                    is Route.Diagnostics -> DiagnosticsScreen(appViewModel = appViewModel)
                }
            }
        }
        if (showBar) {
            PrimaryBar(
                selected = current,
                onSelect = { destination -> appViewModel.resetTo(destination.route) },
                onSettings = { appViewModel.navigate(Route.Settings) },
            )
        }
    }
}

/**
 * The bottom bar: four destinations and Settings.
 *
 * It is hidden on a conversation and on a detail screen, because those are
 * full-attention surfaces — a bar under a streaming answer competes with the
 * answer. Every target is at least 48 dp and carries a label, because an icon
 * without a label is a riddle.
 */
@Composable
private fun PrimaryBar(selected: Route, onSelect: (PrimaryDestination) -> Unit, onSettings: () -> Unit) {
    val colors = MetaIoidTheme.colors
    Column {
        MetaDivider(color = colors.borderSubtle)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(colors.bgSubtle)
                .navigationBarsPadding()
                .padding(vertical = Space.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PrimaryDestination.entries.forEach { destination ->
                val isSelected = selected.key == destination.route.key
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .height(Space.touchTarget)
                        .selectable(
                            selected = isSelected,
                            onClick = { onSelect(destination) },
                            role = Role.Tab,
                        ),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Icon(
                        imageVector = destination.icon,
                        contentDescription = destination.label,
                        tint = if (isSelected) colors.accent else colors.fgMuted,
                        modifier = Modifier.height(20.dp),
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        text = destination.label,
                        style = MetaType.micro,
                        color = if (isSelected) colors.accent else colors.fgMuted,
                    )
                }
            }
            Column(
                modifier = Modifier
                    .weight(1f)
                    .height(Space.touchTarget)
                    .selectable(selected = selected is Route.Settings, onClick = onSettings, role = Role.Tab),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Icon(
                    imageVector = Icons.Filled.Settings,
                    contentDescription = "Settings",
                    tint = if (selected is Route.Settings) MetaIoidTheme.colors.accent else MetaIoidTheme.colors.fgMuted,
                    modifier = Modifier.height(20.dp),
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    text = "Settings",
                    style = MetaType.micro,
                    color = if (selected is Route.Settings) MetaIoidTheme.colors.accent else MetaIoidTheme.colors.fgMuted,
                )
            }
        }
    }
}

/** A top bar shared by the secondary screens. */
@Composable
fun MetaTopBar(
    title: String,
    onBack: (() -> Unit)? = null,
    actions: @Composable () -> Unit = {},
) {
    val colors = MetaIoidTheme.colors
    Column {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(colors.bg)
                .statusBarsPadding()
                .padding(horizontal = Space.sm, vertical = Space.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (onBack != null) {
                com.metaloid.core.designsystem.MetaIconButton(
                    icon = Icons.Filled.ArrowBack,
                    contentDescription = "Back",
                    onClick = onBack,
                )
            } else {
                Spacer(Modifier.width(Space.sm))
            }
            Text(
                text = title,
                style = MetaType.title,
                color = colors.fg,
                modifier = Modifier
                    .weight(1f)
                    .padding(start = if (onBack == null) Space.sm else 0.dp),
            )
            actions()
            Spacer(Modifier.width(Space.sm))
        }
        MetaDivider(color = colors.borderSubtle)
    }
}
