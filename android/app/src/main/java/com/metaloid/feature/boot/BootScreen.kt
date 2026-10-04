package com.metaloid.feature.boot

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.metaloid.app.SystemSnapshot
import com.metaloid.core.designsystem.BrandStatusLine
import com.metaloid.core.designsystem.BrandMark
import com.metaloid.core.designsystem.MetaIoidTheme
import com.metaloid.core.designsystem.MetaLabel
import com.metaloid.core.designsystem.MetaType
import com.metaloid.core.designsystem.Space
import com.metaloid.core.designsystem.SystemStatus

/**
 * The launch screen.
 *
 * It is a *state*, not a delay: the app leaves this screen the moment the real
 * work finishes, and it never introduces a wait of its own (there is no timer in
 * this file). The animation is a fade and a 0.96 → 1.0 scale on the brand mark —
 * the web client's boot gesture, at the same duration, and it collapses to an
 * instant state change under reduced motion.
 */
@Composable
fun BootScreen(snapshot: SystemSnapshot, modifier: Modifier = Modifier) {
    val motion = MetaIoidTheme.motion
    val colors = MetaIoidTheme.colors
    var visible by remember { mutableStateOf(false) }
    val progress by animateFloatAsState(
        targetValue = if (visible) 1f else 0f,
        animationSpec = motion.tween(if (motion.reduced) 1 else motion.largeMs),
        label = "boot",
    )
    LaunchedEffect(Unit) { visible = true }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(colors.bg),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            // Tinted with the theme's foreground: the asset is black ink, so on
            // the dark page an untinted mark is invisible (see Brand.kt).
            BrandMark(
                modifier = Modifier
                    .size(72.dp)
                    .alpha(progress)
                    .scale(0.96f + 0.04f * progress),
            )
            Spacer(Modifier.height(Space.xxl))
            Text(
                text = "MetaIoid",
                style = MetaType.title,
                color = colors.fg,
                modifier = Modifier.alpha(progress),
            )
            Spacer(Modifier.height(Space.sm))
            Box(Modifier.width(180.dp), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    BrandStatusLine(status = snapshot.status, detail = snapshot.detail)
                    if (snapshot.status == SystemStatus.Checking) {
                        Spacer(Modifier.height(Space.lg))
                        MetaLabel("checking capabilities", color = colors.fgSubtle)
                    }
                }
            }
        }
        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = Space.giant),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // Honest, and short: this is a status, not a marketing line.
            Text(
                text = if (snapshot.status == SystemStatus.Checking) "connecting to your MetaIoid" else "ready",
                style = MetaType.small,
                color = colors.fgSubtle,
                textAlign = TextAlign.Center,
            )
        }
    }
}
