package com.metaloid.data.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * Wire types.
 *
 * Every field is either nullable or has a default, because the gateway is
 * deployed independently of the APK: a client must survive a server that adds,
 * drops or renames an optional field (forward compatibility, Section 7.2). A
 * field that is genuinely required by the *contract* is non-null, and a missing
 * one is then a real error the caller handles.
 *
 * Shapes are confirmed against the repository, never guessed. The file:line
 * for each is recorded in docs/android/CONTRACT_MAP.md.
 */

// ── health, config ──────────────────────────────────────────────────────────

@Serializable
data class HealthDto(
    val ok: Boolean = false,
    val server: Boolean = false,
    val build: String? = null,
    /** A reply can plausibly be produced right now. */
    val ai: Boolean = false,
    val degraded: Boolean = false,
    val provider: String? = null,
    val voice: Boolean = false,
    val vision: Boolean = false,
    val realtime: Boolean = false,
    val database: Boolean = false,
    val auth: AuthStateDto? = null,
    /** This caller's own connected provider keys, when the shared path is not answering. */
    val byok: Boolean = false,
    @SerialName("byokProviders") val byokProviders: List<String> = emptyList(),
    @SerialName("byokStored") val byokStored: List<String> = emptyList(),
    @SerialName("byokUnreadable") val byokUnreadable: List<String> = emptyList(),
    @SerialName("byokRejected") val byokRejected: List<String> = emptyList(),
    @SerialName("byokError") val byokError: String? = null,
    val storage: StorageDto? = null,
    val data: DataDriverDto? = null,
    val encryption: EncryptionDto? = null,
    val models: ModelsSummaryDto? = null,
    val at: String? = null,
)

@Serializable
data class AuthStateDto(
    val configured: Boolean = false,
    val mode: String? = null,
    val reachable: Boolean = true,
)

@Serializable
data class StorageDto(
    val ready: Boolean = false,
    val driver: String? = null,
)

@Serializable
data class DataDriverDto(
    val driver: String? = null,
    @SerialName("supabase_configured") val supabaseConfigured: Boolean = false,
    @SerialName("url_set") val urlSet: Boolean = false,
)

@Serializable
data class EncryptionDto(
    val configured: Boolean = false,
    @SerialName("active_key") val activeKey: String? = null,
    val error: String? = null,
)

@Serializable
data class ModelsSummaryDto(
    val free: Int = 0,
    val total: Int = 0,
    val catalogue: Boolean = false,
    val at: String? = null,
)

/** `GET /api/config` — the two public Supabase values, or nulls. */
@Serializable
data class PublicConfigDto(
    val supabaseUrl: String? = null,
    val supabaseAnonKey: String? = null,
    val configured: Boolean = false,
)

// ── profile ─────────────────────────────────────────────────────────────────

@Serializable
data class MeDto(
    val user: UserDto? = null,
    val profile: ProfileDto? = null,
)

@Serializable
data class UserDto(
    val id: String,
    val email: String? = null,
    val handle: String? = null,
    @SerialName("displayName") val displayName: String? = null,
)

@Serializable
data class ProfileDto(
    @SerialName("display_name") val displayName: String? = null,
    @SerialName("avatar_url") val avatarUrl: String? = null,
    @SerialName("onboarding_completed") val onboardingCompleted: Boolean = false,
    @SerialName("preferred_provider") val preferredProvider: String? = null,
    @SerialName("preferred_model") val preferredModel: String? = null,
    val theme: String? = null,
    @SerialName("voice_preference") val voicePreference: String? = null,
    @SerialName("memory_preference") val memoryPreference: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
)

@Serializable
data class ProfileEnvelope(val profile: ProfileDto? = null)

// ── conversations and messages ──────────────────────────────────────────────

@Serializable
data class ConversationDto(
    val id: String,
    val title: String = "New conversation",
    val model: String? = null,
    val provider: String? = null,
    val archived: Boolean = false,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
)

@Serializable
data class ConversationEnvelope(val conversation: ConversationDto? = null)

@Serializable
data class ConversationListDto(
    val rows: List<ConversationDto> = emptyList(),
    @SerialName("next_cursor") val nextCursor: String? = null,
)

@Serializable
data class MessageDto(
    val id: String,
    @SerialName("conversation_id") val conversationId: String? = null,
    val role: String = "user",
    val content: String = "",
    val model: String? = null,
    val provider: String? = null,
    /** `streaming · complete · cancelled · error` */
    val status: String = "complete",
    @SerialName("error_code") val errorCode: String? = null,
    val metadata: JsonObject? = null,
    val tokens: Int? = null,
    @SerialName("latency_ms") val latencyMs: Long? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
)

@Serializable
data class MessageEnvelope(val message: MessageDto? = null)

@Serializable
data class MessageListDto(
    val rows: List<MessageDto> = emptyList(),
    @SerialName("next_cursor") val nextCursor: String? = null,
)

@Serializable
data class RecoverDto(val recovered: Int = 0)

// ── memories ────────────────────────────────────────────────────────────────

@Serializable
data class MemoryDto(
    val id: String,
    val content: String = "",
    val category: String = "Personal",
    val kind: String = "explicit",
    val pinned: Boolean = false,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
)

@Serializable
data class MemoryEnvelope(val memory: MemoryDto? = null)

@Serializable
data class MemoryListDto(
    val rows: List<MemoryDto> = emptyList(),
    @SerialName("next_cursor") val nextCursor: String? = null,
)

// ── provider settings, credentials, models ──────────────────────────────────

@Serializable
data class ProviderSettingsDto(
    @SerialName("default_provider") val defaultProvider: String? = null,
    @SerialName("default_model") val defaultModel: String? = null,
    @SerialName("fallback_enabled") val fallbackEnabled: Boolean = true,
    @SerialName("free_only") val freeOnly: Boolean = true,
)

@Serializable
data class ProviderSettingsEnvelope(val settings: ProviderSettingsDto? = null)

@Serializable
data class CredentialDto(
    val id: String,
    val provider: String = "",
    val label: String = "default",
    /** Always a mask. No endpoint returns a raw key, and none ever will. */
    val masked: String? = null,
    /** `connected · invalid · unverified` */
    val status: String = "unverified",
    @SerialName("key_version") val keyVersion: String? = null,
    @SerialName("last_checked_at") val lastCheckedAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
)

@Serializable
data class CredentialEnvelope(val credential: CredentialDto? = null)

@Serializable
data class CredentialListDto(val credentials: List<CredentialDto> = emptyList())

/** A gateway model row. `unavailable` means the provider rejected the slug recently. */
@Serializable
data class ModelDto(
    val id: String,
    val name: String? = null,
    val tier: String? = null,
    val free: Boolean = true,
    val unavailable: Boolean = false,
    val context: Int? = null,
    val description: String? = null,
)

@Serializable
data class ModelListDto(
    val models: List<ModelDto> = emptyList(),
    val provider: String? = null,
    @SerialName("free_only") val freeOnly: Boolean = true,
    /** True when the gateway is relaying a sandbox/mock provider, not a real one. */
    val mock: Boolean = false,
)

/** Provider manifests and model rows come only from the authenticated backend catalogue. */
@Serializable
data class ProviderCatalogDto(val providers: List<ProviderManifestDto> = emptyList())

@Serializable
data class ProviderManifestDto(
    val providerId: String,
    val name: String = "",
    val category: String? = null,
    val adapter: Boolean = false,
    /** `api_key`, `bearer_token`, or another backend-declared auth shape. */
    val authType: String? = null,
    val modelCount: Int? = null,
    val documentationUrl: String? = null,
    val pricingUrl: String? = null,
)

@Serializable
data class ProviderModelDto(
    val modelId: String,
    val displayName: String? = null,
    val capabilities: JsonElement? = null,
    val contextLimit: Int? = null,
    /** Null means the backend did not supply pricing information. */
    val free: Boolean? = null,
    val unavailable: Boolean? = null,
    val availability: String? = null,
    val pricing: JsonElement? = null,
)

@Serializable
data class ProviderModelsDto(val models: List<ProviderModelDto> = emptyList())

@Serializable
data class ProviderCredentialMetadataDto(
    val id: String,
    val providerId: String = "",
    val isActive: Boolean = true,
    val createdAt: String? = null,
    val redacted: String? = null,
    val status: String = "unverified",
)

@Serializable
data class ProviderCredentialMetadataListDto(
    val credentials: List<ProviderCredentialMetadataDto> = emptyList(),
)

@Serializable
data class ProviderCredentialTestDto(
    val ok: Boolean = false,
    val status: String? = null,
    val code: String? = null,
    val detail: String? = null,
    val error: String? = null,
    val latencyMs: Long? = null,
)

@Serializable
data class ProviderHelpDto(
    val providerId: String = "",
    val name: String = "",
    val keyUrl: String? = null,
    val docsUrl: String? = null,
    val pricingUrl: String? = null,
    val steps: List<String> = emptyList(),
)

@Serializable
data class ProviderModelRefreshDto(
    val ok: Boolean = false,
    val count: Int = 0,
    val live: Boolean = false,
)

// ── usage ───────────────────────────────────────────────────────────────────

@Serializable
data class UsageRowDto(
    val id: String? = null,
    val provider: String? = null,
    val model: String? = null,
    @SerialName("request_id") val requestId: String? = null,
    val task: String? = null,
    @SerialName("tokens_in") val tokensIn: Int? = null,
    @SerialName("tokens_out") val tokensOut: Int? = null,
    @SerialName("latency_ms") val latencyMs: Long? = null,
    val status: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
)

@Serializable
data class UsageListDto(
    val rows: List<UsageRowDto> = emptyList(),
    @SerialName("next_cursor") val nextCursor: String? = null,
)

/** One bucket of the plan summary: real counts recorded server-side. */
@Serializable
data class UsageBucketDto(
    @SerialName("usedToday") val usedToday: Long = 0,
    @SerialName("usedMonth") val usedMonth: Long = 0,
    /** `"unlimited"` or a number — modelled as JsonElement because both are legal. */
    val limit: JsonElement? = null,
)

@Serializable
data class UsageSummaryDto(
    val plan: String? = null,
    val label: String? = null,
    val chat: UsageBucketDto? = null,
    val missions: UsageBucketDto? = null,
    val osint: UsageBucketDto? = null,
    @SerialName("voice-min") val voiceMinutes: UsageBucketDto? = null,
)

// ── tasks, tool events ──────────────────────────────────────────────────────

@Serializable
data class TaskDto(
    val id: String,
    val type: String? = null,
    val objective: String? = null,
    /** `queued · running · done · error · cancelled` */
    val status: String = "queued",
    val progress: Int? = null,
    val result: JsonElement? = null,
    val error: String? = null,
    @SerialName("conversation_id") val conversationId: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
)

@Serializable
data class TaskEnvelope(val task: TaskDto? = null)

@Serializable
data class TaskListDto(
    val rows: List<TaskDto> = emptyList(),
    @SerialName("next_cursor") val nextCursor: String? = null,
)

// ── missions ────────────────────────────────────────────────────────────────

@Serializable
data class MissionTaskDto(
    val id: String,
    val title: String? = null,
    val status: String = "QUEUED",
    val args: JsonObject? = null,
    val deps: List<String> = emptyList(),
    val attempts: Int? = null,
    val startedAt: String? = null,
    val finishedAt: String? = null,
    val output: JsonElement? = null,
    val error: String? = null,
)

@Serializable
data class MissionTimelineDto(
    val at: String? = null,
    val event: String? = null,
    val detail: String? = null,
)

@Serializable
data class MissionCheckpointDto(
    val at: String? = null,
    val note: String? = null,
    val done: Int? = null,
    val total: Int? = null,
)

@Serializable
data class MissionDto(
    val id: String,
    val objective: String = "",
    val constraints: JsonElement? = null,
    /** `QUEUED · RUNNING · PAUSED · BLOCKED · COMPLETED · FAILED · CANCELLED · VERIFIED` */
    val status: String = "QUEUED",
    val tasks: List<MissionTaskDto> = emptyList(),
    val timeline: List<MissionTimelineDto> = emptyList(),
    val checkpoints: List<MissionCheckpointDto> = emptyList(),
    val result: JsonElement? = null,
    val error: String? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
)

@Serializable
data class MissionEnvelope(val mission: MissionDto? = null)

@Serializable
data class MissionListDto(
    val missions: List<MissionDto> = emptyList(),
    val total: Int? = null,
    val limit: Int? = null,
    val offset: Int? = null,
)

/** `POST /api/missions/:id/run` → 202 `{ id, status, jobId }` */
@Serializable
data class MissionRunDto(
    val id: String? = null,
    val status: String? = null,
    @SerialName("jobId") val jobId: String? = null,
)

// ── jobs ────────────────────────────────────────────────────────────────────

@Serializable
data class JobDto(
    val id: String,
    val kind: String? = null,
    val label: String? = null,
    /** `queued · running · done · error` */
    val status: String = "queued",
    val createdAt: String? = null,
    val startedAt: String? = null,
    val endedAt: String? = null,
    val result: JsonElement? = null,
    val error: String? = null,
)

@Serializable
data class JobEnvelope(val job: JobDto? = null)

@Serializable
data class JobListDto(
    val jobs: List<JobDto> = emptyList(),
    val total: Int? = null,
)

// ── research (OSINT investigations) ─────────────────────────────────────────

@Serializable
data class ResearchCollectorDto(
    val id: String? = null,
    val name: String? = null,
    val state: String? = null,
)

@Serializable
data class ResearchTimelineDto(
    val at: String? = null,
    val event: String? = null,
    val detail: String? = null,
)

@Serializable
data class ResearchFindingDto(
    val type: String? = null,
    val value: String? = null,
    val source: String? = null,
    @SerialName("source_url") val sourceUrl: String? = null,
    val confidence: String? = null,
    val evidence: String? = null,
)

@Serializable
data class ResearchDto(
    val id: String,
    val target: String = "",
    val type: String? = null,
    val status: String = "queued",
    /** A real percentage reported by the server. Never computed client-side. */
    val progress: Int? = null,
    val collectors: List<ResearchCollectorDto> = emptyList(),
    val timeline: List<ResearchTimelineDto> = emptyList(),
    @SerialName("finding_count") val findingCount: Int? = null,
)

@Serializable
data class ResearchEnvelope(val investigation: ResearchDto? = null)

@Serializable
data class ResearchListDto(val investigations: List<ResearchDto> = emptyList())

@Serializable
data class FindingListDto(val findings: List<ResearchFindingDto> = emptyList())

// ── attachments ─────────────────────────────────────────────────────────────

@Serializable
data class AttachmentDto(
    val id: String,
    val filename: String = "",
    @SerialName("mime_type") val mimeType: String? = null,
    @SerialName("size_bytes") val sizeBytes: Long? = null,
    /** `pending · ready · failed` */
    val status: String = "pending",
    val bucket: String? = null,
    @SerialName("storage_path") val storagePath: String? = null,
    @SerialName("conversation_id") val conversationId: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
)

/** `POST /api/v1/attachments` → `{ attachment, upload: { bucket, path, storage_path } }` */
@Serializable
data class AttachmentCreateDto(
    val attachment: AttachmentDto,
    val upload: UploadTargetDto,
)

@Serializable
data class UploadTargetDto(
    val bucket: String,
    /**
     * The key *inside* the bucket: `{user_id}/{file_id}/{filename}`. This is what
     * the storage API takes; prefixing the bucket name onto it makes the storage
     * policy compare `attachments` against the user id and deny every upload.
     */
    val path: String,
    @SerialName("storage_path") val storagePath: String? = null,
)

@Serializable
data class AttachmentEnvelope(val attachment: AttachmentDto? = null)

@Serializable
data class AttachmentListDto(
    val rows: List<AttachmentDto> = emptyList(),
    @SerialName("next_cursor") val nextCursor: String? = null,
)

@Serializable
data class SignedUrlDto(
    val url: String? = null,
    val expires: Int? = null,
    @SerialName("expires_in") val expiresIn: Int? = null,
)

// ── tool events, approvals, tools ───────────────────────────────────────────

@Serializable
data class ToolEventDto(
    val id: String? = null,
    val tool: String? = null,
    val state: String? = null,
    val detail: String? = null,
    @SerialName("conversation_id") val conversationId: String? = null,
    @SerialName("task_id") val taskId: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
)

@Serializable
data class ToolDto(
    val id: String? = null,
    val name: String? = null,
    val description: String? = null,
)

@Serializable
data class ToolListDto(val tools: List<ToolDto> = emptyList())

@Serializable
data class ApprovalDto(
    val id: String,
    val missionId: String? = null,
    val tool: String? = null,
    val detail: String? = null,
    val status: String? = null,
    val createdAt: String? = null,
)

@Serializable
data class ApprovalListDto(val pending: List<ApprovalDto> = emptyList())

/** Generic `{ ok: true }`-style acknowledgement. */
@Serializable
data class AckDto(
    val ok: Boolean = true,
    val deleted: Boolean? = null,
    val recovered: Int? = null,
)
