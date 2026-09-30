# METAIOID PROVIDER AUDIT

## Executive Summary

MetaIoid currently has a **limited but functional provider implementation** with 2 real providers (OpenRouter, NVIDIA) and several frontend mock providers. The credential handling is **centralized in environment variables**, which is a **security risk** for a multi-user BYOK platform.

## Existing Provider Implementations

### Backend Providers (REAL)

#### 1. OpenRouter Integration
**File:** `server/src/openrouter.js`

**Status:** ✅ IMPLEMENTED
- **Functionality:** Model listing, streaming chat, task classification, model selection
- **Credential Handling:** `process.env.OPENROUTER_API_KEY` (single global key)
- **Models:** Free model catalog with tier classification (vision, coding, fast, smart)
- **Streaming:** SSE streaming support
- **Error Handling:** Retryable error detection (404, 429)
- **Caching:** 5-minute model catalog cache
- **Fallback:** Static fallback models when API unreachable

**API Routes:**
- `GET /api/models` - List free models
- `POST /api/chat` - Streaming chat with OpenRouter

**Security Concerns:**
- ⚠️ Single global API key shared across all users
- ⚠️ No user-scoped credential isolation
- ⚠️ No credential rotation/revocation
- ⚠️ Key exposed in process.env

#### 2. NVIDIA Integration
**File:** `server/src/nvidia.js`

**Status:** ✅ IMPLEMENTED
- **Functionality:** OpenAI-compatible streaming interface
- **Credential Handling:** `process.env.NVIDIA_API_KEY` (single global key)
- **Models:** Single model `nvidia/llama-3.1-nemotron-70b-instruct`
- **Streaming:** SSE streaming support
- **Usage:** Fallback provider when OpenRouter fails on smart tasks

**Security Concerns:**
- ⚠️ Single global API key shared across all users
- ⚠️ No user-scoped credential isolation
- ⚠️ Key exposed in process.env
- ⚠️ Limited to single model

### Frontend Providers (MOCK)

#### 1. OpenRouter Mock
**File:** `src/providers/openrouter.ts`

**Status:** ❌ MOCK ONLY
- **Functionality:** Placeholder functions returning mock responses
- **Credential Handling:** None (server-side planned)
- **Purpose:** UI placeholder for future backend integration

**Security Concerns:**
- ⚠️ No real provider connectivity
- ⚠️ TODO comments indicate this should be replaced

#### 2. Vision Mock
**File:** `src/providers/vision.ts`

**Status:** ❌ MOCK ONLY
- **Functionality:** Random mock vision responses
- **Credential Handling:** None
- **Purpose:** UI placeholder for vision provider

**Security Concerns:**
- ⚠️ No real vision provider connectivity
- ⚠️ Deterministic mock responses

#### 3. STT Mock
**File:** `src/providers/stt.ts`

**Status:** ❌ MOCK ONLY
- **Functionality:** Simulated transcription with mock transcripts
- **Credential Handling:** None
- **Purpose:** Placeholder for speech-to-text provider

**Security Concerns:**
- ⚠️ No real STT provider connectivity
- ⚠️ `isSTSAvailable()` returns false

#### 4. TTS Mock
**File:** `src/providers/tts.ts`

**Status:** ❌ MOCK ONLY
- **Functionality:** Mock speech synthesis with timing simulation
- **Credential Handling:** None
- **Purpose:** Placeholder for text-to-speech provider

**Security Concerns:**
- ⚠️ No real TTS provider connectivity
- ⚠️ Only Web Speech API integration (local)

#### 5. Camera Provider
**File:** `src/providers/camera.ts`

**Status:** ✅ IMPLEMENTED (Local)
- **Functionality:** Browser camera access via getUserMedia
- **Credential Handling:** None (local browser API)
- **Purpose:** Frontend camera preview

**Security Concerns:**
- ✅ Uses standard browser API
- ✅ No credential exposure

## Current API Routes

### Provider-Related Routes
- `GET /api/models` - List OpenRouter free models
- `POST /api/chat` - Streaming chat (currently OpenRouter only)

### Model Selection Logic
- Task classification: vision, coding, fast, smart
- Model tier selection based on task type
- Fallback candidates for retry logic
- NVIDIA fallback for smart tasks when OpenRouter fails

## Credential Handling Assessment

### Current Implementation
**Storage:** Environment variables (`OPENROUTER_API_KEY`, `NVIDIA_API_KEY`)
**Scope:** Global (shared across all users)
**Rotation:** Not supported
**Revocation:** Not supported
**Audit Trail:** None
**Encryption:** None (plain text in process.env)

### Security Risks
1. **CRITICAL:** No user credential isolation - all users share same keys
2. **CRITICAL:** No credential rotation capability
3. **CRITICAL:** No credential revocation
4. **HIGH:** Keys exposed in process.env (logged to crash dumps)
5. **HIGH:** No audit trail for credential usage
6. **MEDIUM:** No credential testing/validation
7. **MEDIUM:** No credential expiration management

## Architecture Gaps

### Missing Components
1. **Credential Vault** - No secure user-scoped credential storage
2. **Provider Registry** - No canonical provider manifest system
3. **Provider Adapter Contract** - No standardized adapter interface
4. **Provider Routing Engine** - No intelligent provider selection
5. **Provider Health System** - No health tracking per provider/user
6. **Model Catalog** - No normalized model capability registry
7. **User Provider Settings** - No user provider management UI/backend
8. **BYOK Enforcement** - No BYOK-only mode
9. **Fallback System** - No structured fallback logic
10. **Error Normalization** - No standardized error types
11. **Async Job System** - No async job abstraction for long-running tasks
12. **Provider Security Tests** - No credential isolation tests

### Provider Categories Not Implemented
- REASONING
- IMAGE
- VIDEO
- SEARCH
- RESEARCH
- EMBEDDING
- OCR
- CODE
- DOCUMENT_AI

## Reuse Candidates

### Keep and Enhance
1. **OpenRouter Integration** (`server/src/openrouter.js`)
   - ✅ Keep core streaming logic
   - ✅ Keep model classification
   - ✅ Keep caching strategy
   - ❌ Replace credential handling with CredentialVault
   - ❌ Move to adapter pattern

2. **NVIDIA Integration** (`server/src/nvidia.js`)
   - ✅ Keep OpenAI-compatible streaming
   - ❌ Replace credential handling with CredentialVault
   - ❌ Move to adapter pattern
   - ❌ Add model discovery

### Remove/Replace
1. **Frontend Mock Providers** (`src/providers/*`)
   - ❌ Replace all mock providers with real adapters
   - ❌ Remove mock responses
   - ✅ Keep camera provider (local, functional)

## Migration Strategy

### Phase 1: Credential Foundation
1. Implement CredentialVault with user-scoped storage
2. Migrate existing env keys to user-default credentials
3. Add credential testing/validation
4. Add credential rotation/revocation

### Phase 2: Provider Architecture
1. Create ProviderRegistry with provider manifests
2. Define ProviderAdapter contract
3. Refactor OpenRouter to adapter pattern
4. Refactor NVIDIA to adapter pattern
5. Create ProviderRoutingEngine

### Phase 3: Provider Expansion
1. Implement high-value adapters (OpenAI, Anthropic, Google)
2. Add provider health tracking
3. Create normalized model catalog
4. Implement structured fallback system

### Phase 4: UI Integration
1. Add provider settings backend endpoints
2. Add provider management UI
3. Implement BYOK-only mode
4. Add provider usage observability

## Security Requirements

### Immediate (Before BYOK Launch)
1. ✅ User-scoped credential storage (CredentialVault)
2. ✅ Credential encryption at rest
3. ✅ Credential audit trail
4. ✅ Credential rotation/revocation
5. ✅ Cross-user credential isolation tests
6. ✅ Key redaction from logs
7. ✅ Key redaction from API responses

### Before 50+ Providers
1. Provider health tracking
2. Provider-specific rate limiting
3. Credential validation per provider
4. Provider error normalization
5. Async job system for long-running tasks
6. Provider usage observability

## Next Actions

### Priority 1: Security Foundation
1. **Implement CredentialVault** (already exists in security gate)
2. **Migrate OpenRouter to use CredentialVault**
3. **Migrate NVIDIA to use CredentialVault**
4. **Add provider credential endpoints**
5. **Add credential isolation tests**

### Priority 2: Provider Architecture
1. **Create ProviderRegistry**
2. **Define ProviderAdapter contract**
3. **Refactor OpenRouter to adapter**
4. **Refactor NVIDIA to adapter**
5. **Create ProviderRoutingEngine**

### Priority 3: Provider Expansion
1. **Implement OpenAI adapter**
2. **Implement Anthropic adapter**
3. **Implement Google adapter**
4. **Add provider health tracking**
5. **Create model catalog**

## Conclusion

The current provider implementation is **functional but not scalable** for a multi-user BYOK platform. The foundation exists (OpenRouter streaming, NVIDIA fallback), but critical security and architecture gaps must be addressed before adding 50+ providers.

**Critical Path:**
1. CredentialVault integration (security gate已完成)
2. Provider architecture standardization
3. Adapter pattern migration
4. User provider management
5. Provider expansion

**Risk Assessment:**
- **HIGH RISK:** Current credential handling (global keys)
- **MEDIUM RISK:** No provider isolation
- **LOW RISK:** Limited provider support (2 real providers)

**Recommendation:** Proceed with immediate security foundation work, then architectural standardization before adding new providers.
