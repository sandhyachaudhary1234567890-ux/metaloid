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
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val device = UiDevice.getInstance(instrumentation)
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
                instrumentation.targetContext.cacheDir,
            )
            device.dumpWindowHierarchy(dump)
            dump.readText().take(6_000)
        }

        // UiAutomator's hierarchy can be empty even though the Activity was
        // launched. Record the foreground package/root as separate evidence,
        // and save a failure screenshot for the CI helper to pull.
        val currentPackage = runCatching { device.currentPackageName }.getOrNull()
        val screenOn = runCatching { device.isScreenOn }.getOrNull()
        val activeWindow = runCatching {
            instrumentation.uiAutomation.rootInActiveWindow?.let { root ->
                "${root.packageName}/${root.className} children=${root.childCount}"
            } ?: "none"
        }.getOrElse { "unavailable (${it.javaClass.simpleName})" }
        val screenshotPath = if (signInVisible) {
            "not needed"
        } else {
            runCatching {
                val directory = instrumentation.context.getExternalFilesDir(null)
                    ?: return@runCatching "external files directory unavailable"
                val destination = File(directory, "metaloid-smoke-failure.png")
                if (device.takeScreenshot(destination)) destination.absolutePath else "capture failed"
            }.getOrElse { "capture failed (${it.javaClass.simpleName})" }
        }

        assertTrue(
            "The app did not reach its first-run sign-in screen. " +
                "currentPackage=$currentPackage, screenOn=$screenOn, activeWindow=$activeWindow, " +
                "screenshot=$screenshotPath. Window hierarchy: $hierarchy",
            signInVisible,
        )
    }
}
