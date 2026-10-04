package com.metaloid.feature.share

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import com.metaloid.MainActivity
import com.metaloid.core.common.MetaLog
import com.metaloid.core.share.PendingShare

/**
 * The share-sheet target.
 *
 * It has no UI and finishes immediately: its entire job is to take the text,
 * hand it to [PendingShare], and bring the app forward. Everything else (creating
 * the conversation, opening it, putting the text in the composer) happens in the
 * app's own screens, so there is exactly one implementation of "start a
 * conversation".
 *
 * Only `text/plain` is accepted, and only `EXTRA_TEXT` is read. Nothing from
 * another app reaches the filesystem or the uploader through this path.
 */
class ShareReceiverActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val shared = when (intent?.action) {
            Intent.ACTION_SEND -> intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
            Intent.ACTION_PROCESS_TEXT -> intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)?.toString()
            else -> null
        }
        PendingShare.put(shared)
        MetaLog.i(TAG, "share received: %s", if (PendingShare.hasPending) "text" else "nothing usable")

        startActivity(
            Intent(this, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                putExtra(MainActivity.EXTRA_OPEN_CONVERSATIONS, true)
            },
        )
        finish()
    }

    private companion object {
        const val TAG = "share"
    }
}
