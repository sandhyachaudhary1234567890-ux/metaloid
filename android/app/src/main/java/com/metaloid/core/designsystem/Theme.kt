package com.metaloid.core.designsystem

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/** Which page the user asked for. */
enum class ThemeMode { SYSTEM, LIGHT, DARK }

/**
 * Accent choices, mirrored from the web client's Settings.
 *
 * Each accent is pre-split into two jobs, because one value cannot do both: the
 * luminous tone is legible as text on the page but illegible as a button fill,
 * and the deep tone is the reverse. Shipping one value per accent is how accents
 * end up unreadable in one of their two uses.
 */
@Immutable
data class MetaAccent(
    val id: String,
    val label: String,
    val darkAccent: Color,
    val darkSolid: Color,
    val lightAccent: Color,
    val lightSolid: Color,
)

val MetaAccents: List<MetaAccent> = listOf(
    MetaAccent("jade", "Jade", Color(0xFF5CC79A), Color(0xFF146B4E), Color(0xFF0B6E52), Color(0xFF0B6E52)),
    MetaAccent("verdigris", "Verdigris", Color(0xFF6FC7B8), Color(0xFF10685F), Color(0xFF0A6157), Color(0xFF0A6157)),
    MetaAccent("amber", "Amber", Color(0xFFD9A441), Color(0xFF8A5F14), Color(0xFF8A5F14), Color(0xFF8A5F14)),
    MetaAccent("indigo", "Indigo", Color(0xFF8E9BF0), Color(0xFF3B45A8), Color(0xFF3B45A8), Color(0xFF3B45A8)),
    MetaAccent("clay", "Clay", Color(0xFFD08A6E), Color(0xFF8A4630), Color(0xFF8A4630), Color(0xFF8A4630)),
    MetaAccent("graphite", "Graphite", Color(0xFFA6A399), Color(0xFF4A4841), Color(0xFF4A4841), Color(0xFF4A4841)),
)

val DefaultAccent: MetaAccent = MetaAccents.first()

fun accentById(id: String?): MetaAccent = MetaAccents.firstOrNull { it.id == id } ?: DefaultAccent

/** Design tokens, available to every composable without threading parameters. */
val LocalMetaColors = staticCompositionLocalOf { ObsidianColors }
val LocalMotion = staticCompositionLocalOf { MotionConfig.Default }

/**
 * Token access from a composable: `MetaIoidTheme.colors`, `MetaIoidTheme.motion`.
 *
 * `@ReadOnlyComposable` because reading a composition local never writes state —
 * marking it so keeps the call out of the recomposition bookkeeping.
 */
object MetaIoidTheme {
    val colors: MetaIoidColors
        @Composable @ReadOnlyComposable get() = LocalMetaColors.current

    val motion: MotionConfig
        @Composable @ReadOnlyComposable get() = LocalMotion.current
}

/**
 * The app's theme.
 *
 * Material 3 is the foundation, heavily customised: every colour role, text
 * style and shape comes from the MetaIoid tokens, so no default Material look
 * (starting with the purple) survives into the product.
 *
 * Dynamic colour (Material You) is deliberately **not** used: it would repaint
 * the brand with the user's wallpaper, and MetaIoid's identity is a single
 * deliberate accent on a warm neutral ground.
 */
@Composable
fun MetaIoidTheme(
    themeMode: ThemeMode,
    accentId: String?,
    reducedMotion: Boolean,
    content: @Composable () -> Unit,
) {
    val dark = when (themeMode) {
        ThemeMode.SYSTEM -> isSystemInDarkTheme()
        ThemeMode.DARK -> true
        ThemeMode.LIGHT -> false
    }
    val accent = accentById(accentId)
    val base = if (dark) ObsidianColors else PaperColors
    val colors = if (dark) {
        base.copy(
            accent = accent.darkAccent,
            accentSolid = accent.darkSolid,
            accentSubtle = accent.darkAccent.copy(alpha = 0.12f),
            accentRing = accent.darkAccent.copy(alpha = 0.38f),
        )
    } else {
        base.copy(
            accent = accent.lightAccent,
            accentSolid = accent.lightSolid,
            accentSubtle = accent.lightAccent.copy(alpha = 0.08f),
            accentRing = accent.lightAccent.copy(alpha = 0.30f),
        )
    }
    val motion = if (reducedMotion) MotionConfig.Reduced else MotionConfig.Default

    CompositionLocalProvider(
        LocalMetaColors provides colors,
        LocalMotion provides motion,
    ) {
        MaterialTheme(
            colorScheme = colors.toColorScheme(),
            typography = metaIoidTypography(),
            shapes = Shapes(
                extraSmall = RoundedCornerShape(Radii.xs),
                small = RoundedCornerShape(Radii.sm),
                medium = RoundedCornerShape(Radii.md),
                large = RoundedCornerShape(Radii.lg),
                extraLarge = RoundedCornerShape(Radii.xl),
            ),
            content = content,
        )
    }
}

/**
 * Maps the MetaIoid roles onto Material 3's slots.
 *
 * Only the slots Material components actually read are set; anything left at a
 * Material default would be a colour the brand did not choose, which is why the
 * list is explicit rather than "whatever the template had".
 */
private fun MetaIoidColors.toColorScheme() = if (isDark) {
    darkColorScheme(
        primary = accent,
        onPrimary = onAccentSolid,
        primaryContainer = accentSolid,
        onPrimaryContainer = onAccentSolid,
        secondary = fgSecondary,
        onSecondary = bg,
        secondaryContainer = surfaceElevated,
        onSecondaryContainer = fg,
        tertiary = accent,
        onTertiary = onAccentSolid,
        background = bg,
        onBackground = fg,
        surface = surface,
        onSurface = fg,
        surfaceVariant = surfaceElevated,
        onSurfaceVariant = fgSecondary,
        surfaceTint = accent,
        inverseSurface = fg,
        inverseOnSurface = bg,
        error = danger,
        onError = bg,
        errorContainer = danger.copy(alpha = 0.15f),
        onErrorContainer = danger,
        outline = borderStrong,
        outlineVariant = border,
        scrim = Color(0xCC000000),
    )
} else {
    lightColorScheme(
        primary = accent,
        onPrimary = onAccentSolid,
        primaryContainer = accentSolid,
        onPrimaryContainer = onAccentSolid,
        secondary = fgSecondary,
        onSecondary = surface,
        secondaryContainer = surfaceSunken,
        onSecondaryContainer = fg,
        tertiary = accent,
        onTertiary = onAccentSolid,
        background = bg,
        onBackground = fg,
        surface = surface,
        onSurface = fg,
        surfaceVariant = surfaceSunken,
        onSurfaceVariant = fgSecondary,
        surfaceTint = accent,
        inverseSurface = fg,
        inverseOnSurface = surface,
        error = danger,
        onError = Color.White,
        errorContainer = danger.copy(alpha = 0.12f),
        onErrorContainer = danger,
        outline = borderStrong,
        outlineVariant = border,
        scrim = Color(0x66000000),
    )
}

/** The nine-step scale, mapped onto Material's slots so defaults look brand-made. */
private fun metaIoidTypography() = Typography().run {
    copy(
        displayLarge = MetaType.hero,
        displayMedium = MetaType.display,
        displaySmall = MetaType.heading,
        headlineLarge = MetaType.display,
        headlineMedium = MetaType.heading,
        headlineSmall = MetaType.title,
        titleLarge = MetaType.title,
        titleMedium = MetaType.ui,
        titleSmall = MetaType.small,
        bodyLarge = MetaType.read,
        bodyMedium = MetaType.body,
        bodySmall = MetaType.small,
        labelLarge = MetaType.ui,
        labelMedium = MetaType.small,
        labelSmall = MetaType.micro,
    )
}
