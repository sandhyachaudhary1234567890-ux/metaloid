package com.metaloid

import androidx.compose.ui.test.assertExists
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.fetchSemanticsNodes
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Exercises a real Activity on an emulator, including bootstrap and first-run auth UI. */
@RunWith(AndroidJUnit4::class)
class AppLaunchSmokeTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Test
    fun coldLaunchReachesTheSignedOutScreen() {
        composeRule.waitUntil(timeoutMillis = 45_000) {
            composeRule.onAllNodesWithText("Sign in to continue").fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithText("MetaIoid").assertExists()
        composeRule.onNodeWithText("Sign in to continue").assertExists()
    }
}
