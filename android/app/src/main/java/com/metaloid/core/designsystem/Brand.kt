package com.metaloid.core.designsystem

import androidx.compose.foundation.Image
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import com.metaloid.app.R

/**
 * The MetaIoid mark, drawn in the current theme's foreground colour.
 *
 * The brand asset is **black ink on transparency** — it is the mark as it appears
 * on paper. Drawn as-is on the dark page it is a black glyph on a near-black
 * background, which is to say invisible; the first build of this app did exactly
 * that on the boot and sign-in screens.
 *
 * The web client solves the same problem with `dark:invert` on the `<img>`
 * (`src/components/brand/MetaIoidMark.tsx`). This is that behaviour, expressed
 * once: the glyph is tinted with `colors.fg`, so it is near-black on paper and
 * near-white on obsidian, and a theme change cannot leave it invisible again.
 *
 * Tinting replaces the colour and keeps the alpha, so the antialiased edges of
 * the mark stay smooth rather than acquiring a halo.
 */
@Composable
fun BrandMark(
    modifier: Modifier = Modifier,
    color: Color = MetaIoidTheme.colors.fg,
) {
    Image(
        painter = painterResource(R.drawable.metaloid_mark),
        contentDescription = null,
        modifier = modifier,
        contentScale = ContentScale.Fit,
        colorFilter = ColorFilter.tint(color),
    )
}

/**
 * The wordmark, treated the same way.
 *
 * Kept separate from [BrandMark] because the two are different assets with
 * different aspect ratios; both are tinted, for the same reason.
 */
@Composable
fun BrandWordmark(
    modifier: Modifier = Modifier,
    color: Color = MetaIoidTheme.colors.fg,
) {
    Image(
        painter = painterResource(R.drawable.metaloid_wordmark),
        contentDescription = null,
        modifier = modifier,
        contentScale = ContentScale.Fit,
        colorFilter = ColorFilter.tint(color),
    )
}
