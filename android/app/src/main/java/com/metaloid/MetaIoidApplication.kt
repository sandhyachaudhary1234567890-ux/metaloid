package com.metaloid

import android.app.Application
import com.metaloid.app.BuildConfig
import com.metaloid.core.common.MetaLog
import com.metaloid.di.AppContainer
import java.lang.Thread.UncaughtExceptionHandler

/**
 * Application entry point. Its whole job is to build the object graph and to
 * make sure a crash is *logged somewhere the user can hand over* — nothing in
 * the app runs from here.
 *
 * Lazy on purpose: the container is created when the first screen asks for it,
 * so the launch path is not blocked by constructing a keystore, a database file
 * or an HTTP client before the first frame is drawn (Section 12).
 */
class MetaIoidApplication : Application() {

    val container: AppContainer by lazy { AppContainer(this) }

    override fun onCreate() {
        super.onCreate()
        MetaLog.verbose = BuildConfig.DEBUG
        installCrashHandler()
        MetaLog.i(TAG, "MetaIoid ${BuildConfig.VERSION_NAME} (${BuildConfig.BUILD_TYPE_NAME}) starting")
    }

    /**
     * Keeps the last crash for the diagnostics screen.
     *
     * The message is passed through [MetaLog.e], which redacts — an exception
     * message is quite capable of containing a URL with a token in it, and a
     * crash report is exactly where that would end up somewhere permanent. The
     * crash is re-thrown to the previous handler so the platform still reports
     * it; this app never swallows a crash.
     */
    private fun installCrashHandler() {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            runCatching {
                MetaLog.e(TAG, "uncaught exception on ${thread.name}", throwable)
            }
            previous?.uncaughtException(thread, throwable)
        }
    }

    private companion object {
        const val TAG = "metaloid"
    }
}
