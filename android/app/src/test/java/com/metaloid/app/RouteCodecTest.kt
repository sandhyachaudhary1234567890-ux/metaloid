package com.metaloid.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The navigation stack is persisted as one string, so a crash in the encoder is
 * a crash on the *next launch* — the worst place to find one. These tests pin
 * the format.
 */
class RouteCodecTest {

    @Test
    fun `round trips a mixed stack`() {
        val stack = listOf(
            Route.Conversations,
            Route.Chat("5f0c1a2e-0000-4000-8000-000000000001"),
            Route.Memory,
        )
        assertEquals(stack, RouteCodec.decode(RouteCodec.encode(stack)))
    }

    @Test
    fun `round trips every route`() {
        val stack = listOf(
            Route.Conversations,
            Route.Chat("c1"),
            Route.Memory,
            Route.Missions,
            Route.MissionDetail("m1"),
            Route.Research,
            Route.ResearchDetail("r1"),
            Route.Activity,
            Route.Settings,
            Route.Usage,
            Route.Diagnostics,
        )
        assertEquals(stack, RouteCodec.decode(RouteCodec.encode(stack)))
    }

    @Test
    fun `an empty or missing value is the empty stack`() {
        assertTrue(RouteCodec.decode(null).isEmpty())
        assertTrue(RouteCodec.decode("").isEmpty())
        assertTrue(RouteCodec.decode("   ").isEmpty())
    }

    @Test
    fun `an unknown segment is dropped, not guessed`() {
        val decoded = RouteCodec.decode("conversations|from-a-newer-build|memory")
        assertEquals(listOf(Route.Conversations, Route.Memory), decoded)
    }

    @Test
    fun `a detail route without its argument is dropped`() {
        assertTrue(RouteCodec.decode("chat").isEmpty())
        assertTrue(RouteCodec.decode("mission").isEmpty())
    }

    @Test
    fun `research and a research detail do not collide`() {
        assertEquals(Route.Research, RouteCodec.decode("research").single())
        assertEquals(Route.ResearchDetail("abc"), RouteCodec.decode("researchDetail:abc").single())
    }

    @Test
    fun `an argument may contain characters that are not separators`() {
        val id = "b0e0-4f1a_9"
        assertEquals(Route.Chat(id), RouteCodec.decode(RouteCodec.encode(listOf(Route.Chat(id)))).single())
    }

    @Test
    fun `keys are stable strings`() {
        assertEquals("conversations", Route.Conversations.key)
        assertEquals("chat:abc", Route.Chat("abc").key)
        assertEquals("settings", Route.Settings.key)
    }
}
