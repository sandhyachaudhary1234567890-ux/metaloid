# MetaIoid UI Capability Map

Audit date: 2026-09-22. This map distinguishes the browser-local demo from the authenticated gateway. A control is connected only when its handler reaches a real runtime or an honest availability state.

| Surface / user action | Handler | Runtime/API | Result and state | Status |
| --- | --- | --- | --- | --- |
| Home composer: send | `CommandBar` → `sendMessage` | `POST /api/chat` SSE; local demo fallback only while offline | Conversation, token stream, event-driven activity | CONNECTED |
| Stop generation | `stopGenerating` | `AbortController`, `stopCurrentTask` | Cancels request and marks activity stopped | CONNECTED |
| Attach file/image | `CommandBar` attachment handler | Browser `FileReader`; message attachment state | Attachment chip and message metadata | PARTIAL — bytes are not yet persisted to a project |
| Voice conversation | `VoiceMode` | Browser media/STT/TTS runtime and chat transport | Permission-gated voice state, transcript, reply | CONNECTED where browser services are available |
| Live camera | `LiveScreen` / `LiveCamera` | Browser `getUserMedia` | Permission-gated preview; model analysis is not offered without a provider | PARTIAL |
| Projects: list/create | `WorkspaceScreen` | `GET/POST /api/workspaces` | User-scoped workspaces, honest loading/error/empty state | CONNECTED |
| Library: list/open/download | `WorkspaceScreen` / `ArtifactCard` | `GET /api/artifacts`, authenticated download | Real artifact metadata and blob download | CONNECTED |
| Natural presentation/document request | chat outcome detection → `IntentCapabilityResolver` | `POST /api/agent/artifact` SSE | Natural request resolves to a verified PPTX or DOCX writer; unsupported writers state that fact | CONNECTED |
| Artifact creation | `generateArtifact` | `POST /api/agent/artifact` SSE | File creation, OpenXML reopen/relationship validation, bounded repair, artifact card | CONNECTED |
| Research: new investigation | `WorkspaceScreen` → `OsintPanel` | OSINT investigation routes | Runtime-backed investigation UI | CONNECTED |
| Tasks: list/run/create | `WorkspaceScreen` / `MissionsPanel` | `/api/missions`, `/api/agent/mission` | Mission state, checkpoints and run controls | CONNECTED |
| Live task activity | `LiveActivity` | `ActivityStateEngine` runtime events | Ordered safe operational stages; no synthetic percentages | CONNECTED |
| Conversation history | `HistoryScreen` | namespaced browser storage | Search, select, pin, delete | CONNECTED (local-first) |
| Memory | `MemoryScreen` | namespaced browser storage; server memory endpoints available | Create, edit, delete local memory | PARTIAL — server synchronization is not yet wired to this screen |
| Skills | `SkillsPanel` | `/api/skills*` | Inspect, create, import, test, enable, disable, rollback | CONNECTED |
| Provider settings | `ProviderSettings` | `/api/providers*` | Credential lifecycle, health, routing and usage; keys redacted | CONNECTED |
| Devices | Settings control surface | `/api/devices*` | Explicit pairing and revocation | CONNECTED |
| Command palette | `CommandPalette` | routes / modal actions listed above | Opens only registered product actions | CONNECTED |
| Agents & tools drawer | `ToolsDrawer` | Opens research, tasks, camera, voice and skills surfaces | Unsupported catalog entries were removed | CONNECTED |

## Deliberately unavailable or not exposed as working

| Capability | Why | Current UX |
| --- | --- | --- |
| Browser automation, calendar, weather, generic web-search tool cards | The previous drawer only sent prompt text or showed a placeholder; it did not execute the advertised tool. | Removed from the drawer. |
| Project file persistence | Workspace records currently have metadata-only `files`; the server does not persist uploaded bytes. | Not offered as a completed project-file capability. |
| Local-demo Projects, Library, Research and Tasks | These require user-scoped gateway data. | Clear gateway-unavailable state; no sample rows. |
| Video studio / MetaCode IDE / connected apps | No complete product runtime and UI contract in this repository. | Not added to navigation or command palette. |

## State and error rules now enforced

- Artifact, project and mission lists load only from their respective APIs and expose a retryable error state.
- Local demo never displays sample projects, artifacts, research jobs, or task progress.
- The Home “Live Activity” panel renders only from runtime events; fabricated “all systems nominal” rows were removed.
- The forced page-switch loader and decorative device showcase were removed from the product flow because they were not runtime work states.
