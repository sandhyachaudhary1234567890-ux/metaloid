# METAIOID EXECUTION PLAN
**Date:** 2026-09-22  
**Purpose:** Detailed subsystem analysis and implementation roadmap  
**Status:** V1.0

---

## EXECUTIVE SUMMARY

This plan provides a detailed analysis of all existing subsystems, determines canonical implementations, and establishes the implementation order for transforming MetaIoid from a feature-rich demo into a production platform architecture.

**Key Decision:** Foundation → Consolidation → Platform → Frontier Capabilities  
**No random feature additions.** Systematic architectural development only.

---

## 1. CURRENT ARCHITECTURE MAP

### 1.1 FRONTEND ARCHITECTURE

**Location:** `src/`

**Components:**
- **App.tsx** - Main application with view routing and overlay management
- **screens/** - 6 main views (Home, Chat, Live, Memory, History, Settings)
- **components/** - UI component library with brand system
- **store/** - State management (session, library, chat)
- **lib/agent/** - Frontend AgentRuntime with autonomous execution
- **lib/skills/** - Frontend skill system with forge and registry
- **lib/voice/** - Complete voice system with acoustic intelligence
- **lib/behavior/** - Human behavior pipeline
- **lib/evolution/** - Product evolution system
- **lib/ready/** - Ready experience and meta-noticed system
- **lib/transport.ts** - Single network boundary with health checking

**Status:** ✅ WELL-STRUCTURED - Keep as-is, enhance with auth integration

### 1.2 BACKEND ARCHITECTURE

**Location:** `server/src/`

**Components:**
- **index.js** - Express gateway with CORS, rate limiting, SSE streaming
- **core/agent.js** - Agent kernel (intent → mission → synthesis)
- **core/missions.js** - Mission engine with task graphs and checkpoints
- **core/tools.js** - Tool fabric with registry and permission gates
- **core/skills.js** - Skill runtime with discovery
- **core/permissions.js** - Permission engine with risk ladder
- **core/verify.js** - Verification layer with check registry
- **core/memory.js** - 5-class memory system (file-backed)
- **core/world.js** - Entity-relationship graph
- **core/events.js** - Event bus with audit trail
- **core/observe.js** - Observability metrics
- **openrouter.js** - OpenRouter integration with free model routing
- **nvidia.js** - NVIDIA fallback (disabled by default)
- **osint.js** - OSINT orchestration
- **skills/** - OSINT and research skills
- **tools/catalog.js** - Concrete tool implementations

**Status:** ✅ STRONG FOUNDATION - Consolidate with frontend systems

### 1.3 AGENT RUNTIME SYSTEMS

**System A: Backend Agent Kernel**
- **File:** `server/src/core/agent.js`
- **Purpose:** Intent classification, mission planning, skill discovery
- **Capabilities:** Plan missions, coordinate skills, synthesize reports
- **Integration:** Works with backend missions, tools, permissions
- **Status:** ✅ PRODUCTION-GRADE

**System B: Frontend AgentRuntime**
- **File:** `src/lib/agent/runtime.ts`
- **Purpose:** Autonomous task execution with checkpointing
- **Capabilities:** Execute multi-step tasks, resume from checkpoints, verification
- **Integration:** Works with frontend capability router, document intelligence
- **Status:** ✅ SOPHISTICATED

**Decision:** **MERGE** - Backend should be authoritative for server-side operations, frontend for UI state and client-side execution.

### 1.4 MEMORY SYSTEMS

**System A: Backend Memory**
- **File:** `server/src/core/memory.js`
- **Purpose:** 5-class memory system (working, episodic, semantic, procedural, mission)
- **Storage:** File-backed JSON (`server/data/memory.json`)
- **Capabilities:** Secret detection, confidence levels, source tracking
- **Status:** ✅ PRODUCTION-GRADE

**System B: Frontend Library**
- **File:** `src/store/library.tsx`
- **Purpose:** Personal memory storage
- **Storage:** Browser localStorage
- **Capabilities:** Simple CRUD for memory items
- **Status:** ⚠️ BASIC

**Decision:** **MERGE** - Backend memory as canonical source, frontend as UI layer with sync.

### 1.5 SKILL SYSTEMS

**System A: Backend Skills**
- **File:** `server/src/core/skills.js`
- **Purpose:** Skill registry with keyword discovery
- **Capabilities:** Simple manifest system, brief generation
- **Status:** ⚠️ BASIC

**System B: Frontend Skills**
- **File:** `src/lib/skills/registry.ts`
- **Purpose:** Advanced skill system with versioning and autonomous generation
- **Capabilities:** Version management, sandbox execution, rollback, telemetry
- **Status:** ✅ SOPHISTICATED

**Decision:** **REPLACE** - Frontend skill system is superior, migrate to backend as canonical.

### 1.6 VERIFICATION SYSTEMS

**System A: Backend Verification**
- **File:** `server/src/core/verify.js`
- **Purpose:** Check registry with status vocabulary
- **Capabilities:** Basic checks (nonempty, no-placeholders, provenance)
- **Status:** ⚠️ BASIC

**System B: Frontend Verification**
- **File:** `src/lib/agent/verificationEngine.ts`
- **Purpose:** Multi-facet verification quality gate
- **Capabilities:** Factual, technical, visual verification with repair directives
- **Status:** ✅ SOPHISTICATED

**Decision:** **REPLACE** - Frontend verification is comprehensive, migrate to backend as canonical.

### 1.7 PROVIDER SYSTEMS

**Current State:**
- **File:** `server/src/openrouter.js` - OpenRouter integration
- **File:** `server/src/nvidia.js` - NVIDIA fallback
- **Capabilities:** 2 providers only, no user key management
- **Status:** ❌ INCOMPLETE

**Decision:** **REPLACE** - Build complete BYOK provider fabric as specified.

### 1.8 VOICE SYSTEM

**Location:** `src/lib/voice/`

**Components:**
- **runtime.ts** - Voice turn management
- **acoustics.ts** - Environment analysis
- **vad.ts** - Voice activity detection
- **ttsStream.ts** - Streaming TTS
- **bargeIn.ts** - Interruption handling
- **telemetry.ts** - Performance metrics

**Status:** ✅ SOPHISTICATED - Keep as-is, integrate with provider system for STT/TTS.

### 1.9 PERMISSION SYSTEM

**Location:** `server/src/core/permissions.js`

**Capabilities:**
- Risk ladder (read, reversible, external, irreversible)
- Approval queue for dangerous operations
- Authorization function

**Status:** ✅ GOOD FOUNDATION - Enhance with user-scoped permissions.

### 1.10 TOOL SYSTEM

**Location:** `server/src/core/tools.js` + `server/src/tools/catalog.js`

**Capabilities:**
- Tool registry with schema validation
- Permission-gated execution
- Timeout and error handling
- OSINT, research, memory, world tools

**Status:** ✅ PRODUCTION-GRADE - Enhance with user ownership scoping.

### 1.11 INITIATIVE SYSTEM

**Location:** `src/lib/agent/initiativeEngine.ts`

**Capabilities:**
- Proactive action decision system
- Policy evaluation with risk assessment
- Event fingerprinting and cooldown
- User override capability

**Status:** ✅ SOPHISTICATED - Keep as-is, integrate with backend events.

### 1.12 STORAGE SYSTEMS

**Backend Storage:**
- **Location:** `server/data/*.json` (gitignored)
- **Type:** JSON file storage
- **Contents:** Missions, memory, world model
- **Status:** ⚠️ SCALABILITY LIMITATION

**Frontend Storage:**
- **Location:** Browser localStorage
- **Type:** Key-value storage
- **Contents:** Settings, memories, conversations
- **Status:** ⚠️ NO SYNC

**Decision:** **ENHANCE** - Implement proper database (SQLite) with sync layer.

---

## 2. DUPLICATE SYSTEMS RESOLUTION

### 2.1 AGENT RUNTIME DUPLICATE

**Decision:** MERGE - Backend Authoritative

**Plan:**
1. Keep `server/src/core/agent.js` as canonical server-side agent kernel
2. Keep `src/lib/agent/runtime.ts` for client-side autonomous execution
3. Create clear separation: Backend = server operations, Frontend = UI state
4. Add synchronization layer for cross-runtime coordination
5. Document responsibilities in ARCHITECTURE.md

**Timeline:** Priority 2 (Architecture Consolidation) - 1 week

### 2.2 MEMORY SYSTEM DUPLICATE

**Decision:** MERGE - Backend Canonical with Sync

**Plan:**
1. Keep `server/src/core/memory.js` as canonical memory system
2. Enhance with user ownership (userId, projectId fields)
3. Create sync API endpoint for frontend memory access
4. Update `src/store/library.tsx` to use backend API
5. Implement conflict resolution for offline edits
6. Add memory ownership validation

**Timeline:** Priority 1 (Multi-User) - 2 weeks

### 2.3 SKILL SYSTEM DUPLICATE

**Decision:** REPLACE - Frontend System Superior

**Plan:**
1. Migrate `src/lib/skills/registry.ts` to backend as `server/src/core/skillsV2.js`
2. Replace simple `server/src/core/skills.js` with advanced system
3. Update backend tool integration to use new skill system
4. Add sandbox execution environment to backend
5. Implement skill versioning and rollback in backend
6. Create compatibility adapter for existing simple skills

**Timeline:** Priority 2 (Architecture Consolidation) - 2 weeks

### 2.4 VERIFICATION SYSTEM DUPLICATE

**Decision:** REPLACE - Frontend System Superior

**Plan:**
1. Migrate `src/lib/agent/verificationEngine.ts` to backend as `server/src/core/verifyV2.js`
2. Replace simple `server/src/core/verify.js` with comprehensive system
3. Integrate verification into mission completion flow
4. Add verification API endpoint for frontend status
5. Implement verification result caching
6. Create compatibility adapter for existing simple checks

**Timeline:** Priority 2 (Architecture Consolidation) - 1 week

---

## 3. MISSING CAPABILITIES

### 3.1 AUTHENTICATION & MULTI-USER ⚠️

**Current State:** ✅ Authentication implemented, ⚠️ Data isolation incomplete

**Existing Implementation:**
- **File:** `server/src/core/users.js`
- **Capabilities:**
  - Scrypt-hashed passwords (secure)
  - SHA256-hashed tokens (raw tokens never persisted)
  - Session management with access/refresh tokens
  - Device tracking and session rotation
  - Admin/user roles with middleware
  - Ownership validation function (`ownedBy()`)
  - User/session management endpoints

**Missing:**
- User data isolation across all resources
- Ownership validation on all API endpoints
- Cross-user access prevention
- Resource-level permission boundaries
- User-scoped data access patterns

**Implementation:** Priority 1 - 2 weeks (focus on data isolation, not auth foundation)

### 3.2 BYOK PROVIDER SYSTEM ❌

**Current State:** 2 providers hardcoded, no user key management

**Required:**
- Provider registry supporting 50+ providers
- User key management with encryption
- Provider health monitoring
- Provider routing optimization
- Cost tracking per provider

**Implementation:** Priority 3 - 6 weeks

### 3.3 BROWSER/COMPUTER USE ❌

**Current State:** Companion bridge exists, no actual automation

**Required:**
- Browser automation (Playwright/Selenium)
- Screen capture and analysis
- UI element detection
- Action execution with verification

**Implementation:** Priority 6 - 8 weeks

### 3.4 PLUGIN ECOSYSTEM ❌

**Current State:** No plugin system

**Required:**
- Plugin registry and discovery
- Plugin permission system
- Plugin sandboxing
- Plugin UI integration

**Implementation:** Priority 4 - 8 weeks

### 3.5 LIBRARY SYSTEM ❌

**Current State:** Frontend memory only, no asset management

**Required:**
- Backend file storage
- Asset management (images, videos, documents)
- Semantic search with embeddings
- Collections and folders

**Implementation:** Priority 9 - 4 weeks

### 3.6 PROJECTS SYSTEM ❌

**Current State:** Partial implementation

**Required:**
- Project isolation boundaries
- Project-scoped conversations
- Project file management
- Project collaboration

**Implementation:** Priority 9 - 4 weeks

---

## 4. SECURITY RISKS

### 4.1 NO MULTI-USER ISOLATION 🔴

**Risk:** Cross-user data access, horizontal privilege escalation

**Mitigation:** Priority 1 - Implement user authentication and data scoping

### 4.2 NO IDOR PROTECTION 🔴

**Risk:** Insecure direct object reference vulnerabilities

**Mitigation:** Priority 1 - Add ownership validation on all endpoints

### 4.3 CREDENTIAL STORAGE 🔴

**Risk:** API keys in environment variables

**Mitigation:** Priority 1 - Implement credential vault with encryption

### 4.4 NO AUTHORIZATION BOUNDARIES 🔴

**Risk:** All resources shared across single user

**Mitigation:** Priority 1 - Add user permission boundaries

---

## 5. IMPLEMENTATION ORDER

### PHASE 1: IDENTITY + SECURITY + MULTI-USER ✅ COMPLETED

**Objective:** Complete multi-user data isolation using existing auth foundation

**Status:** ✅ ALREADY IMPLEMENTED - Advanced multi-user system exists

**Existing Implementation:**
1. **Authentication System** ✅ COMPLETE
   - Advanced `server/src/core/users.js` with scrypt-hashed passwords
   - SHA256-hashed tokens (raw tokens never persisted)
   - Session management with device tracking and rotation
   - Admin/user roles with proper middleware
   - Ownership validation function `ownedBy()` already exists
   - Authentication middleware `requireAuth()` already implemented

2. **User Data Isolation** ✅ COMPLETE
   - Memory system with userId filtering and `needUser()` validation
   - Missions system with userId ownership and `owned()` validation
   - World model with userId ownership and user-scoped operations
   - All core systems use `needUser(userId)` validation
   - API endpoints properly protected with `requireAuth` middleware

3. **Authorization Layer** ✅ COMPLETE
   - Existing permission system with user scoping
   - Resource-level permissions using existing role system
   - Permission check middleware integrated throughout
   - Admin-only endpoints with `requireAdmin()` middleware

4. **Missing - Credential Vault** ❌ NOT IMPLEMENTED
   - Need secure credential storage for provider keys
   - Need encryption at rest for user provider credentials
   - Need key rotation mechanism
   - Need credential access auditing
   - Need integration with existing user system

**Assessment:** The foundational multi-user architecture is already production-grade. The main gap is credential management for the upcoming provider system.

**Revised Focus:** Skip to Phase 3 (BYOK/Provider Fabric) with credential vault as prerequisite

---

### PHASE 2: ARCHITECTURE CONSOLIDATION (3-4 weeks)

**Objective:** Eliminate duplicate systems and establish canonical implementations

**Tasks:**
1. **Agent Runtime Consolidation**
   - Define backend vs frontend responsibilities
   - Create synchronization layer
   - Update documentation
   - Test cross-runtime coordination

2. **Memory System Merge**
   - Enhance backend memory with user ownership
   - Create sync API endpoints
   - Update frontend to use backend API
   - Implement conflict resolution

3. **Skill System Migration**
   - Migrate advanced skill system to backend
   - Replace simple skill system
   - Implement sandbox execution in backend
   - Create compatibility adapters

4. **Verification System Migration**
   - Migrate comprehensive verification to backend
   - Replace simple verification system
   - Integrate into mission flow
   - Create verification API endpoints

**Dependencies:** Phase 1 (requires user ownership)

**Testing:**
- System integration tests
- Compatibility adapter tests
- Sync layer tests
- Performance regression tests

---

### PHASE 3: BYOK/PROVIDER FABRIC (6-8 weeks)

**Objective:** Build scalable provider system supporting 50+ providers

**Tasks:**
1. **Provider Registry Architecture**
   - Design provider manifest schema
   - Implement provider registry
   - Create provider adapter interface
   - Add provider health monitoring

2. **Credential Management**
   - Integrate with credential vault
   - Implement user key management UI
   - Add provider connection flows
   - Implement key rotation UI

3. **Provider Routing**
   - Implement intelligent provider selection
   - Add fallback mechanisms
   - Implement cost optimization
   - Add provider-specific routing rules

4. **Provider Integration**
   - Integrate top 10 providers (OpenAI, Anthropic, Google, etc.)
   - Implement provider-specific adapters
   - Add provider testing infrastructure
   - Create provider documentation

**Dependencies:** Phase 1 (requires credential vault), Phase 2 (requires stable architecture)

**Testing:**
- Provider connection tests
- Failover tests
- Cost tracking tests
- Security tests for credential handling

---

### PHASE 4: PLUGIN + TOOL + AGENT SDK (8-10 weeks)

**Objective:** Create extensible plugin ecosystem

**Tasks:**
1. **Plugin Registry**
   - Design plugin manifest schema
   - Implement plugin registry
   - Create plugin discovery system
   - Add plugin versioning

2. **Plugin SDK**
   - Create plugin development framework
   - Implement plugin permission system
   - Add plugin sandboxing
   - Create plugin UI integration patterns

3. **Tool SDK**
   - Enhance tool system with SDK
   - Create tool development framework
   - Add tool testing infrastructure
   - Implement tool discovery

4. **Agent SDK**
   - Create agent development framework
   - Implement agent composition patterns
   - Add agent testing infrastructure
   - Create agent documentation

**Dependencies:** Phase 3 (requires stable provider system)

**Testing:**
- Plugin sandbox tests
- Permission isolation tests
- SDK integration tests
- Security tests for plugin execution

---

### PHASE 5: CONTEXT FABRIC + CODE INTELLIGENCE (6-8 weeks)

**Objective:** Implement large-context architecture and repository intelligence

**Tasks:**
1. **Context Fabric**
   - Implement retrieval system
   - Add context ranking and compression
   - Implement context caching
   - Add context budgeting

2. **Codebase Intelligence**
   - Implement file indexing
   - Add symbol indexing
   - Create dependency graph
   - Implement call graph analysis

3. **Repository Understanding**
   - Add Git history analysis
   - Implement architecture summarization
   - Create decision memory system
   - Add test relationship tracking

**Dependencies:** Phase 2 (requires stable architecture)

**Testing:**
- Context retrieval tests
- Code intelligence accuracy tests
- Performance tests for large repositories
- Integration tests with agent runtime

---

### PHASE 6: BROWSER/COMPUTER USE (8-10 weeks)

**Objective:** Implement controlled browser and computer automation

**Tasks:**
1. **Browser Automation**
   - Integrate Playwright/Selenium
   - Implement screen capture
   - Add UI element detection
   - Create action execution system

2. **Computer Control**
   - Implement screen analysis
   - Add action verification
   - Create safety boundaries
   - Implement permission system for actions

3. **Vision Integration**
   - Integrate with existing vision system
   - Implement visual reasoning
   - Add screen understanding
   - Create visual monitoring

**Dependencies:** Phase 4 (requires plugin system for browser plugins), Phase 5 (requires context intelligence)

**Testing:**
- Browser automation tests
- Action verification tests
- Security tests for computer control
- Integration tests with vision system

---

### PHASE 7: NEXT-LEVEL VISION (6-8 weeks)

**Objective:** Enhance vision capabilities with continuous observation

**Tasks:**
1. **Continuous Vision**
   - Implement adaptive visual observation
   - Add scene-change detection
   - Create keyframe selection
   - Implement relevance filtering

2. **Visual World Model**
   - Create temporary visual representation
   - Add object tracking
   - Implement state change detection
   - Create visual reasoning system

3. **Vision + Action Integration**
   - Integrate with browser/computer use
   - Implement vision-grounded actions
   - Add visual verification
   - Create continuous monitoring

**Dependencies:** Phase 6 (requires browser/computer use)

**Testing:**
- Vision accuracy tests
- Continuous observation tests
- Integration tests with action system
- Performance tests for real-time vision

---

### PHASE 8: METACODE FRONTIER (10-12 weeks)

**Objective:** Build comprehensive software engineering platform

**Tasks:**
1. **Repository Analysis**
   - Implement repository understanding
   - Add architecture analysis
   - Create code quality assessment
   - Implement dependency analysis

2. **Planning System**
   - Implement task decomposition
   - Add implementation planning
   - Create test planning
   - Implement risk assessment

3. **Editing System**
   - Implement code editing
   - Add refactoring capabilities
   - Create code generation
   - Implement code review

4. **Terminal Integration**
   - Implement terminal execution
   - Add build system integration
   - Create test execution
   - Implement debugging

5. **Git Integration**
   - Implement Git operations
   - Add worktree support
   - Create diff visualization
   - Implement commit generation

6. **Verification System**
   - Integrate with existing verification
   - Add test execution
   - Implement security scanning
   - Create performance analysis

**Dependencies:** Phase 5 (requires code intelligence), Phase 6 (requires browser use for testing)

**Testing:**
- End-to-end coding tests
- Integration tests with all systems
- Security tests for code execution
- Performance tests for large projects

---

### PHASE 9: PROJECTS + LIBRARY + TASKS (4-5 weeks)

**Objective:** Complete project and asset management systems

**Tasks:**
1. **Projects System**
   - Implement project isolation
   - Add project-scoped conversations
   - Create project file management
   - Implement project collaboration

2. **Library System**
   - Implement backend file storage
   - Add asset management
   - Create semantic search
   - Implement collections and folders

3. **Tasks System**
   - Enhance mission system for recurring tasks
   - Add scheduled tasks
   - Implement event-triggered tasks
   - Create task templates

**Dependencies:** Phase 1 (requires multi-user), Phase 3 (requires provider system)

**Testing:**
- Project isolation tests
- Library functionality tests
- Task automation tests
- Integration tests with agent system

---

### PHASE 10: IMAGE/VIDEO/CREATIVE PLATFORM (6-8 weeks)

**Objective:** Implement creative capabilities with provider integration

**Tasks:**
1. **Image Platform**
   - Integrate image generation providers
   - Implement image editing
   - Add image verification
   - Create image management

2. **Video Platform**
   - Integrate video generation providers
   - Implement video editing
   - Add video verification
   - Create video management

3. **Audio Platform**
   - Integrate audio providers
   - Implement audio editing
   - Add audio verification
   - Create audio management

**Dependencies:** Phase 3 (requires provider system), Phase 9 (requires library)

**Testing:**
- Provider integration tests
- Creative workflow tests
- Verification tests for generated assets
- Integration tests with library system

---

### PHASE 11: CROSS-DEVICE + POLISH (4-5 weeks)

**Objective:** Implement cross-device continuity and UX polish

**Tasks:**
1. **Cross-Device Sync**
   - Implement device registration
   - Add state synchronization
   - Create device-specific UI
   - Implement conflict resolution

2. **UX Polish**
   - Refine visual system (WARM PAPER)
   - Add responsive design improvements
   - Implement accessibility enhancements
   - Create onboarding flow

**Dependencies:** Phase 1 (requires multi-user), Phase 9 (requires projects)

**Testing:**
- Cross-device sync tests
- UX usability tests
- Accessibility tests
- Performance tests on multiple devices

---

### PHASE 12: REAL-WORLD BENCHMARKING (4-6 weeks)

**Objective:** Create comprehensive benchmark suite and measure performance

**Tasks:**
1. **Benchmark Creation**
   - Create reasoning benchmarks
   - Implement research benchmarks
   - Add coding benchmarks
   - Create browser use benchmarks

2. **Performance Measurement**
   - Implement telemetry collection
   - Add performance analytics
   - Create comparison system
   - Implement regression detection

3. **Documentation**
   - Create performance reports
   - Add comparison documentation
   - Implement benchmark CI
   - Create public benchmark results

**Dependencies:** All previous phases

**Testing:**
- Benchmark validity tests
- Performance regression tests
- Cross-platform compatibility tests
- Statistical significance tests

---

## 6. SUBSYSTEM DETAILS

### 6.1 AUTHENTICATION SUBSYSTEM

**Current State:** ✅ IMPLEMENTED - Advanced system already exists

**Existing Implementation:**
- **File:** `server/src/core/users.js`
- **Components:**
  - User management with scrypt-hashed passwords
  - Session management with access/refresh tokens
  - Device tracking and session rotation
  - Admin/user roles with middleware
  - Ownership validation function (`ownedBy()`)
  - User/session management endpoints

**API Endpoints (Already Implemented):**
- User creation: `createUser()`
- User verification: `verifyUser()`
- Session creation: `createSession()`
- Session refresh: `refreshSession()`
- Session revocation: `revokeSession()`, `revokeAllSessions()`
- Authentication middleware: `requireAuth()`, `requireAdmin()`
- Ownership validation: `ownedBy()`

**Security Features (Already Implemented):**
- Scrypt-hashed passwords (more secure than bcrypt)
- SHA256-hashed tokens (raw tokens never persisted)
- Short-lived access tokens (30m) + rotating refresh tokens (30d)
- Device tracking and session rotation
- Admin/user role separation
- Security event emission

**Missing Enhancements:**
- Consistent application of `ownedBy()` across all resources
- User ownership fields on all persistent resources
- Cross-user access prevention on all endpoints
- Resource-level permission boundaries

---

### 6.2 AUTHORIZATION SUBSYSTEM

**Current State:** ⚠️ BASIC PERMISSIONS, NO USER SCOPING

**Required Enhancement:**
- **File:** `server/src/core/permissions.js` (enhance)
- **Components:**
  - User ownership validation
  - Resource-level permissions
  - Role-based access control
  - Permission check middleware

**API Integration:**
- All endpoints must validate user ownership
- Resource access must check userId
- Cross-user access must be prevented

**Dependencies:** Phase 1 (Authentication)

**Security Considerations:**
- IDOR protection on all endpoints
- Ownership validation before resource access
- Audit logging for permission checks

---

### 6.3 CREDENTIAL VAULT SUBSYSTEM

**Current State:** ❌ NOT IMPLEMENTED

**Required Implementation:**
- **File:** `server/src/credentials/`
- **Components:**
  - `vault.js` - Encrypted credential storage
  - `encryption.js` - Encryption/decryption utilities
  - `rotation.js` - Key rotation mechanism
  - `audit.js` - Credential access auditing

**API Endpoints:**
- `POST /api/credentials` - Store credential
- `GET /api/credentials` - List user credentials
- `DELETE /api/credentials/:id` - Delete credential
- `POST /api/credentials/:id/rotate` - Rotate credential

**Dependencies:** Phase 1 (Authentication)

**Security Considerations:**
- Encryption at rest (AES-256)
- Encryption in transit (TLS)
- No credential logging
- Access auditing
- Key rotation support

---

### 6.4 PROVIDER REGISTRY SUBSYSTEM

**Current State:** ❌ NOT IMPLEMENTED

**Required Implementation:**
- **File:** `server/src/providers/`
- **Components:**
  - `registry.js` - Provider registry
  - `adapter.js` - Provider adapter interface
  - `health.js` - Provider health monitoring
  - `router.js` - Provider routing logic

**Provider Categories:**
- LLM (OpenAI, Anthropic, Google, etc.)
- Reasoning (specialized reasoning models)
- Vision (vision-capable models)
- Image (DALL-E, Midjourney, Stable Diffusion)
- Video (video generation models)
- Audio (STT/TTS providers)
- Search (search APIs)
- Embeddings (embedding providers)
- OCR (document OCR)
- Code (code-specific models)
- Document AI (document processing)

**API Endpoints:**
- `GET /api/providers` - List available providers
- `POST /api/providers/connect` - Connect provider
- `DELETE /api/providers/:id` - Disconnect provider
- `GET /api/providers/:id/health` - Provider health status

**Dependencies:** Phase 1 (Credential Vault)

**Security Considerations:**
- Provider credentials in vault
- Provider-specific rate limiting
- Cost tracking per user
- Access auditing

---

### 6.5 CANONICAL SYSTEM SPECIFICATIONS

#### 6.5.1 ONE AgentRuntime

**Canonical Implementation:** `server/src/core/agent.js` (backend)

**Responsibilities:**
- Intent classification
- Mission planning
- Skill discovery
- Tool coordination
- Report synthesis

**Frontend Role:** `src/lib/agent/runtime.ts`
- UI state management
- Client-side autonomous execution
- Checkpoint visualization
- User interaction handling

**Integration:** API endpoints for mission control, SSE for progress updates

#### 6.5.2 ONE ContextEngine

**Current State:** ❌ NOT IMPLEMENTED

**Required Implementation:** `server/src/context/`

**Components:**
- `engine.js` - Context orchestration
- `retrieval.js` - Context retrieval
- `ranking.js` - Context ranking
- `compression.js` - Context compression

**Dependencies:** Phase 5 (Context Fabric)

#### 6.5.3 ONE Memory System

**Canonical Implementation:** `server/src/core/memory.js` (enhanced)

**Enhancements Required:**
- User ownership (userId field)
- Project scoping (projectId field)
- Sync API endpoints
- Conflict resolution
- Semantic search integration

**Frontend Integration:** `src/store/library.tsx` uses backend API

#### 6.5.4 ONE Skill System

**Canonical Implementation:** Migrate `src/lib/skills/registry.ts` to backend

**Location:** `server/src/core/skillsV2.js`

**Capabilities:**
- Version management
- Sandbox execution
- Rollback mechanism
- Telemetry tracking
- Autonomous generation

**Migration Plan:** Phase 2 (Architecture Consolidation)

#### 6.5.5 ONE Verification System

**Canonical Implementation:** Migrate `src/lib/agent/verificationEngine.ts` to backend

**Location:** `server/src/core/verifyV2.js`

**Capabilities:**
- Factual verification
- Technical verification
- Visual verification
- Quality gate evaluation
- Repair directives

**Migration Plan:** Phase 2 (Architecture Consolidation)

#### 6.5.6 ONE Permission System

**Canonical Implementation:** `server/src/core/permissions.js` (enhanced)

**Enhancements Required:**
- User ownership validation
- Resource-level permissions
- Role-based access control
- Permission check middleware

**Integration:** All API endpoints must use permission system

#### 6.5.7 ONE Provider Registry

**Canonical Implementation:** `server/src/providers/registry.js`

**Capabilities:**
- Provider manifest management
- Provider adapter interface
- Provider health monitoring
- Provider routing optimization

**Implementation:** Phase 3 (BYOK/Provider Fabric)

#### 6.5.8 ONE Tool Registry

**Canonical Implementation:** `server/src/core/tools.js` (enhanced)

**Enhancements Required:**
- User ownership validation
- Dynamic tool discovery
- Tool permission integration
- Tool telemetry

**Current Status:** ✅ GOOD FOUNDATION

#### 6.5.9 ONE Task Model

**Canonical Implementation:** `server/src/core/missions.js` (enhanced)

**Enhancements Required:**
- User ownership (userId field)
- Project scoping (projectId field)
- Recurring task support
- Scheduled task support

**Current Status:** ✅ PRODUCTION-GRADE

#### 6.5.10 ONE Event Model

**Canonical Implementation:** `server/src/core/events.js` (enhanced)

**Enhancements Required:**
- User ownership validation
- Event filtering by user
- Event retention policies
- Event export capabilities

**Current Status:** ✅ GOOD FOUNDATION

---

## 7. TEST STRATEGY

### 7.1 SECURITY TESTS

**Multi-User Isolation:**
- Test user A cannot access user B's conversations
- Test user A cannot access user B's memory
- Test user A cannot access user B's files
- Test user A cannot access user B's projects
- Test user A cannot access user B's credentials

**IDOR Protection:**
- Test direct object access by ID without ownership
- Test enumeration attacks on resource IDs
- Test permission bypass attempts
- Test cross-tenant data access

**Credential Security:**
- Test credentials are encrypted at rest
- Test credentials are never logged
- Test credential access auditing
- Test credential rotation mechanism

### 7.2 PROVIDER TESTS

**Connection Tests:**
- Test provider connection with valid credentials
- Test provider connection with invalid credentials
- Test provider disconnection
- Test credential rotation

**Failover Tests:**
- Test provider failure fallback
- Test multiple provider failures
- Test provider recovery
- Test cost tracking during failover

### 7.3 PLUGIN TESTS

**Sandbox Tests:**
- Test plugin code isolation
- Test plugin permission enforcement
- Test plugin resource limits
- Test plugin termination

**Permission Tests:**
- Test plugin cannot access user credentials
- Test plugin cannot access other user data
- Test plugin cannot exceed resource limits
- Test plugin audit logging

### 7.4 AGENT TESTS

**Planning Tests:**
- Test mission planning accuracy
- Test task decomposition
- Test dependency resolution
- Test resource estimation

**Execution Tests:**
- Test task execution correctness
- Test error recovery
- Test checkpoint resumption
- Test verification integration

### 7.5 VISION TESTS

**Accuracy Tests:**
- Test UI element detection accuracy
- Test screen understanding accuracy
- Test visual reasoning accuracy
- Test continuous observation accuracy

**Integration Tests:**
- Test vision-grounded actions
- Test visual verification
- Test continuous monitoring
- Test performance under load

### 7.6 METACODE TESTS

**End-to-End Tests:**
- Test repository analysis accuracy
- Test code editing correctness
- Test build system integration
- Test execution verification

**Security Tests:**
- Test code execution sandboxing
- Test file system access restrictions
- Test network access restrictions
- Test credential protection

---

## 8. DEPENDENCY GRAPH

```
PHASE 1: Identity + Security + Multi-User
├── Authentication
├── Authorization
├── Credential Vault
└── User Data Isolation

PHASE 2: Architecture Consolidation
├── Agent Runtime Merge (depends on Phase 1)
├── Memory System Merge (depends on Phase 1)
├── Skill System Migration
└── Verification System Migration

PHASE 3: BYOK/Provider Fabric
├── Provider Registry (depends on Phase 1 - Credential Vault)
├── Credential Management (depends on Phase 1)
├── Provider Routing (depends on Phase 2 - stable architecture)
└── Provider Integration

PHASE 4: Plugin + Tool + Agent SDK
├── Plugin Registry (depends on Phase 3 - provider system)
├── Plugin SDK
├── Tool SDK
└── Agent SDK

PHASE 5: Context Fabric + Code Intelligence
├── Context Fabric (depends on Phase 2 - stable architecture)
├── Codebase Intelligence
└── Repository Understanding

PHASE 6: Browser/Computer Use
├── Browser Automation (depends on Phase 4 - plugin system)
├── Computer Control (depends on Phase 5 - context intelligence)
└── Vision Integration

PHASE 7: Next-Level Vision
├── Continuous Vision (depends on Phase 6 - browser use)
├── Visual World Model
└── Vision + Action Integration

PHASE 8: MetaCode Frontier
├── Repository Analysis (depends on Phase 5 - code intelligence)
├── Planning System
├── Editing System
├── Terminal Integration
├── Git Integration
└── Verification System (depends on Phase 6 - browser use)

PHASE 9: Projects + Library + Tasks
├── Projects System (depends on Phase 1 - multi-user)
├── Library System (depends on Phase 3 - provider system)
└── Tasks System (depends on Phase 1 - multi-user)

PHASE 10: Image/Video/Creative Platform
├── Image Platform (depends on Phase 3 - provider system)
├── Video Platform (depends on Phase 3 - provider system)
└── Audio Platform (depends on Phase 3 - provider system)

PHASE 11: Cross-Device + Polish
├── Cross-Device Sync (depends on Phase 1 - multi-user)
├── UX Polish (depends on Phase 9 - projects)
└── Accessibility

PHASE 12: Real-World Benchmarking
├── Benchmark Creation (depends on all previous phases)
├── Performance Measurement
└── Documentation
```

---

## 9. SUCCESS CRITERIA

### 9.1 PHASE 1 SUCCESS CRITERIA

- ✅ Users can register and login
- ✅ User data is properly isolated
- ✅ IDOR vulnerabilities are eliminated
- ✅ Credentials are encrypted at rest
- ✅ Cross-user access is prevented
- ✅ All security tests pass

### 9.2 PHASE 2 SUCCESS CRITERIA

- ✅ Duplicate systems are consolidated
- ✅ Canonical implementations are established
- ✅ Architecture is documented
- ✅ No performance regression
- ✅ All integration tests pass

### 9.3 PHASE 3 SUCCESS CRITERIA

- ✅ 10+ providers are integrated
- ✅ User key management works
- ✅ Provider routing is intelligent
- ✅ Failover mechanisms work
- ✅ Cost tracking is accurate

### 9.4 PHASE 4 SUCCESS CRITERIA

- ✅ Plugin registry works
- ✅ Plugin SDK is functional
- ✅ Plugin sandboxing is secure
- ✅ Plugin permissions are enforced

### 9.5 PHASE 5 SUCCESS CRITERIA

- ✅ Context retrieval works
- ✅ Code intelligence is accurate
- ✅ Large projects are handled
- ✅ Context budgeting is effective

### 9.6 PHASE 6 SUCCESS CRITERIA

- ✅ Browser automation works
- ✅ Actions are verified
- ✅ Safety boundaries are enforced
- ✅ Vision integration works

### 9.7 PHASE 7 SUCCESS CRITERIA

- ✅ Continuous vision works
- ✅ Visual world model is accurate
- ✅ Vision-grounded actions work
- ✅ Performance is acceptable

### 9.8 PHASE 8 SUCCESS CRITERIA

- ✅ Repository analysis is accurate
- ✅ Code editing is correct
- ✅ Terminal integration works
- ✅ Git operations work
- ✅ All verification passes

### 9.9 PHASE 9 SUCCESS CRITERIA

- ✅ Projects are isolated
- ✅ Library manages assets
- ✅ Tasks can be scheduled
- ✅ Integration works

### 9.10 PHASE 10 SUCCESS CRITERIA

- ✅ Image generation works
- ✅ Video generation works
- ✅ Assets are verified
- ✅ Library integration works

### 9.11 PHASE 11 SUCCESS CRITERIA

- ✅ Cross-device sync works
- ✅ UX is polished
- ✅ Accessibility is good
- ✅ Performance is acceptable

### 9.12 PHASE 12 SUCCESS CRITERIA

- ✅ Benchmarks are comprehensive
- ✅ Performance is measured
- ✅ Comparisons are objective
- ✅ Documentation is complete

---

## 10. RISK MITIGATION

### 10.1 ARCHITECTURE RISKS

**Risk:** Consolidation breaks existing functionality

**Mitigation:**
- Comprehensive testing before consolidation
- Compatibility adapters for legacy systems
- Gradual migration with fallback options
- Rollback plans for each consolidation

### 10.2 SECURITY RISKS

**Risk:** Multi-user implementation introduces vulnerabilities

**Mitigation:**
- Security review at each phase
- Penetration testing before deployment
- Audit logging for all security events
- Gradual rollout with monitoring

### 10.3 PERFORMANCE RISKS

**Risk:** New systems degrade performance

**Mitigation:**
- Performance benchmarking at each phase
- Load testing before deployment
- Optimization iterations
- Monitoring and alerting

### 10.4 INTEGRATION RISKS

**Risk:** New systems don't integrate well

**Mitigation:**
- Integration testing at each phase
- API contract testing
- End-to-end testing
- Mock implementations for testing

---

## 11. NEXT STEPS

### IMMEDIATE ACTION (Week 1-2)

**Focus:** Phase 1 - Authentication System

**Tasks:**
1. Create authentication subsystem structure
2. Implement JWT token generation/validation
3. Create user registration/login endpoints
4. Add authentication middleware
5. Implement session management
6. Add basic user ownership to existing resources

**Testing:**
- Authentication flow tests
- Token validation tests
- Session management tests
- Basic ownership tests

### SHORT-TERM (Week 3-4)

**Focus:** Phase 1 - Authorization & Data Isolation

**Tasks:**
1. Enhance permission system with user scoping
2. Add ownership validation middleware
3. Implement IDOR protection on all endpoints
4. Add user-scoped data access patterns
5. Create credential vault foundation
6. Implement basic credential encryption

**Testing:**
- Authorization tests
- IDOR protection tests
- Cross-user access tests
- Credential security tests

### MEDIUM-TERM (Week 5-8)

**Focus:** Phase 1 Completion + Phase 2 Start

**Tasks:**
1. Complete Phase 1 security implementation
2. Begin Phase 2 architecture consolidation
3. Start with agent runtime consolidation
4. Define clear backend/frontend responsibilities
5. Create synchronization layer

**Testing:**
- Complete security test suite
- Architecture integration tests
- Performance regression tests

---

## 12. CONCLUSION

This execution plan provides a systematic approach to transforming MetaIoid from a feature-rich demo into a production platform architecture. The plan prioritizes foundational security and architecture consolidation before adding frontier capabilities.

**Key Principles:**
1. Foundation First: Security and multi-user before features
2. Consolidation Early: Eliminate duplicates before adding new systems
3. Systematic Growth: Each phase builds on previous phases
4. Evidence-Based Progress: Testing and measurement at each step
5. No Random Features: Only implement according to plan

**Expected Timeline:** 52-68 weeks for complete implementation

**Success Metrics:**
- All security tests pass
- Architecture is consolidated and documented
- 50+ providers are supported
- Plugin ecosystem is functional
- All frontier capabilities are implemented
- Real-world benchmarks demonstrate performance

**Next Action:** Begin Phase 1 implementation with authentication system

---

**Plan Created:** 2026-09-22  
**Status:** Ready for Implementation  
**Next Review:** After Phase 1 Completion
