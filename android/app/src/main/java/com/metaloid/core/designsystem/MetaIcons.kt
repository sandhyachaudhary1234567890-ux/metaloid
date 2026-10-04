package com.metaloid.core.designsystem

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

/**
 * The handful of icons Material's *core* set does not ship.
 *
 * `material-icons-extended` is a ~2 MB dependency for four glyphs, and R8 would
 * only shrink it back. These are the same 24 dp geometry, declared here so the
 * stroke weight and corner treatment match the rest of the app.
 *
 * Everything else uses `Icons.Filled.*` from the core set (Send, Close, Add,
 * ArrowBack, Check, Delete, MoreVert, Person, Settings, Search, Refresh,
 * Warning, Edit, Share, PlayArrow).
 */
object MetaIcons {

    val Mic: ImageVector by lazy {
        vector(
            "MetaMic",
            "M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" +
                "m5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28" +
                "c3.28-.49 6-3.31 6-6.72h-1.7z",
        )
    }

    val Stop: ImageVector by lazy {
        vector("MetaStop", "M7 7h10v10H7z")
    }

    val Attach: ImageVector by lazy {
        vector(
            "MetaAttach",
            "M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5" +
                "v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5" +
                "c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z",
        )
    }

    val Copy: ImageVector by lazy {
        vector(
            "MetaCopy",
            "M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11" +
                "c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z",
        )
    }

    /** A quiet four-point star: used for "new conversation" and capability marks. */
    val Spark: ImageVector by lazy {
        vector(
            "MetaSpark",
            "M12 2l1.6 6.4L20 10l-6.4 1.6L12 18l-1.6-6.4L4 10l6.4-1.6L12 2z",
        )
    }


    /** A speech bubble: the conversations destination, and every "new chat" affordance. */
    val Chat: ImageVector by lazy {
        vector(
            "MetaChat",
            "M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z",
        )
    }

    /** Stacked planes: what the assistant remembers, in the order it was told. */
    val Memory: ImageVector by lazy {
        vector(
            "MetaMemory",
            "M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z",
        )
    }

    /** A flag: a mission is an objective with an end state, not a chat. */
    val Mission: ImageVector by lazy {
        vector("MetaMission", "M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z")
    }

    /** A flask: research produces findings, and is allowed to be messy. */
    val Research: ImageVector by lazy {
        vector(
            "MetaResearch",
            "M19.8 18.4L14 10.67V6.5l1.35-1.69c.26-.33.03-.81-.39-.81H9.04c-.42 0-.65.48-.39.81L10 6.5v4.17L4.2 18.4" +
                "c-.49.66-.02 1.6.8 1.6h14c.82 0 1.29-.94.8-1.6z",
        )
    }

    /** The jobs/activity log. */
    val History: ImageVector by lazy {
        vector(
            "MetaHistory",
            "M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7" +
                "c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z",
        )
    }

    /** Upload state on an attachment. */
    val CloudUpload: ImageVector by lazy {
        vector(
            "MetaCloudUpload",
            "M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13" +
                "c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z",
        )
    }

    /** An attachment that is confirmed and downloadable. */
    val Download: ImageVector by lazy {
        vector("MetaDownload", "M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z")
    }

    /** Pausing a mission — the one control the core set does not ship. */
    val Pause: ImageVector by lazy {
        vector("MetaPause", "M6 19h4V5H6v14zm8-14v14h4V5h-4z")
    }

    private fun vector(name: String, pathData: String): ImageVector =
        ImageVector.Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).addPath(
            pathData = PathParser().parsePathString(pathData).toNodes(),
            fill = SolidColor(Color.Black),
        ).build()
}
