package com.metaloid.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.metaloid.core.designsystem.MetaIcons
import com.metaloid.core.designsystem.MetaIoidTheme
import com.metaloid.core.designsystem.MetaType
import com.metaloid.core.designsystem.Radii
import com.metaloid.core.designsystem.Space
import com.metaloid.core.designsystem.Stroke

/**
 * A small, fast Markdown renderer for assistant prose.
 *
 * Written here rather than pulled in: the shapes that matter in this product are
 * headings, lists, fenced code, inline code, emphasis, links, blockquotes and
 * rules. A full CommonMark engine would be a large dependency and — more to the
 * point — would need re-parsing the whole message on every streamed token, which
 * is precisely the jank this project must avoid (Section 7.6).
 *
 * Two properties make it stream-friendly:
 *   * [parseBlocks] is pure and cheap: one pass, no regex backtracking, no
 *     allocation of intermediate trees;
 *   * the parse result is memoised per (text) by the caller's `remember`, so a
 *     token arriving every 50 ms re-parses a few hundred characters, not the
 *     whole conversation.
 *
 * The parser is deliberately tolerant: an unterminated code fence renders as a
 * code block (that is what a streamed code block looks like mid-flight), and a
 * lone `*` stays a literal asterisk.
 */
@Immutable
sealed interface MarkdownBlock {
    data class Paragraph(val text: String) : MarkdownBlock
    data class Heading(val level: Int, val text: String) : MarkdownBlock
    data class BulletItem(val depth: Int, val text: String) : MarkdownBlock
    data class NumberedItem(val depth: Int, val number: String, val text: String) : MarkdownBlock
    data class Quote(val text: String) : MarkdownBlock
    data class Code(val language: String?, val code: String, val closed: Boolean) : MarkdownBlock
    data object Rule : MarkdownBlock
}

object MarkdownParser {

    fun parseBlocks(source: String): List<MarkdownBlock> {
        val lines = source.split('\n')
        val blocks = mutableListOf<MarkdownBlock>()
        val paragraph = StringBuilder()
        val code = StringBuilder()
        var inCode = false
        var codeLanguage: String? = null

        fun flushParagraph() {
            if (paragraph.isNotEmpty()) {
                blocks += MarkdownBlock.Paragraph(paragraph.toString().trim())
                paragraph.setLength(0)
            }
        }

        for (line in lines) {
            val trimmed = line.trimStart()
            if (inCode) {
                if (trimmed.startsWith("```")) {
                    blocks += MarkdownBlock.Code(codeLanguage, code.toString().trimEnd('\n'), closed = true)
                    code.setLength(0)
                    inCode = false
                    codeLanguage = null
                } else {
                    code.append(line).append('\n')
                }
                continue
            }
            when {
                trimmed.startsWith("```") -> {
                    flushParagraph()
                    inCode = true
                    codeLanguage = trimmed.removePrefix("```").trim().take(24).ifBlank { null }
                }
                trimmed.isBlank() -> flushParagraph()
                trimmed.startsWith("---") && trimmed.length <= 4 -> {
                    flushParagraph()
                    blocks += MarkdownBlock.Rule
                }
                headingPrefix(trimmed) != null -> {
                    flushParagraph()
                    val (level, text) = headingPrefix(trimmed)!!
                    blocks += MarkdownBlock.Heading(level, text)
                }
                trimmed.startsWith("> ") || trimmed == ">" -> {
                    flushParagraph()
                    blocks += MarkdownBlock.Quote(trimmed.removePrefix(">").trim())
                }
                bulletPrefix(line) != null -> {
                    flushParagraph()
                    val (depth, text) = bulletPrefix(line)!!
                    blocks += MarkdownBlock.BulletItem(depth, text)
                }
                numberedPrefix(line) != null -> {
                    flushParagraph()
                    val (depth, number, text) = numberedPrefix(line)!!
                    blocks += MarkdownBlock.NumberedItem(depth, number, text)
                }
                else -> {
                    if (paragraph.isNotEmpty()) paragraph.append(' ')
                    paragraph.append(trimmed)
                }
            }
        }
        // A stream that is still open: render the partial code as code, because
        // that is what it is.
        if (inCode) blocks += MarkdownBlock.Code(codeLanguage, code.toString().trimEnd('\n'), closed = false)
        flushParagraph()
        return blocks
    }

    private fun headingPrefix(line: String): Pair<Int, String>? {
        var level = 0
        while (level < line.length && level < 6 && line[level] == '#') level += 1
        if (level == 0 || level >= line.length || line[level] != ' ') return null
        return level to line.substring(level + 1).trim()
    }

    private fun bulletPrefix(line: String): Pair<Int, String>? {
        val body = line.trimStart()
        // Depth is the indentation of the *original* line: two spaces per level.
        val depth = (line.length - body.length) / 2
        for (marker in listOf("- ", "* ", "+ ")) {
            if (body.startsWith(marker)) return depth to body.removePrefix(marker)
        }
        return null
    }

    private fun numberedPrefix(line: String): Triple<Int, String, String>? {
        val body = line.trimStart()
        val depth = (line.length - body.length) / 2
        val dot = body.indexOf(". ")
        if (dot in 1..3) {
            val number = body.substring(0, dot)
            if (number.all { it.isDigit() }) return Triple(depth, number, body.substring(dot + 2))
        }
        return null
    }

    /**
     * Inline spans: `**bold**`, `*italic*`, `` `code` ``, `[text](url)`.
     *
     * Links are rendered as *text* here and opened by the caller, which passes a
     * validated URL to the platform — never a raw string from a model
     * (Section 8.2, safe link handling).
     */
    fun inline(text: String, onLink: ((String) -> Unit)? = null): AnnotatedString {
        val colors = com.metaloid.core.designsystem.ObsidianColors
        return buildAnnotatedString {
            var i = 0
            while (i < text.length) {
                when {
                    text.startsWith("**", i) -> {
                        val end = text.indexOf("**", i + 2)
                        if (end > 0) {
                            withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(text.substring(i + 2, end)) }
                            i = end + 2
                        } else {
                            append(text[i]); i += 1
                        }
                    }
                    text.startsWith("`", i) -> {
                        val end = text.indexOf('`', i + 1)
                        if (end > 0) {
                            withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = colors.fgFaint)) {
                                append(text.substring(i + 1, end))
                            }
                            i = end + 1
                        } else {
                            append(text[i]); i += 1
                        }
                    }
                    text.startsWith("[", i) -> {
                        val close = text.indexOf(']', i)
                        val open = if (close > 0) text.indexOf('(', close) else -1
                        val urlEnd = if (open == close + 1) text.indexOf(')', open) else -1
                        if (close > 0 && open == close + 1 && urlEnd > open) {
                            val label = text.substring(i + 1, close)
                            val url = text.substring(open + 1, urlEnd).trim()
                            if (onLink != null && url.isNotBlank()) {
                                pushStringAnnotation(tag = "url", annotation = url)
                                withStyle(SpanStyle(color = colors.accent, textDecoration = TextDecoration.Underline)) { append(label) }
                                pop()
                            } else {
                                withStyle(SpanStyle(color = colors.accent, textDecoration = TextDecoration.Underline)) { append(label) }
                            }
                            i = urlEnd + 1
                        } else {
                            append(text[i]); i += 1
                        }
                    }
                    text.startsWith("*", i) -> {
                        val end = text.indexOf('*', i + 1)
                        if (end > 0) {
                            withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(text.substring(i + 1, end)) }
                            i = end + 1
                        } else {
                            append(text[i]); i += 1
                        }
                    }
                    else -> {
                        append(text[i]); i += 1
                    }
                }
            }
        }
    }
}

/**
 * Renders a message body.
 *
 * `onLink` receives a URL the caller must validate before anything opens it:
 * this function does not know about Intents, and it does not decide policy.
 */
@Composable
fun MarkdownText(
    text: String,
    modifier: Modifier = Modifier,
    onLink: ((String) -> Unit)? = null,
    color: Color = MetaIoidTheme.colors.fg,
) {
    val blocks = remember(text) { MarkdownParser.parseBlocks(text) }
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(Space.sm)) {
        blocks.forEach { block ->
            when (block) {
                is MarkdownBlock.Heading -> Text(
                    text = MarkdownParser.inline(block.text, onLink),
                    style = when (block.level) {
                        1 -> MetaType.heading
                        2 -> MetaType.title
                        else -> MetaType.body
                    },
                    color = color,
                )
                is MarkdownBlock.Paragraph -> Text(
                    text = MarkdownParser.inline(block.text, onLink),
                    style = MetaType.read,
                    color = color,
                )
                is MarkdownBlock.BulletItem -> Row(Modifier.padding(start = (block.depth * 14).dp)) {
                    Text("•", style = MetaType.read, color = MetaIoidTheme.colors.fgMuted, modifier = Modifier.width(Space.lg))
                    Text(MarkdownParser.inline(block.text, onLink), style = MetaType.read, color = color)
                }
                is MarkdownBlock.NumberedItem -> Row(Modifier.padding(start = (block.depth * 14).dp)) {
                    Text("${block.number}.", style = MetaType.read, color = MetaIoidTheme.colors.fgMuted, modifier = Modifier.width(Space.xl))
                    Text(MarkdownParser.inline(block.text, onLink), style = MetaType.read, color = color)
                }
                is MarkdownBlock.Quote -> Row(Modifier.height(IntrinsicSize.Min)) {
                    Box(
                        Modifier
                            .fillMaxHeight()
                            .width(2.dp)
                            .background(MetaIoidTheme.colors.borderStrong)
                    )
                    Spacer(Modifier.width(Space.md))
                    Text(MarkdownParser.inline(block.text, onLink), style = MetaType.body, color = MetaIoidTheme.colors.fgSecondary)
                }
                is MarkdownBlock.Rule -> Box(
                    Modifier
                        .fillMaxWidth()
                        .height(Stroke.hairline)
                        .background(MetaIoidTheme.colors.border)
                )
                is MarkdownBlock.Code -> CodeBlock(block.language, block.code, block.closed)
            }
        }
    }
}

/**
 * A fenced code block: language label, copy button, horizontal scroll — never a
 * wrapped line of code (wrapping code is how indentation silently lies).
 */
@Composable
fun CodeBlock(language: String?, code: String, closed: Boolean, modifier: Modifier = Modifier) {
    val colors = MetaIoidTheme.colors
    val clipboard = LocalClipboardManager.current
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Radii.sm))
            .background(colors.codeSurface)
            .border(Stroke.hairline, colors.border, RoundedCornerShape(Radii.sm)),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = Space.md, end = Space.xs, top = Space.xs, bottom = Space.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = language ?: (if (closed) "code" else "code · still arriving"),
                style = MetaType.micro,
                color = colors.fgSubtle,
            )
            Spacer(Modifier.weight(1f))
            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(Radii.xs))
                    .clickable { clipboard.setText(AnnotatedString(code)) }
                    .padding(horizontal = Space.sm, vertical = Space.xs),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(MetaIcons.Copy, contentDescription = null, tint = colors.fgMuted, modifier = Modifier.size(13.dp))
                Spacer(Modifier.width(Space.xs))
                Text("Copy", style = MetaType.small, color = colors.fgMuted)
            }
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = Space.md, vertical = Space.sm),
        ) {
            Text(text = code, style = MetaType.code, color = colors.fg)
        }
    }
}
