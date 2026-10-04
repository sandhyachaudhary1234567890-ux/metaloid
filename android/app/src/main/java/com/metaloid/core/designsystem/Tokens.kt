package com.metaloid.core.designsystem

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/**
 * MetaIoid design tokens, mirroring the web client's canonical set
 * (`src/design/tokens.ts` + `src/index.css`).
 *
 * These are copied values, not a redraw: the Android client must look like the
 * same product. Where a value exists in the web tokens it is used verbatim; the
 * mapping is recorded in docs/android/DECISIONS.md.
 *
 * Named by *role*, never by appearance. "surfaceElevated" survives a rebrand;
 * "grey900" does not.
 */
@Immutable
data class MetaIoidColors(
    val isDark: Boolean,
    val bg: Color,
    val bgSubtle: Color,
    val surface: Color,
    val surfaceHover: Color,
    val surfaceActive: Color,
    val surfaceElevated: Color,
    val surfaceSunken: Color,
    val border: Color,
    val borderSubtle: Color,
    val borderStrong: Color,
    val fg: Color,
    val fgSecondary: Color,
    val fgMuted: Color,
    val fgSubtle: Color,
    val fgFaint: Color,
    val accent: Color,
    val accentSolid: Color,
    val onAccentSolid: Color,
    val accentSubtle: Color,
    val accentRing: Color,
    val success: Color,
    val warning: Color,
    val danger: Color,
    val codeSurface: Color,
    val selection: Color,
)

/** Warm Obsidian — the dark page. Never pure black, never blue-grey. */
val ObsidianColors = MetaIoidColors(
    isDark = true,
    bg = Color(0xFF0E0E0D),
    bgSubtle = Color(0xFF141413),
    surface = Color(0xFF171716),
    surfaceHover = Color(0xFF1F1F1C),
    surfaceActive = Color(0xFF272723),
    surfaceElevated = Color(0xFF1B1B1A),
    surfaceSunken = Color(0xFF0A0A09),
    border = Color(0x15F4F0E8),
    borderSubtle = Color(0x0CF4F0E8),
    borderStrong = Color(0x29F4F0E8),
    fg = Color(0xFFF2EFE8),
    fgSecondary = Color(0xFFABA69B),
    fgMuted = Color(0xFF7E796F),
    fgSubtle = Color(0xFF5C5850),
    fgFaint = Color(0xFF403D37),
    accent = Color(0xFF5CC79A),
    accentSolid = Color(0xFF146B4E),
    onAccentSolid = Color(0xFFF2FFF9),
    accentSubtle = Color(0x1F5CC79A),
    accentRing = Color(0x615CC79A),
    success = Color(0xFF4FBE8C),
    warning = Color(0xFFD9A441),
    danger = Color(0xFFE4776B),
    codeSurface = Color(0xFF121211),
    selection = Color(0x4D5CC79A),
)

/** Warm Paper — the light page. Designed as light, not as inverted dark. */
val PaperColors = MetaIoidColors(
    isDark = false,
    bg = Color(0xFFFAF8F4),
    bgSubtle = Color(0xFFF3EFE7),
    surface = Color(0xFFFFFFFF),
    surfaceHover = Color(0xFFF6F2EA),
    surfaceActive = Color(0xFFEDE7DB),
    surfaceElevated = Color(0xFFFFFFFF),
    surfaceSunken = Color(0xFFF1ECE2),
    border = Color(0x15262016),
    borderSubtle = Color(0x0C262016),
    borderStrong = Color(0x29262016),
    fg = Color(0xFF1A1815),
    fgSecondary = Color(0xFF4A453B),
    fgMuted = Color(0xFF766F63),
    fgSubtle = Color(0xFF9B948A),
    fgFaint = Color(0xFFC4BDB2),
    accent = Color(0xFF0B6E52),
    accentSolid = Color(0xFF0B6E52),
    onAccentSolid = Color(0xFFFFFFFF),
    accentSubtle = Color(0x140B6E52),
    accentRing = Color(0x4D0B6E52),
    success = Color(0xFF17795A),
    warning = Color(0xFF8A5F14),
    danger = Color(0xFFB8453A),
    codeSurface = Color(0xFFF3EFE7),
    selection = Color(0x330B6E52),
)

/**
 * Type scale. Nine steps, each named for its job — there are no one-off sizes
 * anywhere in the app, which is the only reason a screen cannot drift.
 *
 * Sizes are the web token's pixel values used as `sp`, so dynamic font scaling
 * behaves as Android users expect (everything scales, nothing is pinned).
 */
object MetaType {
    val hero = TextStyle(fontSize = 34.sp, lineHeight = 40.sp, letterSpacing = (-0.028).em, fontWeight = FontWeight.SemiBold)
    val display = TextStyle(fontSize = 26.sp, lineHeight = 32.sp, letterSpacing = (-0.022).em, fontWeight = FontWeight.SemiBold)
    val heading = TextStyle(fontSize = 21.sp, lineHeight = 28.sp, letterSpacing = (-0.018).em, fontWeight = FontWeight.SemiBold)
    val title = TextStyle(fontSize = 17.sp, lineHeight = 24.sp, letterSpacing = (-0.012).em, fontWeight = FontWeight.SemiBold)
    val read = TextStyle(fontSize = 15.5.sp, lineHeight = 25.sp, letterSpacing = (-0.004).em, fontWeight = FontWeight.Normal)
    val body = TextStyle(fontSize = 14.5.sp, lineHeight = 22.sp, letterSpacing = (-0.002).em, fontWeight = FontWeight.Normal)
    val ui = TextStyle(fontSize = 13.5.sp, lineHeight = 19.sp, fontWeight = FontWeight.Normal)
    val small = TextStyle(fontSize = 12.5.sp, lineHeight = 17.sp, fontWeight = FontWeight.Normal)
    val micro = TextStyle(fontSize = 11.5.sp, lineHeight = 16.sp, letterSpacing = 0.09.em, fontWeight = FontWeight.SemiBold)
    val code = TextStyle(fontSize = 13.sp, lineHeight = 20.sp, fontFamily = FontFamily.Monospace)
}

/** Spacing scale: a 4dp rhythm with a 8dp preference. */
object Space {
    val none: Dp = 0.dp
    val xs: Dp = 4.dp
    val sm: Dp = 8.dp
    val md: Dp = 12.dp
    val lg: Dp = 16.dp
    val xl: Dp = 20.dp
    val xxl: Dp = 24.dp
    val xxxl: Dp = 32.dp
    val huge: Dp = 40.dp
    val giant: Dp = 48.dp
    val massive: Dp = 64.dp

    /** Minimum touch target (accessibility, Section 11). */
    val touchTarget: Dp = 48.dp
}

/** Corner radii — precise and small; no blobs, no glass. */
object Radii {
    val xs: Dp = 6.dp
    val sm: Dp = 8.dp
    val md: Dp = 12.dp
    val lg: Dp = 16.dp
    val xl: Dp = 22.dp
    val pill: Dp = 999.dp
}

/** Hairline borders. Depth comes from surface value, not from shadow. */
object Stroke {
    val hairline: Dp = 1.dp
    val emphasis: Dp = 1.5.dp
}
