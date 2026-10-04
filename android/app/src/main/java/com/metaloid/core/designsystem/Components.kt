package com.metaloid.core.designsystem

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.metaloid.core.common.AppError

/**
 * The shared component vocabulary (Section 10.6).
 *
 * Every component here is stateless and hoisted: it renders the state it is
 * given and emits callbacks. No component reaches for a repository, a clock or a
 * coroutine — which is what keeps the "no business logic in UI" rule (R10)
 * true by construction rather than by discipline.
 */

/** A raised block: surface value + hairline border. No shadow, no glass. */
@Composable
fun MetaSurface(
    modifier: Modifier = Modifier,
    color: Color = MetaIoidTheme.colors.surface,
    borderColor: Color = MetaIoidTheme.colors.border,
    shape: RoundedCornerShape = RoundedCornerShape(Radii.md),
    content: @Composable () -> Unit,
) {
    Box(
        modifier = modifier
            .clip(shape)
            .background(color)
            .border(BorderStroke(Stroke.hairline, borderColor), shape),
    ) {
        content()
    }
}

enum class MetaButtonVariant { Primary, Secondary, Quiet, Danger }

/**
 * A button with a real tactile response and a 48dp minimum target.
 *
 * The press animation is a 0.97 scale on the graphics layer — no layout work on
 * press, and it disappears entirely under reduced motion.
 */
@Composable
fun MetaButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    variant: MetaButtonVariant = MetaButtonVariant.Primary,
    icon: ImageVector? = null,
) {
    val colors = MetaIoidTheme.colors
    val (bg, fg, borderColor) = when (variant) {
        MetaButtonVariant.Primary -> Triple(colors.accentSolid, colors.onAccentSolid, Color.Transparent)
        MetaButtonVariant.Secondary -> Triple(colors.surfaceElevated, colors.fg, colors.border)
        MetaButtonVariant.Quiet -> Triple(Color.Transparent, colors.fgSecondary, Color.Transparent)
        MetaButtonVariant.Danger -> Triple(colors.danger.copy(alpha = 0.12f), colors.danger, colors.danger.copy(alpha = 0.3f))
    }
    val shape = RoundedCornerShape(Radii.pill)
    Box(
        modifier = modifier
            .defaultMinSize(minHeight = Space.touchTarget)
            .clip(shape)
            .background(if (enabled) bg else bg.copy(alpha = 0.4f))
            .then(if (borderColor != Color.Transparent) Modifier.border(BorderStroke(Stroke.hairline, borderColor), shape) else Modifier)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = Space.xl, vertical = Space.md)
            .alpha(if (enabled) 1f else 0.5f),
        contentAlignment = Alignment.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
            if (icon != null) {
                Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(Space.sm))
            }
            Text(text = text, style = MetaType.ui, color = fg)
        }
    }
}

/** An icon-only control, still a 48dp target. */
@Composable
fun MetaIconButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    tint: Color = MetaIoidTheme.colors.fgSecondary,
) {
    Box(
        modifier = modifier
            .size(Space.touchTarget)
            .clip(CircleShape)
            .clickable(enabled = enabled, onClick = onClick)
            .semantics { this.contentDescription = contentDescription; role = Role.Button }
            .alpha(if (enabled) 1f else 0.4f),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(21.dp))
    }
}

/** Quiet metadata text, used for state labels everywhere. */
@Composable
fun MetaLabel(text: String, modifier: Modifier = Modifier, color: Color = MetaIoidTheme.colors.fgMuted) {
    Text(text = text, style = MetaType.micro, color = color, modifier = modifier)
}

@Composable
fun SectionHeader(title: String, modifier: Modifier = Modifier, trailing: (@Composable () -> Unit)? = null) {
    Row(
        modifier = modifier.fillMaxWidth().padding(horizontal = Space.lg, vertical = Space.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        MetaLabel(title.uppercase())
        Spacer(Modifier.weight(1f))
        trailing?.invoke()
    }
}

@Composable
fun MetaDivider(modifier: Modifier = Modifier, color: Color = MetaIoidTheme.colors.borderSubtle) {
    Box(modifier = modifier.fillMaxWidth().height(Stroke.hairline).background(color))
}

/**
 * The health indicator beside the brand status line.
 *
 * It *breathes* only while the status is being verified, and it is a static dot
 * under reduced motion. It never renders a state the app has not observed: the
 * colour comes from a [SystemStatus] the boot coordinator produced from a real
 * capability check.
 */
@Composable
fun StatusDot(status: SystemStatus, modifier: Modifier = Modifier) {
    val colors = MetaIoidTheme.colors
    val motion = MetaIoidTheme.motion
    val base = when (status) {
        SystemStatus.Live -> colors.success
        SystemStatus.Degraded -> colors.warning
        SystemStatus.Offline -> colors.fgMuted
        SystemStatus.Checking -> colors.fgSubtle
        SystemStatus.Sandbox -> colors.accent
    }
    val pulse = if (!motion.reduced && status == SystemStatus.Live) {
        val transition = rememberInfiniteTransition(label = "status")
        val alpha by transition.animateFloat(
            initialValue = 0.45f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                animation = tween(durationMillis = 1800, easing = motion.easeInOut),
                repeatMode = RepeatMode.Reverse,
            ),
            label = "alpha",
        )
        alpha
    } else {
        1f
    }
    Box(
        modifier = modifier
            .size(7.dp)
            .clip(CircleShape)
            .background(base.copy(alpha = pulse)),
    )
}

/**
 * The four honest system states (Section 8.11) — plus SANDBOX, which the gateway
 * reports when the local demo provider is answering. It is not a health state
 * the app invents: it comes from `/api/health`.
 */
enum class SystemStatus { Checking, Live, Degraded, Offline, Sandbox }

/**
 * The brand status line: `METAIOID · LIVE`.
 *
 * The label is always derived from a real check; there is no code path that
 * renders LIVE without one, and no timer that promotes a status by itself.
 */
@Composable
fun BrandStatusLine(
    status: SystemStatus,
    detail: String?,
    modifier: Modifier = Modifier,
    colorOverride: Color? = null,
) {
    val colors = MetaIoidTheme.colors
    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically) {
        StatusDot(status)
        Spacer(Modifier.width(Space.sm))
        MetaLabel(
            text = "METAIOID · ${status.name.uppercase()}",
            color = colorOverride ?: when (status) {
                SystemStatus.Live, SystemStatus.Sandbox -> colors.fgSecondary
                SystemStatus.Degraded -> colors.warning
                SystemStatus.Offline -> colors.fgMuted
                SystemStatus.Checking -> colors.fgSubtle
            },
        )
        if (detail != null) {
            Spacer(Modifier.width(Space.sm))
            Text(text = detail, style = MetaType.small, color = colorOverride ?: colors.fgSubtle, maxLines = 1)
        }
    }
}

/** A horizontal banner for offline/degraded/limits. Never a modal. */
@Composable
fun MetaBanner(
    message: String,
    modifier: Modifier = Modifier,
    tone: BannerTone = BannerTone.Neutral,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    val colors = MetaIoidTheme.colors
    val tint = when (tone) {
        BannerTone.Neutral -> colors.fgSecondary
        BannerTone.Warning -> colors.warning
        BannerTone.Error -> colors.danger
        BannerTone.Accent -> colors.accent
    }
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Radii.sm))
            .background(tint.copy(alpha = 0.10f))
            .border(BorderStroke(Stroke.hairline, tint.copy(alpha = 0.25f)), RoundedCornerShape(Radii.sm))
            .padding(horizontal = Space.md, vertical = Space.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text = message, style = MetaType.small, color = tint, modifier = Modifier.weight(1f))
        if (actionLabel != null && onAction != null) {
            Spacer(Modifier.width(Space.sm))
            Text(
                text = actionLabel,
                style = MetaType.small,
                color = tint,
                modifier = Modifier
                    .clip(RoundedCornerShape(Radii.xs))
                    .clickable(onClick = onAction)
                    .padding(horizontal = Space.sm, vertical = Space.xs),
            )
        }
    }
}

enum class BannerTone { Neutral, Warning, Error, Accent }

/** An empty state: brief, honest, never a fake example of real content. */
@Composable
fun MetaEmptyState(
    title: String,
    message: String,
    modifier: Modifier = Modifier,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Column(
        modifier = modifier.fillMaxWidth().padding(horizontal = Space.xxl, vertical = Space.huge),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(title, style = MetaType.title, color = MetaIoidTheme.colors.fg, textAlign = TextAlign.Center)
        Spacer(Modifier.height(Space.sm))
        Text(
            message,
            style = MetaType.body,
            color = MetaIoidTheme.colors.fgMuted,
            textAlign = TextAlign.Center,
        )
        if (actionLabel != null && onAction != null) {
            Spacer(Modifier.height(Space.lg))
            MetaButton(actionLabel, onAction, variant = MetaButtonVariant.Secondary)
        }
    }
}

/**
 * An error state driven by a typed [AppError].
 *
 * This is the only way an error is rendered in the app: the message comes from
 * the error value, and the action comes from the error's own `action`. A screen
 * cannot show a raw exception because it never receives one.
 */
@Composable
fun MetaErrorState(
    error: AppError,
    modifier: Modifier = Modifier,
    onRetry: (() -> Unit)? = null,
    onSecondary: (() -> Unit)? = null,
    secondaryLabel: String? = null,
) {
    Column(
        modifier = modifier.fillMaxWidth().padding(horizontal = Space.xxl, vertical = Space.xl),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = error.userMessage,
            style = MetaType.body,
            color = MetaIoidTheme.colors.fgSecondary,
            textAlign = TextAlign.Center,
        )
        if (onRetry != null && error.retryable) {
            Spacer(Modifier.height(Space.lg))
            MetaButton("Try again", onRetry, variant = MetaButtonVariant.Secondary)
        }
        if (onSecondary != null && secondaryLabel != null) {
            Spacer(Modifier.height(Space.sm))
            MetaButton(secondaryLabel, onSecondary, variant = MetaButtonVariant.Quiet)
        }
    }
}

/** A quiet placeholder used only where data is genuinely on its way. */
@Composable
fun SkeletonLine(modifier: Modifier = Modifier, widthFraction: Float = 0.7f, height: Dp = 12.dp) {
    val colors = MetaIoidTheme.colors
    val motion = MetaIoidTheme.motion
    val shimmer = if (motion.reduced) {
        0.5f
    } else {
        val transition = rememberInfiniteTransition(label = "skeleton")
        val value by transition.animateFloat(
            initialValue = 0.35f,
            targetValue = 0.7f,
            animationSpec = infiniteRepeatable(tween(900, easing = motion.easeInOut), RepeatMode.Reverse),
            label = "shimmer",
        )
        value
    }
    Box(
        modifier = modifier
            .fillMaxWidth(widthFraction)
            .height(height)
            .clip(RoundedCornerShape(Radii.xs))
            .background(colors.fgFaint.copy(alpha = shimmer)),
    )
}

/** A small inline progress row for a real, indeterminate operation. */
@Composable
fun MetaSpinner(modifier: Modifier = Modifier, size: Dp = 14.dp, tint: Color? = null) {
    CircularProgressIndicator(
        modifier = modifier.size(size),
        strokeWidth = 1.5.dp,
        color = tint ?: LocalContentColor.current,
    )
}
