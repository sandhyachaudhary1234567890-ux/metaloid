package com.metaloid.feature.library

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.metaloid.core.common.AppError
import com.metaloid.core.common.MetaLog
import com.metaloid.core.network.ApiResult
import com.metaloid.data.dto.JobDto
import com.metaloid.data.dto.MemoryDto
import com.metaloid.data.dto.MissionDto
import com.metaloid.data.dto.ResearchDto
import com.metaloid.data.dto.ResearchFindingDto
import com.metaloid.data.dto.UsageRowDto
import com.metaloid.di.AppContainer
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * The read-mostly feature ViewModels, in one file.
 *
 * Each of these is a thin mapping from one endpoint to one screen state: load,
 * expose, retry, and mutate where the server actually supports a mutation. They
 * are together because they are the same shape and together they are shorter
 * than the boilerplate of five files; the moment one of them grows real logic it
 * gets its own file (that is what happened to chat and conversations).
 *
 * The rule all of them follow: **nothing is derived that the server did not
 * report**. No progress bar is computed locally, no mission is marked complete
 * by the client, no memory is shown as saved before the POST returned.
 */

// ── memory ──────────────────────────────────────────────────────────────────

class MemoryViewModel(private val container: AppContainer) : ViewModel() {

    data class UiState(
        val memories: List<MemoryDto> = emptyList(),
        val loading: Boolean = false,
        val error: AppError? = null,
        val query: String = "",
        val busyId: String? = null,
    ) {
        val visible: List<MemoryDto>
            get() = if (query.isBlank()) {
                memories
            } else {
                val needle = query.trim().lowercase()
                memories.filter { it.content.lowercase().contains(needle) || it.category.lowercase().contains(needle) }
            }
    }

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    fun load() {
        if (_state.value.loading) return
        _state.value = _state.value.copy(loading = true, error = null)
        viewModelScope.launch {
            when (val result = container.api.listMemories(limit = 100)) {
                is ApiResult.Ok -> _state.value = _state.value.copy(
                    memories = result.value.rows,
                    loading = false,
                    error = null,
                )
                is ApiResult.Err -> _state.value = _state.value.copy(loading = false, error = result.error)
            }
        }
    }

    fun onQueryChange(value: String) {
        _state.value = _state.value.copy(query = value)
    }

    /** Adding a memory is a server write; it appears in the list only once stored. */
    fun add(content: String, category: String?) {
        val trimmed = content.trim()
        if (trimmed.isEmpty()) return
        viewModelScope.launch {
            when (val result = container.api.createMemory(trimmed, category = category)) {
                is ApiResult.Ok -> {
                    val created = result.value.memory
                    if (created != null) {
                        _state.value = _state.value.copy(memories = listOf(created) + _state.value.memories)
                    } else {
                        load()
                    }
                }
                is ApiResult.Err -> _state.value = _state.value.copy(error = result.error)
            }
        }
    }

    fun togglePin(memory: MemoryDto) {
        _state.value = _state.value.copy(busyId = memory.id)
        viewModelScope.launch {
            val patch = mapOf<String, kotlinx.serialization.json.JsonElement>(
                "pinned" to kotlinx.serialization.json.JsonPrimitive(!memory.pinned),
            )
            when (val result = container.api.updateMemory(memory.id, patch)) {
                is ApiResult.Ok -> {
                    val updated = result.value.memory
                    _state.value = _state.value.copy(
                        memories = _state.value.memories.map {
                            if (it.id == memory.id) updated ?: it.copy(pinned = !memory.pinned) else it
                        },
                        busyId = null,
                    )
                }
                is ApiResult.Err -> _state.value = _state.value.copy(busyId = null, error = result.error)
            }
        }
    }

    fun delete(memory: MemoryDto) {
        val previous = _state.value.memories
        _state.value = _state.value.copy(memories = previous.filterNot { it.id == memory.id })
        viewModelScope.launch {
            when (val result = container.api.deleteMemory(memory.id)) {
                is ApiResult.Ok -> Unit
                is ApiResult.Err -> _state.value = _state.value.copy(memories = previous, error = result.error)
            }
        }
    }

    fun dismissError() {
        _state.value = _state.value.copy(error = null)
    }
}

// ── missions ────────────────────────────────────────────────────────────────

class MissionsViewModel(private val container: AppContainer) : ViewModel() {

    companion object {
        private const val TAG = "missions"
        private const val POLL_INTERVAL_MS = 4_000L

        /** States in which the server is still working on a mission. */
        val LIVE_STATUSES = setOf("QUEUED", "RUNNING", "PAUSED", "BLOCKED")
    }

    data class UiState(
        val missions: List<MissionDto> = emptyList(),
        val detail: MissionDto? = null,
        val loading: Boolean = false,
        val refreshing: Boolean = false,
        val error: AppError? = null,
        val busy: Boolean = false,
        /** True while a mission in a live state is being polled. */
        val polling: Boolean = false,
    )

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()
    private var detailJob: kotlinx.coroutines.Job? = null

    fun load() {
        if (_state.value.loading) return
        _state.value = _state.value.copy(loading = _state.value.missions.isEmpty(), error = null)
        viewModelScope.launch {
            when (val result = container.api.listMissions()) {
                is ApiResult.Ok -> _state.value = _state.value.copy(
                    missions = result.value.missions,
                    loading = false,
                    refreshing = false,
                    error = null,
                )
                is ApiResult.Err -> {
                    MetaLog.w(TAG, "list failed: %s", result.error.javaClass.simpleName)
                    _state.value = _state.value.copy(loading = false, refreshing = false, error = result.error)
                }
            }
        }
    }

    fun create(objective: String, constraints: String?) {
        val trimmed = objective.trim()
        if (trimmed.isEmpty()) return
        _state.value = _state.value.copy(busy = true, error = null)
        viewModelScope.launch {
            when (val result = container.api.createMission(trimmed, constraints?.trim()?.ifBlank { null })) {
                is ApiResult.Ok -> {
                    val created = result.value.mission
                    _state.value = _state.value.copy(
                        busy = false,
                        missions = if (created != null) listOf(created) + _state.value.missions else _state.value.missions,
                    )
                    if (created == null) load()
                }
                is ApiResult.Err -> _state.value = _state.value.copy(busy = false, error = result.error)
            }
        }
    }

    /**
     * Opens a mission and, while it is in a live state, polls it.
     *
     * Polling is the only honest way to follow a server-side job this API does
     * not stream (`/api/missions/:id` is a plain GET), so it is explicit, it is
     * stopped when the mission reaches a terminal state, and the UI says it is
     * refreshing.
     */
    fun openDetail(id: String) {
        detailJob?.cancel()
        _state.value = _state.value.copy(detail = null, loading = true, error = null)
        detailJob = viewModelScope.launch {
            while (true) {
                when (val result = container.api.getMission(id)) {
                    is ApiResult.Ok -> {
                        val mission = result.value.mission
                        _state.value = _state.value.copy(detail = mission, loading = false, error = null)
                        if (mission == null || mission.status !in LIVE_STATUSES) {
                            _state.value = _state.value.copy(polling = false)
                            break
                        }
                        _state.value = _state.value.copy(polling = true)
                    }
                    is ApiResult.Err -> {
                        _state.value = _state.value.copy(loading = false, polling = false, error = result.error)
                        break
                    }
                }
                kotlinx.coroutines.delay(POLL_INTERVAL_MS)
            }
        }
    }

    fun run(id: String) = act(id) { container.api.runMission(it) }

    fun pause(id: String) = act(id) { container.api.pauseMission(it) }

    fun cancel(id: String) = act(id) { container.api.cancelMission(it) }

    fun verify(id: String, note: String?) = act(id) { container.api.verifyMission(it, note) }

    private fun act(id: String, block: suspend (String) -> ApiResult<*>) {
        _state.value = _state.value.copy(busy = true, error = null)
        viewModelScope.launch {
            when (val result = block(id)) {
                is ApiResult.Ok -> {
                    _state.value = _state.value.copy(busy = false)
                    openDetail(id)
                }
                is ApiResult.Err -> {
                    MetaLog.w(TAG, "mission action failed: %s", result.error.javaClass.simpleName)
                    _state.value = _state.value.copy(busy = false, error = result.error)
                }
            }
        }
    }

    fun dismissError() {
        _state.value = _state.value.copy(error = null)
    }

    override fun onCleared() {
        detailJob?.cancel()
        super.onCleared()
    }

}

// ── research ────────────────────────────────────────────────────────────────

class ResearchViewModel(private val container: AppContainer) : ViewModel() {

    data class UiState(
        val investigations: List<ResearchDto> = emptyList(),
        val detail: ResearchDto? = null,
        val findings: List<ResearchFindingDto> = emptyList(),
        val loading: Boolean = false,
        val error: AppError? = null,
        val busy: Boolean = false,
    )

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    fun load() {
        if (_state.value.loading) return
        _state.value = _state.value.copy(loading = true, error = null)
        viewModelScope.launch {
            when (val result = container.api.listResearch()) {
                is ApiResult.Ok -> _state.value = _state.value.copy(
                    investigations = result.value.investigations,
                    loading = false,
                    error = null,
                )
                is ApiResult.Err -> _state.value = _state.value.copy(loading = false, error = result.error)
            }
        }
    }

    fun create(target: String) {
        val trimmed = target.trim()
        if (trimmed.isEmpty()) return
        _state.value = _state.value.copy(busy = true, error = null)
        viewModelScope.launch {
            when (val result = container.api.createResearch(trimmed)) {
                is ApiResult.Ok -> {
                    _state.value = _state.value.copy(busy = false, investigations = listOf(result.value) + _state.value.investigations)
                }
                is ApiResult.Err -> _state.value = _state.value.copy(busy = false, error = result.error)
            }
        }
    }

    /** Starts an investigation the server already knows about. */
    fun run(id: String) {
        _state.value = _state.value.copy(busy = true, error = null)
        viewModelScope.launch {
            when (val result = container.api.runResearch(id)) {
                is ApiResult.Ok -> {
                    _state.value = _state.value.copy(busy = false)
                    openDetail(id)
                }
                is ApiResult.Err -> _state.value = _state.value.copy(busy = false, error = result.error)
            }
        }
    }

    /**
     * Opens one investigation: its record and the findings it has produced.
     *
     * Findings come from `POST /api/osint/investigations/:id/findings` returning
     * `{findings: […]}`; an empty list is reported as "no findings yet", never
     * filled with an example (Section 6).
     */
    fun openDetail(id: String) {
        _state.value = _state.value.copy(loading = true, error = null, findings = emptyList())
        viewModelScope.launch {
            val detail = container.api.getResearch(id)
            when (detail) {
                is ApiResult.Ok -> _state.value = _state.value.copy(detail = detail.value, loading = false)
                is ApiResult.Err -> {
                    _state.value = _state.value.copy(loading = false, error = detail.error)
                    return@launch
                }
            }
            when (val findings = container.api.researchFindings(id)) {
                is ApiResult.Ok -> _state.value = _state.value.copy(findings = findings.value.findings)
                is ApiResult.Err -> _state.value = _state.value.copy(error = findings.error)
            }
        }
    }

    fun dismissError() {
        _state.value = _state.value.copy(error = null)
    }
}

// ── activity (jobs) ─────────────────────────────────────────────────────────

class ActivityViewModel(private val container: AppContainer) : ViewModel() {

    data class UiState(
        val jobs: List<JobDto> = emptyList(),
        val loading: Boolean = false,
        val error: AppError? = null,
    )

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    fun load() {
        if (_state.value.loading) return
        _state.value = _state.value.copy(loading = true, error = null)
        viewModelScope.launch {
            when (val result = container.api.listJobs()) {
                is ApiResult.Ok -> _state.value = _state.value.copy(jobs = result.value.jobs, loading = false)
                is ApiResult.Err -> _state.value = _state.value.copy(loading = false, error = result.error)
            }
        }
    }
}

// ── usage ───────────────────────────────────────────────────────────────────

class UsageViewModel(private val container: AppContainer) : ViewModel() {

    data class UiState(
        val rows: List<UsageRowDto> = emptyList(),
        val summary: com.metaloid.data.dto.UsageSummaryDto? = null,
        val planLabel: String? = null,
        val loading: Boolean = false,
        val error: AppError? = null,
    )

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    /**
     * Usage comes from two real sources: the per-request rows
     * (`GET /api/v1/usage`) and the account's summary (`GET /api/auth/me`, whose
     * `usage` object is the same one the gateway bills from). The screen shows
     * both, because a row list alone cannot answer "how much have I used".
     */
    fun load() {
        if (_state.value.loading) return
        _state.value = _state.value.copy(loading = true, error = null)
        viewModelScope.launch {
            when (val rows = container.api.listUsage(limit = 100)) {
                is ApiResult.Ok -> _state.value = _state.value.copy(rows = rows.value.rows, loading = false)
                is ApiResult.Err -> _state.value = _state.value.copy(loading = false, error = rows.error)
            }
            when (val me = container.api.authMe()) {
                is ApiResult.Ok -> _state.value = _state.value.copy(
                    summary = me.value.usage,
                    planLabel = me.value.usage?.label ?: me.value.usage?.plan,
                )
                is ApiResult.Err -> MetaLog.w("usage", "summary unavailable: %s", me.error.javaClass.simpleName)
            }
        }
    }
}
