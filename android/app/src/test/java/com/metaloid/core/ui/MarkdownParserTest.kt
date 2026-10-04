package com.metaloid.core.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Markdown renderer has one hard requirement beyond looking right: it must
 * be correct on *partial* input, because that is what a streaming answer is.
 */
class MarkdownParserTest {

    @Test
    fun `paragraphs are joined and separated by blank lines`() {
        val blocks = MarkdownParser.parseBlocks("first line\nsecond line\n\nnew paragraph")
        assertEquals(2, blocks.size)
        assertEquals("first line second line", (blocks[0] as MarkdownBlock.Paragraph).text)
        assertEquals("new paragraph", (blocks[1] as MarkdownBlock.Paragraph).text)
    }

    @Test
    fun `headings`() {
        val blocks = MarkdownParser.parseBlocks("# One\n## Two\n### Three")
        assertEquals(listOf(1, 2, 3), blocks.map { (it as MarkdownBlock.Heading).level })
    }

    @Test
    fun `bullets keep their depth`() {
        val blocks = MarkdownParser.parseBlocks("- top\n  - nested")
        assertEquals(0, (blocks[0] as MarkdownBlock.BulletItem).depth)
        assertEquals(1, (blocks[1] as MarkdownBlock.BulletItem).depth)
    }

    @Test
    fun `numbered items keep their number and depth`() {
        val blocks = MarkdownParser.parseBlocks("1. first\n   2. nested")
        assertEquals("1", (blocks[0] as MarkdownBlock.NumberedItem).number)
        assertEquals(1, (blocks[1] as MarkdownBlock.NumberedItem).depth)
        assertEquals("nested", (blocks[1] as MarkdownBlock.NumberedItem).text)
    }

    @Test
    fun `a quote and a rule`() {
        val blocks = MarkdownParser.parseBlocks("> quoted\n\n---")
        assertTrue(blocks[0] is MarkdownBlock.Quote)
        assertEquals("quoted", (blocks[0] as MarkdownBlock.Quote).text)
        assertTrue(blocks[1] is MarkdownBlock.Rule)
    }

    @Test
    fun `a closed code fence keeps its language and body`() {
        val blocks = MarkdownParser.parseBlocks("```kotlin\nval x = 1\n```")
        val code = blocks.single() as MarkdownBlock.Code
        assertEquals("kotlin", code.language)
        assertEquals("val x = 1", code.code)
        assertTrue(code.closed)
    }

    @Test
    fun `an unterminated fence is still rendered as code`() {
        val blocks = MarkdownParser.parseBlocks("```python\nprint(\"still arriving\"")
        val code = blocks.single() as MarkdownBlock.Code
        assertEquals("python", code.language)
        assertEquals(false, code.closed)
        assertTrue(code.code.contains("still arriving"))
    }

    @Test
    fun `a code fence swallows blank lines and markdown inside it`() {
        val blocks = MarkdownParser.parseBlocks("```\n# not a heading\n\n**not bold**\n```")
        val code = blocks.single() as MarkdownBlock.Code
        assertTrue(code.code.contains("# not a heading"))
        assertTrue(code.code.contains("**not bold**"))
    }

    @Test
    fun `inline bold, italic and code are styled, and links become annotations`() {
        val annotated = MarkdownParser.inline("**bold** *italic* `code` [label](https://example.com)") { }
        val text = annotated.text
        assertTrue(text.contains("bold"))
        assertTrue(text.contains("italic"))
        assertTrue(text.contains("code"))
        assertTrue(text.contains("label"))
        assertEquals(1, annotated.getStringAnnotations("url", 0, annotated.length).size)
        assertEquals("https://example.com", annotated.getStringAnnotations("url", 0, annotated.length).first().item)
    }

    @Test
    fun `an unclosed emphasis marker stays literal, mid-stream`() {
        val annotated = MarkdownParser.inline("this is *half")
        assertEquals("this is *half", annotated.text)
    }

    @Test
    fun `a link without a caller is rendered as text, not as a url`() {
        val annotated = MarkdownParser.inline("[label](https://example.com)")
        assertEquals("label", annotated.text)
        assertTrue(annotated.getStringAnnotations("url", 0, annotated.length).isEmpty())
    }
}
