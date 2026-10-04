package com.metaloid.data.api

import com.metaloid.core.network.ApiClient
import com.metaloid.core.network.ApiResult
import com.metaloid.core.session.GatewayAuthApi
import com.metaloid.core.session.GatewayRefreshResponse
import com.metaloid.core.session.GatewaySessionResponse
import com.metaloid.data.dto.AckDto
import com.metaloid.data.dto.ApprovalListDto
import com.metaloid.data.dto.AttachmentCreateDto
import com.metaloid.data.dto.AttachmentDto
import com.metaloid.data.dto.AttachmentEnvelope
import com.metaloid.data.dto.AttachmentListDto
import com.metaloid.data.dto.ConversationDto
import com.metaloid.data.dto.ConversationEnvelope
import com.metaloid.data.dto.ConversationListDto
import com.metaloid.data.dto.CredentialDto
import com.metaloid.data.dto.CredentialEnvelope
import com.metaloid.data.dto.CredentialListDto
import com.metaloid.data.dto.FindingListDto
import com.metaloid.data.dto.HealthDto
import com.metaloid.data.dto.JobDto
import com.metaloid.data.dto.JobEnvelope
import com.metaloid.data.dto.JobListDto
import com.metaloid.data.dto.MeDto
import com.metaloid.data.dto.MemoryDto
import com.metaloid.data.dto.MemoryEnvelope
import com.metaloid.data.dto.MemoryListDto
import com.metaloid.data.dto.MessageDto
import com.metaloid.data.dto.MessageEnvelope
import com.metaloid.data.dto.MessageListDto
import com.metaloid.data.dto.MissionDto
import com.metaloid.data.dto.MissionEnvelope
import com.metaloid.data.dto.MissionListDto
import com.metaloid.data.dto.MissionRunDto
import com.metaloid.data.dto.ModelListDto
import com.metaloid.data.dto.ProfileDto
import com.metaloid.data.dto.ProfileEnvelope
import com.metaloid.data.dto.ProviderSettingsDto
import com.metaloid.data.dto.ProviderSettingsEnvelope
import com.metaloid.data.dto.PublicConfigDto
import com.metaloid.data.dto.RecoverDto
import com.metaloid.data.dto.ResearchDto
import com.metaloid.data.dto.ResearchEnvelope
import com.metaloid.data.dto.ResearchListDto
import com.metaloid.data.dto.SignedUrlDto
import com.metaloid.data.dto.TaskDto
import com.metaloid.data.dto.TaskEnvelope
import com.metaloid.data.dto.TaskListDto
import com.metaloid.data.dto.ToolDto
import com.metaloid.data.dto.ToolListDto
import com.metaloid.data.dto.UsageListDto
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The MetaIoid gateway, endpoint by endpoint.
 *
 * This file is the *only* place that knows a path. Screens and repositories call
 * methods with names that describe the product ("rename conversation"), which is
 * what makes the contract map (docs/android/CONTRACT_MAP.md) checkable against
 * the code: every method here has a row there, with its source of confirmation.
 *
 * Two rules are visible in the signatures:
 *   * no method takes a `user_id` — identity is the bearer token, always;
 *   * no method returns or accepts a provider key — only masked metadata exists.
 */
class MetaIoidApi(private val client: ApiClient) : GatewayAuthApi {

    // ── unauthenticated surface ─────────────────────────────────────────────

    suspend fun health(): ApiResult<HealthDto> = client.get("/api/health", serializer = HealthDto.serializer())

    /** Public Supabase identifiers. Nothing else is served here, by design. */
    suspend fun publicConfig(): ApiResult<PublicConfigDto> =
        client.get("/api/config", serializer = PublicConfigDto.serializer())

    // ── identity (gateway-local accounts) ───────────────────────────────────

    override suspend fun signUp(
        handle: String,
        displayName: String,
        passcode: String,
        deviceName: String,
    ): ApiResult<GatewaySessionResponse> = client.post(
        "/api/auth/signup",
        body = buildJsonObject {
            put("handle", handle)
            if (displayName.isNotBlank()) put("displayName", displayName)
            put("passcode", passcode)
            put("deviceName", deviceName)
        },
        serializer = GatewaySessionResponse.serializer(),
    )

    override suspend fun logIn(handle: String, passcode: String, deviceName: String): ApiResult<GatewaySessionResponse> =
        client.post(
            "/api/auth/login",
            body = buildJsonObject {
                put("handle", handle)
                put("passcode", passcode)
                put("deviceName", deviceName)
            },
            serializer = GatewaySessionResponse.serializer(),
        )

    override suspend fun refresh(refreshToken: String): ApiResult<GatewayRefreshResponse> = client.post(
        "/api/auth/refresh",
        body = buildJsonObject { put("refresh", refreshToken) },
        serializer = GatewayRefreshResponse.serializer(),
    )

    override suspend fun logOut(): ApiResult<JsonElement> =
        client.post("/api/auth/logout", serializer = JsonElement.serializer())

    override suspend fun logOutEverywhere(): ApiResult<JsonElement> =
        client.post("/api/auth/logout-all", serializer = JsonElement.serializer())

    suspend fun authMe(): ApiResult<AuthMeDto> = client.get("/api/auth/me", serializer = AuthMeDto.serializer())

    // ── profile ─────────────────────────────────────────────────────────────

    suspend fun me(): ApiResult<MeDto> = client.get("/api/v1/me", serializer = MeDto.serializer())

    suspend fun updateProfile(patch: Map<String, JsonElement>): ApiResult<ProfileEnvelope> =
        client.patch("/api/v1/me", body = JsonObject(patch), serializer = ProfileEnvelope.serializer())

    // ── conversations ───────────────────────────────────────────────────────

    suspend fun listConversations(limit: Int = 30, cursor: String? = null): ApiResult<ConversationListDto> =
        client.get(
            "/api/v1/conversations",
            query = mapOf("limit" to limit.toString(), "cursor" to cursor),
            serializer = ConversationListDto.serializer(),
        )

    suspend fun createConversation(title: String?, model: String? = null, provider: String? = null): ApiResult<ConversationEnvelope> =
        client.post(
            "/api/v1/conversations",
            body = buildJsonObject {
                if (!title.isNullOrBlank()) put("title", title)
                if (model != null) put("model", model)
                if (provider != null) put("provider", provider)
            },
            serializer = ConversationEnvelope.serializer(),
        )

    suspend fun getConversation(id: String): ApiResult<ConversationEnvelope> =
        client.get("/api/v1/conversations/$id", serializer = ConversationEnvelope.serializer())

    suspend fun renameConversation(id: String, title: String): ApiResult<ConversationEnvelope> =
        client.patch(
            "/api/v1/conversations/$id",
            body = buildJsonObject { put("title", title) },
            serializer = ConversationEnvelope.serializer(),
        )

    suspend fun deleteConversation(id: String): ApiResult<AckDto> =
        client.delete("/api/v1/conversations/$id", serializer = AckDto.serializer())

    // ── messages ────────────────────────────────────────────────────────────

    suspend fun listMessages(conversationId: String, limit: Int = 50, cursor: String? = null): ApiResult<MessageListDto> =
        client.get(
            "/api/v1/conversations/$conversationId/messages",
            query = mapOf("limit" to limit.toString(), "cursor" to cursor),
            serializer = MessageListDto.serializer(),
        )

    /**
     * Appends a message. `content` must be non-empty: the server rejects an
     * empty body with 400 `invalid_input`, which is why the app does not create
     * a placeholder assistant row *before* the first token arrives — it creates
     * it when the first token does (see `ChatStreamController`).
     */
    suspend fun appendMessage(
        conversationId: String,
        role: String,
        content: String,
        status: String = "complete",
        model: String? = null,
        provider: String? = null,
        metadata: JsonObject? = null,
    ): ApiResult<MessageEnvelope> = client.post(
        "/api/v1/conversations/$conversationId/messages",
        body = buildJsonObject {
            put("role", role)
            put("content", content)
            put("status", status)
            if (model != null) put("model", model)
            if (provider != null) put("provider", provider)
            if (metadata != null) put("metadata", metadata)
        },
        serializer = MessageEnvelope.serializer(),
    )

    suspend fun updateMessage(
        messageId: String,
        content: String? = null,
        status: String? = null,
        errorCode: String? = null,
        latencyMs: Long? = null,
    ): ApiResult<MessageEnvelope> = client.patch(
        "/api/v1/messages/$messageId",
        body = buildJsonObject {
            if (content != null) put("content", content)
            if (status != null) put("status", status)
            if (errorCode != null) put("error_code", errorCode)
            if (latencyMs != null) put("latency_ms", latencyMs)
        },
        serializer = MessageEnvelope.serializer(),
    )

    /**
     * Closes any message left in `streaming` for this conversation.
     *
     * The server marks them `cancelled` with `error_code: interrupted`, which is
     * how a process death mid-stream becomes an honest state instead of a turn
     * that stays open forever.
     */
    suspend fun recoverMessages(conversationId: String): ApiResult<RecoverDto> =
        client.post(
            "/api/v1/conversations/$conversationId/messages/recover",
            serializer = RecoverDto.serializer(),
        )

    // ── memories ────────────────────────────────────────────────────────────

    suspend fun listMemories(limit: Int = 50, cursor: String? = null, kind: String? = null, query: String? = null): ApiResult<MemoryListDto> =
        client.get(
            "/api/v1/memories",
            query = mapOf("limit" to limit.toString(), "cursor" to cursor, "kind" to kind, "q" to query),
            serializer = MemoryListDto.serializer(),
        )

    suspend fun createMemory(content: String, category: String? = null, kind: String? = null, pinned: Boolean = false): ApiResult<MemoryEnvelope> =
        client.post(
            "/api/v1/memories",
            body = buildJsonObject {
                put("content", content)
                if (category != null) put("category", category)
                if (kind != null) put("kind", kind)
                put("pinned", pinned)
            },
            serializer = MemoryEnvelope.serializer(),
        )

    suspend fun updateMemory(id: String, patch: Map<String, JsonElement>): ApiResult<MemoryEnvelope> =
        client.patch("/api/v1/memories/$id", body = JsonObject(patch), serializer = MemoryEnvelope.serializer())

    suspend fun deleteMemory(id: String): ApiResult<AckDto> =
        client.delete("/api/v1/memories/$id", serializer = AckDto.serializer())

    // ── models, providers, credentials ──────────────────────────────────────

    suspend fun listModels(): ApiResult<ModelListDto> = client.get("/api/models", serializer = ModelListDto.serializer())

    suspend fun providerSettings(): ApiResult<ProviderSettingsEnvelope> =
        client.get("/api/v1/provider/settings", serializer = ProviderSettingsEnvelope.serializer())

    suspend fun updateProviderSettings(
        defaultProvider: String? = null,
        defaultModel: String? = null,
        fallbackEnabled: Boolean? = null,
        freeOnly: Boolean? = null,
    ): ApiResult<ProviderSettingsEnvelope> = client.put(
        "/api/v1/provider/settings",
        body = buildJsonObject {
            if (defaultProvider != null) put("default_provider", defaultProvider)
            if (defaultModel != null) put("default_model", defaultModel)
            if (fallbackEnabled != null) put("fallback_enabled", fallbackEnabled)
            if (freeOnly != null) put("free_only", freeOnly)
        },
        serializer = ProviderSettingsEnvelope.serializer(),
    )

    suspend fun listCredentials(): ApiResult<CredentialListDto> =
        client.get("/api/v1/provider/credentials", serializer = CredentialListDto.serializer())

    /**
     * Stores a provider key. The key is encrypted server-side under
     * `METALOID_ENCRYPTION_KEYS`; it is never echoed back, and the caller is
     * expected to drop its reference to it the moment this returns.
     */
    suspend fun putCredential(provider: String, apiKey: String, label: String? = null): ApiResult<CredentialEnvelope> =
        client.put(
            "/api/v1/provider/credentials/$provider",
            body = buildJsonObject {
                put("api_key", apiKey)
                if (label != null) put("label", label)
            },
            serializer = CredentialEnvelope.serializer(),
        )

    suspend fun deleteCredential(provider: String, label: String? = null): ApiResult<AckDto> =
        client.delete(
            "/api/v1/provider/credentials/$provider",
            body = if (label == null) null else buildJsonObject { put("label", label) },
            serializer = AckDto.serializer(),
        )

    // ── usage ───────────────────────────────────────────────────────────────

    suspend fun listUsage(limit: Int = 50, cursor: String? = null): ApiResult<UsageListDto> =
        client.get(
            "/api/v1/usage",
            query = mapOf("limit" to limit.toString(), "cursor" to cursor),
            serializer = UsageListDto.serializer(),
        )

    /**
     * Usage telemetry for one of *this app's* requests.
     *
     * Never sends prompt or completion text, and never a key — only counts and
     * a stable request id, which is what the endpoint accepts.
     */
    suspend fun postUsage(
        provider: String?,
        model: String?,
        requestId: String?,
        task: String?,
        latencyMs: Long?,
        status: String,
    ): ApiResult<JsonElement> = client.post(
        "/api/v1/usage",
        body = buildJsonObject {
            if (provider != null) put("provider", provider)
            if (model != null) put("model", model)
            if (requestId != null) put("request_id", requestId)
            if (task != null) put("task", task)
            if (latencyMs != null) put("latency_ms", latencyMs)
            put("status", status)
        },
        serializer = JsonElement.serializer(),
    )

    // ── tasks, tool events ──────────────────────────────────────────────────

    suspend fun listTasks(limit: Int = 30, cursor: String? = null, status: String? = null): ApiResult<TaskListDto> =
        client.get(
            "/api/v1/tasks",
            query = mapOf("limit" to limit.toString(), "cursor" to cursor, "status" to status),
            serializer = TaskListDto.serializer(),
        )

    suspend fun createTask(type: String, objective: String?, conversationId: String? = null): ApiResult<TaskEnvelope> =
        client.post(
            "/api/v1/tasks",
            body = buildJsonObject {
                put("type", type)
                if (objective != null) put("objective", objective)
                if (conversationId != null) put("conversation_id", conversationId)
            },
            serializer = TaskEnvelope.serializer(),
        )

    suspend fun getTask(id: String): ApiResult<TaskEnvelope> =
        client.get("/api/v1/tasks/$id", serializer = TaskEnvelope.serializer())

    suspend fun postToolEvent(
        tool: String,
        state: String?,
        detail: String?,
        conversationId: String? = null,
        taskId: String? = null,
    ): ApiResult<JsonElement> = client.post(
        "/api/v1/tool-events",
        body = buildJsonObject {
            put("tool", tool)
            if (state != null) put("state", state)
            if (detail != null) put("detail", detail)
            if (conversationId != null) put("conversation_id", conversationId)
            if (taskId != null) put("task_id", taskId)
        },
        serializer = JsonElement.serializer(),
    )

    suspend fun listTools(): ApiResult<ToolListDto> = client.get("/api/tools", serializer = ToolListDto.serializer())

    // ── missions ────────────────────────────────────────────────────────────

    suspend fun listMissions(): ApiResult<MissionListDto> =
        client.get("/api/missions", serializer = MissionListDto.serializer())

    /** The single active mission, or null when there is none. */
    suspend fun activeMission(): ApiResult<MissionEnvelope> =
        client.get("/api/missions/active", serializer = MissionEnvelope.serializer())

    suspend fun getMission(id: String): ApiResult<MissionEnvelope> =
        client.get("/api/missions/$id", serializer = MissionEnvelope.serializer())

    suspend fun createMission(objective: String, constraints: String? = null): ApiResult<MissionEnvelope> =
        client.post(
            "/api/missions",
            body = buildJsonObject {
                put("objective", objective)
                if (!constraints.isNullOrBlank()) put("constraints", constraints)
            },
            serializer = MissionEnvelope.serializer(),
        )

    suspend fun runMission(id: String): ApiResult<MissionRunDto> =
        client.post("/api/missions/$id/run", serializer = MissionRunDto.serializer())

    suspend fun pauseMission(id: String): ApiResult<MissionEnvelope> =
        client.post("/api/missions/$id/pause", serializer = MissionEnvelope.serializer())

    suspend fun cancelMission(id: String): ApiResult<MissionEnvelope> =
        client.post("/api/missions/$id/cancel", serializer = MissionEnvelope.serializer())

    suspend fun verifyMission(id: String, note: String? = null): ApiResult<MissionEnvelope> =
        client.post(
            "/api/missions/$id/verify",
            body = buildJsonObject { if (!note.isNullOrBlank()) put("note", note) },
            serializer = MissionEnvelope.serializer(),
        )

    suspend fun listApprovals(): ApiResult<ApprovalListDto> =
        client.get("/api/approvals", serializer = ApprovalListDto.serializer())

    suspend fun resolveApproval(id: String, approve: Boolean, note: String? = null): ApiResult<JsonElement> =
        client.post(
            "/api/approvals/$id",
            body = buildJsonObject {
                put("approve", approve)
                if (!note.isNullOrBlank()) put("note", note)
            },
            serializer = JsonElement.serializer(),
        )

    // ── jobs ────────────────────────────────────────────────────────────────

    suspend fun listJobs(): ApiResult<JobListDto> = client.get("/api/jobs", serializer = JobListDto.serializer())

    suspend fun getJob(id: String): ApiResult<JobEnvelope> =
        client.get("/api/jobs/$id", serializer = JobEnvelope.serializer())

    // ── research (OSINT investigations) ─────────────────────────────────────

    suspend fun listResearch(): ApiResult<ResearchListDto> =
        client.get("/api/osint/investigations", serializer = ResearchListDto.serializer())

    suspend fun createResearch(target: String): ApiResult<ResearchDto> =
        client.post(
            "/api/osint/investigations",
            body = buildJsonObject { put("target", target) },
            serializer = ResearchDto.serializer(),
        )

    suspend fun runResearch(id: String): ApiResult<JsonElement> =
        client.post("/api/osint/investigations/$id/run", serializer = JsonElement.serializer())

    suspend fun getResearch(id: String): ApiResult<ResearchDto> =
        client.get("/api/osint/investigations/$id", serializer = ResearchDto.serializer())

    suspend fun researchFindings(id: String, type: String = "all", confidence: String = "all"): ApiResult<FindingListDto> =
        client.get(
            "/api/osint/investigations/$id/findings",
            query = mapOf("type" to type, "confidence" to confidence),
            serializer = FindingListDto.serializer(),
        )

    // ── attachments ─────────────────────────────────────────────────────────

    suspend fun listAttachments(limit: Int = 50, conversationId: String? = null): ApiResult<AttachmentListDto> =
        client.get(
            "/api/v1/attachments",
            query = mapOf("limit" to limit.toString(), "conversation_id" to conversationId),
            serializer = AttachmentListDto.serializer(),
        )

    suspend fun createAttachment(
        filename: String,
        mimeType: String?,
        sizeBytes: Long,
        conversationId: String?,
    ): ApiResult<AttachmentCreateDto> = client.post(
        "/api/v1/attachments",
        body = buildJsonObject {
            put("filename", filename)
            if (mimeType != null) put("mime_type", mimeType)
            put("size_bytes", sizeBytes)
            if (conversationId != null) put("conversation_id", conversationId)
        },
        serializer = AttachmentCreateDto.serializer(),
    )

    suspend fun setAttachmentStatus(id: String, status: String): ApiResult<AttachmentEnvelope> =
        client.patch(
            "/api/v1/attachments/$id",
            body = buildJsonObject { put("status", status) },
            serializer = AttachmentEnvelope.serializer(),
        )

    suspend fun attachmentUrl(id: String, expiresSeconds: Int = 300): ApiResult<SignedUrlDto> =
        client.get(
            "/api/v1/attachments/$id/url",
            query = mapOf("expires" to expiresSeconds.toString()),
            serializer = SignedUrlDto.serializer(),
        )

    suspend fun deleteAttachment(id: String): ApiResult<AckDto> =
        client.delete("/api/v1/attachments/$id", serializer = AckDto.serializer())
}

/**
 * `GET /api/auth/me`.
 *
 * `session` is deliberately unmodelled: the app already knows its own session,
 * and the fewer places a server-echoed token travels through, the better.
 */
@kotlinx.serialization.Serializable
data class AuthMeDto(
    val user: com.metaloid.data.dto.UserDto? = null,
    val profile: ProfileDto? = null,
    val usage: com.metaloid.data.dto.UsageSummaryDto? = null,
)

/** Convenience for the two shapes a `PATCH` body needs. */
internal fun jsonObjectOf(vararg pairs: Pair<String, JsonElement>): JsonObject = buildJsonObject {
    pairs.forEach { (key, value) -> put(key, value) }
}

internal fun stringElement(value: String?): JsonElement? = value?.let { JsonPrimitive(it) }
