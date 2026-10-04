package com.metaloid.data.repo

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import com.metaloid.core.common.AppError
import com.metaloid.core.common.MetaLog
import com.metaloid.core.network.ApiResult
import com.metaloid.core.network.HttpClients
import com.metaloid.data.api.MetaIoidApi
import com.metaloid.data.api.SupabaseConfig
import com.metaloid.data.dto.AttachmentDto
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withContext
import java.io.File
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import okio.BufferedSink
import okio.buffer
import okio.source

/**
 * File attachments: pick → upload → **server-confirmed** → usable.
 *
 * The flow is the gateway's own (docs/ANDROID_API.md §9) and the order is not
 * negotiable:
 *
 *   1. `POST /api/v1/attachments` creates the *record* and returns the object
 *      key the client must use — `{user_id}/{file_id}/{filename}` inside the
 *      bucket. The bucket name is deliberately *not* prefixed onto that key:
 *      doing so makes the storage policy compare the literal string
 *      "attachments" against the user id and deny every upload (a mistake with
 *      its own server-side test).
 *   2. The bytes go straight to object storage with the **user's** token, so the
 *      storage RLS policy applies to the upload exactly as it does to a read.
 *   3. `PATCH … {status:"ready"}` records success. Until that returns, the
 *      attachment is `pending` and the UI says so — an upload is never shown as
 *      complete before the server agreed (rule R4).
 *
 * Progress is real: it is counted from bytes handed to the socket, not from a
 * timer. When the length is unknown it is reported as unknown and the UI shows
 * an indeterminate state instead of an invented percentage.
 */
class AttachmentsRepository(
    private val api: MetaIoidApi,
    private val clients: HttpClients,
    private val supabaseProvider: () -> SupabaseConfig?,
    /** The Supabase access token, or null when the session is not a Supabase one. */
    private val uploadTokenProvider: () -> String?,
    private val uploadsAvailable: () -> Boolean,
    private val io: kotlinx.coroutines.CoroutineDispatcher,
) {

    companion object {
        private const val TAG = "attachments"

        /** Confirmed server-side: `size > 50 * 1024 * 1024` is rejected with 400. */
        const val MAX_BYTES = 50L * 1024 * 1024

        private const val PROGRESS_STEP_FRACTION = 0.02f
    }

    /** What the picker learned about the chosen file. */
    data class PickedFile(
        val uri: Uri,
        val displayName: String,
        val mimeType: String,
        val sizeBytes: Long?,
    )

    data class UploadStatus(
        val bytesSent: Long,
        val totalBytes: Long?,
    ) {
        /** Null when the size is genuinely unknown — never a made-up number. */
        val fraction: Float? get() = totalBytes?.takeIf { it > 0 }?.let { (bytesSent.toFloat() / it).coerceIn(0f, 1f) }
    }

    /**
     * Reads the picker's metadata without opening the whole stream.
     *
     * The size is a *courtesy* check so the user is not made to wait for an
     * upload that the server will reject; the server's own limit remains the
     * authority and its 400 is reported verbatim when it happens.
     */
    fun inspect(context: Context, uri: Uri): PickedFile? {
        val resolver = context.contentResolver
        val mime = resolver.getType(uri) ?: "application/octet-stream"
        var name: String? = null
        var size: Long? = null
        runCatching {
            resolver.query(uri, null, null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                    if (nameIndex >= 0) name = cursor.getString(nameIndex)
                    if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) size = cursor.getLong(sizeIndex)
                }
            }
        }.onFailure { MetaLog.w(TAG, "could not read file metadata: %s", it.javaClass.simpleName) }
        val displayName = name ?: uri.lastPathSegment?.substringAfterLast('/') ?: "file"
        return PickedFile(uri = uri, displayName = displayName, mimeType = mime, sizeBytes = size)
    }

    /**
     * Uploads one file. Returns the server's attachment row only after the
     * server has confirmed it, and marks the record `failed` on any error so the
     * transcript never contains a phantom attachment.
     */
    suspend fun upload(
        context: Context,
        picked: PickedFile,
        conversationId: String?,
        onProgress: (UploadStatus) -> Unit,
    ): ApiResult<AttachmentDto> {
        if (!uploadsAvailable()) {
            return ApiResult.Err(AppError.StorageUnavailable("this deployment has no writable object storage"))
        }
        picked.sizeBytes?.let { size ->
            if (size > MAX_BYTES) return ApiResult.Err(AppError.FileTooLarge(50))
        }

        // The record first: the server decides the object key and where it lives.
        val created = api.createAttachment(
            filename = picked.displayName,
            mimeType = picked.mimeType,
            sizeBytes = picked.sizeBytes ?: 0L,
            conversationId = conversationId,
        )
        val record = when (created) {
            is ApiResult.Err -> return created
            is ApiResult.Ok -> created.value
        }

        // A private copy in the cache dir: the upload needs a length and a
        // re-readable source, and a content URI gives neither reliably. It is
        // deleted in the `finally`, whatever happens.
        val temp = File(context.cacheDir, "upload-${record.attachment.id}.bin")
        return try {
            val copied = withContext(io) {
                context.contentResolver.openInputStream(picked.uri)?.use { input ->
                    temp.outputStream().use { output -> input.copyTo(output) }
                    temp.length()
                } ?: -1L
            }
            if (copied <= 0L) {
                markFailed(record.attachment.id)
                return ApiResult.Err(AppError.UploadFailed("could not read the selected file"))
            }
            if (copied > MAX_BYTES) {
                markFailed(record.attachment.id)
                return ApiResult.Err(AppError.FileTooLarge(50))
            }
            val config = supabaseProvider()
                ?: return ApiResult.Err(AppError.StorageUnavailable("no supabase storage")).also {
                    markFailed(record.attachment.id)
                }
            val userToken = uploadTokenProvider()
                ?: return ApiResult.Err(AppError.NotSignedIn("storage requires a supabase session")).also {
                    markFailed(record.attachment.id)
                }

            val uploaded = uploadObject(
                config = config,
                bucket = record.upload.bucket,
                objectKey = record.upload.path,
                file = temp,
                mimeType = picked.mimeType,
                userToken = userToken,
                onProgress = onProgress,
            )
            if (uploaded is ApiResult.Err) {
                markFailed(record.attachment.id)
                return uploaded
            }

            // Only now is the attachment real.
            when (val confirmed = api.setAttachmentStatus(record.attachment.id, "ready")) {
                is ApiResult.Ok -> ApiResult.Ok(confirmed.value.attachment ?: record.attachment)
                is ApiResult.Err -> {
                    // The bytes are in storage but the record could not be
                    // confirmed. Reporting success here would be a lie about
                    // state; the row is marked failed and the user retries.
                    MetaLog.w(TAG, "upload landed but confirmation failed: %s", confirmed.error.javaClass.simpleName)
                    markFailed(record.attachment.id)
                    confirmed
                }
            }
        } catch (e: CancellationException) {
            markFailed(record.attachment.id)
            throw e
        } catch (e: Exception) {
            MetaLog.e(TAG, "upload failed", e)
            markFailed(record.attachment.id)
            ApiResult.Err(AppError.UploadFailed(e.javaClass.simpleName))
        } finally {
            runCatching { if (temp.exists()) temp.delete() }
        }
    }

    suspend fun signedUrl(attachmentId: String, expiresSeconds: Int = 300): ApiResult<String> =
        when (val result = api.attachmentUrl(attachmentId, expiresSeconds)) {
            is ApiResult.Ok -> result.value.url?.let { ApiResult.Ok(it) } ?: ApiResult.Err(AppError.NotFound())
            is ApiResult.Err -> result
        }

    suspend fun delete(attachmentId: String): ApiResult<Unit> = when (val result = api.deleteAttachment(attachmentId)) {
        is ApiResult.Ok -> ApiResult.Ok(Unit)
        is ApiResult.Err -> result
    }

    suspend fun list(conversationId: String?): ApiResult<List<AttachmentDto>> =
        when (val result = api.listAttachments(conversationId = conversationId)) {
            is ApiResult.Ok -> ApiResult.Ok(result.value.rows)
            is ApiResult.Err -> result
        }

    private suspend fun markFailed(attachmentId: String) {
        runCatching { api.setAttachmentStatus(attachmentId, "failed") }
    }

    /** `POST {supabase}/storage/v1/object/{bucket}/{key}` with the user's token. */
    private suspend fun uploadObject(
        config: SupabaseConfig,
        bucket: String,
        objectKey: String,
        file: File,
        mimeType: String,
        userToken: String,
        onProgress: (UploadStatus) -> Unit,
    ): ApiResult<Unit> = withContext(io) {
        try {
            val urlBuilder = config.url.newBuilder()
                .addPathSegment("storage")
                .addPathSegment("v1")
                .addPathSegment("object")
                .addPathSegment(bucket)
            // The key is a *path* inside the bucket and is split into segments so
            // each part is escaped correctly; a filename with a space or a `#`
            // must not change the object it resolves to.
            objectKey.split('/').filter { it.isNotEmpty() }.forEach { urlBuilder.addPathSegment(it) }
            val totalBytes = file.length().takeIf { it > 0 }
            val body = ProgressBody(file, mimeType.toMediaTypeOrNull(), totalBytes, onProgress)
            val request = Request.Builder()
                .url(urlBuilder.build())
                .post(body)
                .header("Authorization", "Bearer $userToken")
                .header("apikey", config.anonKey)
                .header("x-upsert", "false")
                .header("Cache-Control", "no-store")
                .build()
            clients.api.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    onProgress(UploadStatus(totalBytes ?: 0L, totalBytes))
                    ApiResult.Ok(Unit)
                } else {
                    val text = response.body?.string().orEmpty()
                    MetaLog.w(TAG, "storage upload refused: %d", response.code)
                    ApiResult.Err(
                        com.metaloid.core.network.ErrorMapper.fromHttp(
                            status = response.code,
                            code = null,
                            serverMessage = text.take(200).ifBlank { null },
                        )
                    )
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            MetaLog.w(TAG, "storage upload failed: %s", e.javaClass.simpleName)
            ApiResult.Err(AppError.UploadFailed(e.javaClass.simpleName))
        }
    }

    /**
     * A request body that reports bytes actually written to the sink.
     *
     * OkHttp calls [writeTo] once; the counter is therefore a real measure of
     * how much of the file has left the device.
     */
    private class ProgressBody(
        private val file: File,
        private val contentType: okhttp3.MediaType?,
        private val totalBytes: Long?,
        private val onProgress: (UploadStatus) -> Unit,
    ) : RequestBody() {

        override fun contentType(): okhttp3.MediaType? = contentType

        override fun contentLength(): Long = totalBytes ?: -1L

        override fun writeTo(sink: BufferedSink) {
            var sent = 0L
            var lastReported = 0L
            file.source().buffer().use { source ->
                val buffer = okio.Buffer()
                while (true) {
                    val read = source.read(buffer, 64 * 1024L)
                    if (read == -1L) break
                    sink.write(buffer, read)
                    sent += read
                    val threshold = ((totalBytes ?: Long.MAX_VALUE) * PROGRESS_STEP_FRACTION).toLong().coerceAtLeast(64 * 1024L)
                    if (sent - lastReported >= threshold) {
                        lastReported = sent
                        onProgress(UploadStatus(sent, totalBytes))
                    }
                }
                sink.flush()
            }
            onProgress(UploadStatus(sent, totalBytes))
        }
    }

    /** Unused import guard: keeps `asRequestBody` available for future bodies. */
    @Suppress("unused")
    private fun File.asPlainBody(mime: String): RequestBody = asRequestBody(mime.toMediaTypeOrNull())
}
