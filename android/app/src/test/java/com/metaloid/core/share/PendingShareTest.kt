package com.metaloid.core.share

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The shared text's waiting room.
 *
 * Two defects lived here and both were silent: a share arriving while the list
 * was already on screen was never placed, and a share could be given a second
 * conversation when the list was composed again. The rules that prevent them are
 * pure state transitions, so they are pinned here rather than discovered on a
 * device: a share is claimable only by the conversation it was assigned to, and
 * `needsConversation` is false the moment one has been created.
 */
class PendingShareTest {

    @Test
    fun `a share needs a conversation until one is assigned`() {
        PendingShare.put("look at this https://example.com/article")
        assertTrue(PendingShare.hasPending)
        assertTrue(PendingShare.needsConversation)

        PendingShare.assign("conversation-1")
        assertTrue(PendingShare.hasPending)
        assertFalse("a second conversation must not be created", PendingShare.needsConversation)
    }

    @Test
    fun `only the assigned conversation can claim the text, and only once`() {
        PendingShare.put("shared body")
        PendingShare.assign("conversation-1")

        assertNull("another conversation must not steal it", PendingShare.claimFor("conversation-2"))
        assertEquals("shared body", PendingShare.claimFor("conversation-1"))
        assertNull("a share is never replayed into a second conversation", PendingShare.claimFor("conversation-1"))
        assertFalse(PendingShare.hasPending)
    }

    @Test
    fun `an unassigned share cannot be claimed at all`() {
        PendingShare.put("no conversation yet")
        assertNull(PendingShare.claimFor("conversation-1"))
        assertTrue("the text is still waiting, not lost", PendingShare.hasPending)
        assertTrue(PendingShare.needsConversation)
    }

    @Test
    fun `a blank share is not a share`() {
        PendingShare.put("a real share")
        PendingShare.put("   \n  ")
        assertEquals("a real share", PendingShare.title())
    }

    @Test
    fun `a new share replaces the previous one and forgets its conversation`() {
        PendingShare.put("first")
        PendingShare.assign("conversation-1")
        PendingShare.put("second")

        assertTrue("the new share still needs a home", PendingShare.needsConversation)
        assertEquals("second", PendingShare.title())
        assertNull("the old target must not apply to the new text", PendingShare.claimFor("conversation-1"))
    }

    @Test
    fun `the title is the first non-empty line, trimmed and bounded`() {
        PendingShare.put("\n   The headline of the thing I shared   \nand the rest")
        assertEquals("The headline of the thing I shared", PendingShare.title())

        PendingShare.put("x".repeat(200))
        assertEquals(60, PendingShare.title()?.length)
    }
}
