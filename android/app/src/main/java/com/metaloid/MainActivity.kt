package com.metaloid

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.metaloid.app.AppViewModel
import com.metaloid.app.MetaIoidApp
import com.metaloid.app.Route
import com.metaloid.core.common.MetaLog
import kotlinx.coroutines.launch

/**
 * The one Activity.
 *
 * Thin by rule (R10): it enables edge-to-edge, creates the shell ViewModel, reads
 * the launch intent, and hands everything else to Compose. There is no network
 * call, no parsing and no policy decision in this file.
 *
 * Rotation is handled by the manifest's `configChanges`, so a turn that is
 * streaming keeps streaming and the composer keeps its text without the
 * Activity being torn down mid-stream.
 */
class MainActivity : ComponentActivity() {

    companion object {
        /** Opens the conversation list; sent by the share receiver. */
        const val EXTRA_OPEN_CONVERSATIONS = "com.metaloid.extra.OPEN_CONVERSATIONS"

        /** Opens one conversation directly (used by the share flow). */
        const val EXTRA_CONVERSATION_ID = "com.metaloid.extra.CONVERSATION_ID"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val container = (application as MetaIoidApplication).container
        val factory = viewModelFactory {
            initializer { AppViewModel(application = application, container = container) }
        }
        val appViewModel = ViewModelProvider(this, factory)[AppViewModel::class.java]
        // Idempotent: a second creation (or a share arriving while the app runs)
        // does not re-run the launch sequence.
        lifecycleScope.launch { appViewModel.bootstrap() }
        handleIntent(intent, appViewModel)
        setContent {
            MetaIoidApp(container = container, appViewModel = appViewModel)
        }
        MetaLog.d(TAG, "MainActivity created")
    }

    /**
     * `singleTop`: a share while the app is already open arrives as a new intent
     * rather than a second Activity, and is handled the same way.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val container = (application as MetaIoidApplication).container
        val factory = viewModelFactory {
            initializer { AppViewModel(application = application, container = container) }
        }
        handleIntent(intent, ViewModelProvider(this, factory)[AppViewModel::class.java])
    }

    private fun handleIntent(intent: Intent?, appViewModel: AppViewModel) {
        val conversationId = intent?.getStringExtra(EXTRA_CONVERSATION_ID)
        when {
            !conversationId.isNullOrBlank() -> appViewModel.navigate(Route.Chat(conversationId))
            intent?.getBooleanExtra(EXTRA_OPEN_CONVERSATIONS, false) == true ->
                appViewModel.resetTo(Route.Conversations)
        }
    }

    private companion object {
        const val TAG = "activity"
    }
}
