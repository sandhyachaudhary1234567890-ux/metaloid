package com.metaloid

import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Cold-launch smoke test on a real Android emulator. */
@RunWith(AndroidJUnit4::class)
class AppLaunchSmokeTest {
    @get:Rule
    val activity = ActivityScenarioRule(MainActivity::class.java)

    @Test
    fun coldLaunchReachesTheSignedOutScreen() {
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        val signInVisible = device.wait(
            Until.findObject(By.text("Sign in to continue")),
            45_000,
        ) != null
        val hierarchy = if (signInVisible) {
            ""
        } else {
            val dump = File.createTempFile(
                "metaloid-window-",
                ".xml",
                InstrumentationRegistry.getInstrumentation().targetContext.cacheDir,
            )
            device.dumpWindowHierarchy(dump)
            dump.readText().take(6_000)
        }
        assertTrue(
            "The app did not reach its first-run sign-in screen. Window hierarchy: $hierarchy",
            signInVisible,
        )
    }
}
