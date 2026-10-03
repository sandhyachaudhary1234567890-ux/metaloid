# METAIOID PROVIDER ARCHITECTURE

## Canonical Architecture

```
USER
↓
Authentication (Bearer Token)
↓
CredentialVault (Encrypted Storage)
↓
ProviderRegistry (Provider Manifests)
↓
ProviderRoutingEngine (Selection Logic)
↓
ProviderAdapter (Standardized Interface)
↓
Provider API (External Service)
↓
Normalized Response
↓
Verification
↓
AgentRuntime
```

## Core Components

### 1. CredentialVault

**Purpose:** Secure, user-scoped credential storage with encryption, rotation, and audit trail.

**Data Structure:**
```javascript
{
  credentialId: string,
  userId: string,
  providerId: string,
  workspaceId?: string,
  projectId?: string,
  encryptedCredential: string, // AES-256-GCM
  salt: string,
  keyDerivationIterations: number,
  metadata: {
    name: string,
    description?: string,
    createdAt: number,
    updatedAt: number,
    lastUsedAt: number,
    lastTestedAt: number,
    testStatus: 'valid' | 'invalid' | 'unknown'
  },
  auditTrail: Array<{
    action: 'create' | 'read' | 'test' | 'rotate' | 'revoke' | 'delete',
    timestamp: number,
    userId: string,
    ipAddress?: string,
    userAgent?: string
  }>
}
```

**Operations:**
- `createCredential(userId, providerId, credential, options)` - Create encrypted credential
- `getCredential(userId, credentialId)` - Retrieve decrypted credential (internal only)
- `testCredential(userId, credentialId)` - Validate credential with provider
- `rotateCredential(userId, credentialId, newCredential)` - Rotate credential
- `revokeCredential(userId, credentialId)` - Revoke credential
- `deleteCredential(userId, credentialId)` - Delete credential
- `listCredentials(userId, providerId?, scope?)` - List user credentials
- `auditLog(userId, credentialId)` - Get credential audit trail

**Security Features:**
- AES-256-GCM encryption at rest
- PBKDF2 key derivation (100,000 iterations)
- User-scoped isolation
- Optional workspace/project scoping
- Comprehensive audit trail
- Never returns raw secrets in API responses
- Credentials redacted from logs

### 2. ProviderRegistry

**Purpose:** Canonical registry of provider manifests and capabilities.

**Provider Manifest:**
```javascript
{
  providerId: string,
  name: string,
  category: 'LLM' | 'REASONING' | 'VISION' | 'IMAGE' | 'VIDEO' | 'STT' | 'TTS' | 'SEARCH' | 'RESEARCH' | 'EMBEDDING' | 'OCR' | 'CODE' | 'DOCUMENT_AI',
  authSchema: {
    type: 'bearer_token' | 'api_key' | 'oauth2' | 'custom',
    credentialType: 'string' | 'object',
    documentationUrl: string
  },
  capabilities: {
    streaming: boolean,
    async: boolean,
    webhooks: boolean,
    contextLimit?: number,
    maxOutputTokens?: number,
    supportedModalities: string[]
  },
  models: Array<{
    modelId: string,
    displayName: string,
    capabilities: string[],
    contextLimit?: number,
    streaming: boolean,
    async: boolean,
    availability: 'public' | 'beta' | 'enterprise'
  }>,
  healthCheck: {
    endpoint: string,
    method: 'GET' | 'POST',
    timeout: number,
    healthyStatus: number[]
  },
  adapterVersion: string,
  documentationUrl: string,
  pricingUrl?: string,
  rateLimits?: {
    requestsPerMinute?: number,
    tokensPerMinute?: number,
    concurrentRequests?: number
  }
}
```

**Operations:**
- `registerProvider(manifest)` - Register provider
- `getProvider(providerId)` - Get provider manifest
- `listProviders(category?)` - List providers by category
- `updateProvider(providerId, manifest)` - Update provider
- `deregisterProvider(providerId)` - Remove provider
- `getProviderModels(providerId)` - Get provider models

### 3. ProviderAdapter Contract

**Purpose:** Standardized interface for all provider implementations.

**Adapter Interface:**
```javascript
class ProviderAdapter {
  constructor(providerId, credentialVault) {
    this.providerId = providerId;
    this.credentialVault = credentialVault;
  }

  // Authentication & Credential Validation
  async authenticate(userId, credentialId) {
    // Validate credential with provider
    // Returns: { valid: boolean, error?: string }
  }

  async validateCredential(credential) {
    // Validate credential format
    // Returns: { valid: boolean, error?: string }
  }

  // Model Discovery
  async listModels(userId, credentialId) {
    // Fetch available models from provider
    // Returns: Array<Model>
  }

  // Request Validation
  async validateRequest(request) {
    // Validate request against provider capabilities
    // Returns: { valid: boolean, error?: string }
  }

  // Execution
  async execute(userId, credentialId, request) {
    // Execute request (non-streaming)
    // Returns: { result, model, usage }
  }

  async stream(userId, credentialId, request, onToken) {
    // Execute request (streaming)
    // Returns: { result, model, usage }
  }

  async poll(userId, credentialId, jobId) {
    // Poll async job status
    // Returns: { status, result?, error? }
  }

  async cancel(userId, credentialId, jobId) {
    // Cancel async job
    // Returns: { cancelled: boolean }
  }

  // Response Normalization
  normalizeResponse(providerResponse) {
    // Normalize provider response to standard format
    // Returns: { text, model, usage, metadata }
  }

  // Error Normalization
  normalizeError(providerError) {
    // Normalize provider error to standard types
    // Returns: { type, message, code, retryable }
  }

  // Health Check
  async healthCheck(userId, credentialId) {
    // Check provider health
    // Returns: { status: 'healthy' | 'degraded' | 'auth_failed' | 'rate_limited' | 'unavailable', latency?: number }
  }
}
```

**Standardized Error Types:**
```javascript
const ErrorTypes = {
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  TIMEOUT: 'TIMEOUT',
  INVALID_REQUEST: 'INVALID_REQUEST',
  UNAVAILABLE: 'UNAVAILABLE',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  MODEL_UNAVAILABLE: 'MODEL_UNAVAILABLE',
  CONTENT_REJECTED: 'CONTENT_REJECTED',
  UNKNOWN: 'UNKNOWN'
};
```

### 4. ProviderRoutingEngine

**Purpose:** Intelligent provider selection based on task, capabilities, user preferences, and health.

**Routing Decision:**
```javascript
{
  primary: {
    providerId: string,
    modelId: string,
    credentialId: string,
    reason: string
  },
  fallback: Array<{
    providerId: string,
    modelId: string,
    credentialId: string,
    reason: string
  }>,
  confidence: number
}
```

**Routing Inputs:**
```javascript
{
  task: {
    type: 'chat' | 'vision' | 'coding' | 'image_generation' | 'research' | etc.,
    requirements: {
      streaming?: boolean,
      contextLimit?: number,
      modalities?: string[],
      latency?: 'low' | 'normal' | 'high',
      cost?: 'free' | 'paid' | 'any'
    }
  },
  userPreferences: {
    defaultProvider?: string,
    fallbackProviders?: string[],
    excludedProviders?: string[],
    privacy?: 'high' | 'normal' | 'low'
  },
  projectPolicy?: {
    requiredProviders?: string[],
    excludedProviders?: string[],
    budget?: number
  },
  availableCredentials: Array<{
    providerId: string,
    credentialId: string,
    testStatus: 'valid' | 'invalid' | 'unknown'
  }>,
  providerHealth: Map<string, {
    status: 'healthy' | 'degraded' | 'auth_failed' | 'rate_limited' | 'unavailable',
    latency?: number,
    lastCheck: number
  }>,
  modelCapabilities: Map<string, Model>
}
```

**Routing Logic:**
1. Filter providers by capability match
2. Filter by user authorization (valid credentials)
3. Filter by project policy (required/excluded providers)
4. Filter by health status (exclude unavailable)
5. Rank by user preferences (default provider first)
6. Rank by task requirements (latency, cost, capabilities)
7. Select primary provider
8. Generate fallback candidates (same capability, different provider)
9. Return routing decision with confidence score

### 5. ProviderHealth

**Purpose:** Track provider health status per provider and per user credential.

**Health Status:**
```javascript
{
  providerId: string,
  userId?: string,
  credentialId?: string,
  status: 'healthy' | 'degraded' | 'auth_failed' | 'rate_limited' | 'unavailable',
  latency?: number,
  lastCheck: number,
  lastSuccess: number,
  lastFailure: number,
  failureCount: number,
  successCount: number,
  errorSummary?: string
}
```

**Health Tracking:**
- Per-provider global health (infrastructure issues)
- Per-user credential health (credential-specific issues)
- Automatic health checks with configurable TTL
- Health status caching with invalidation on credential changes
- Rate limiting detection and recovery

### 6. ModelCatalog

**Purpose:** Normalized model registry with capabilities and metadata.

**Model Record:**
```javascript
{
  providerId: string,
  modelId: string,
  displayName: string,
  capabilities: {
    text: boolean,
    vision: boolean,
    coding: boolean,
    reasoning: boolean,
    functionCalling: boolean,
    streaming: boolean,
    async: boolean
  },
  contextLimit: number,
  maxOutputTokens: number,
  pricing?: {
    inputPer1k: number,
    outputPer1k: number,
    currency: string
  },
  availability: 'public' | 'beta' | 'enterprise',
  modalities: string[],
  languages: string[]
}
```

**Operations:**
- `registerModel(model)` - Register model
- `getModel(providerId, modelId)` - Get model details
- `listModels(providerId?, capability?)` - List models by criteria
- `updateModel(providerId, modelId, data)` - Update model
- `removeModel(providerId, modelId)` - Remove model

### 7. AsyncJobSystem

**Purpose:** Generic async job abstraction for long-running provider tasks (image generation, video generation, etc.).

**Job Record:**
```javascript
{
  jobId: string,
  userId: string,
  providerId: string,
  credentialId: string,
  type: 'image_generation' | 'video_generation' | 'research' | etc.,
  status: 'SUBMITTED' | 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'EXPIRED',
  input: any,
  output?: any,
  error?: string,
  providerJobId?: string,
  createdAt: number,
  startedAt?: number,
  completedAt?: number,
  expiresAt?: number,
  progress?: number,
  metadata?: any
}
```

**Operations:**
- `createJob(userId, providerId, credentialId, type, input)` - Create job
- `submitJob(jobId)` - Submit to provider
- `pollJob(jobId)` - Poll job status
- `cancelJob(jobId)` - Cancel job
- `getJob(jobId)` - Get job details
- `listJobs(userId, status?)` - List user jobs
- `expireJobs()` - Clean up expired jobs

**Webhook Support:**
- Webhook endpoint for provider callbacks
- Webhook signature verification
- Automatic job status updates

## Data Flow

### 1. Provider Execution Flow

```
User Request
↓
AgentRuntime: "I need LLM capability"
↓
ProviderRoutingEngine.resolveProvider({
  task: { type: 'chat', requirements: {...} },
  userPreferences: {...},
  availableCredentials: [...],
  providerHealth: {...}
})
↓
Routing Decision: { primary: {...}, fallback: [...] }
↓
CredentialVault.getCredential(userId, credentialId) [Internal]
↓
ProviderAdapter.execute(userId, credentialId, request)
↓
Provider API Call
↓
ProviderAdapter.normalizeResponse(providerResponse)
↓
ProviderHealth.updateStatus(providerId, credentialId, success)
↓
Normalized Result
↓
Verification
↓
AgentRuntime
```

### 2. Fallback Flow

```
Primary Provider Fails
↓
ProviderAdapter.normalizeError(error)
↓
Is Error Retryable?
↓
Yes → ProviderRoutingEngine.selectFallback()
↓
Next Provider from Fallback List
↓
Repeat Execution Flow
↓
No Fallbacks Available → Return Error
```

### 3. Credential Management Flow

```
User: "Add OpenAI Provider"
↓
Frontend: POST /api/providers/credentials { providerId, credential }
↓
Backend: CredentialVault.createCredential(userId, providerId, credential)
↓
CredentialVault.testCredential(userId, credentialId)
↓
ProviderAdapter.authenticate(userId, credentialId)
↓
Test Result: Valid/Invalid
↓
CredentialVault.updateTestStatus(userId, credentialId, result)
↓
Response: { credentialId, testStatus }
```

## API Endpoints

### Provider Management
- `GET /api/providers` - List available providers
- `GET /api/providers/:providerId` - Get provider details
- `GET /api/providers/:providerId/models` - List provider models

### Credential Management
- `POST /api/providers/credentials` - Add provider credential
- `GET /api/providers/credentials` - List user credentials
- `GET /api/providers/credentials/:credentialId` - Get credential (metadata only)
- `POST /api/providers/credentials/:credentialId/test` - Test credential
- `PUT /api/providers/credentials/:credentialId` - Rotate credential
- `DELETE /api/providers/credentials/:credentialId` - Revoke credential
- `GET /api/providers/credentials/:credentialId/audit` - Get credential audit trail

### User Preferences
- `GET /api/providers/preferences` - Get user provider preferences
- `PUT /api/providers/preferences` - Update user provider preferences
- `POST /api/providers/preferences/default` - Set default provider
- `POST /api/providers/preferences/fallback` - Set fallback providers

### Provider Usage
- `GET /api/providers/usage` - Get provider usage statistics
- `GET /api/providers/health` - Get provider health status

### Async Jobs
- `POST /api/providers/jobs` - Create async job
- `GET /api/providers/jobs/:jobId` - Get job status
- `POST /api/providers/jobs/:jobId/cancel` - Cancel job
- `GET /api/providers/jobs` - List user jobs

## Security Model

### Credential Isolation
- **User-scoped:** Each user's credentials are isolated
- **Workspace-scoped:** Optional workspace-level credential isolation
- **Project-scoped:** Optional project-level credential isolation
- **Cross-user protection:** User A cannot access User B's credentials
- **Audit trail:** All credential operations are logged

### Key Protection
- **Never in logs:** Credentials are redacted from all logs
- **Never in API responses:** Raw credentials never returned
- **Never in frontend:** Credentials never stored in localStorage/sessionStorage
- **Encryption at rest:** AES-256-GCM encryption
- **Secure transmission:** HTTPS only

### Authorization
- **Authentication required:** All provider endpoints require Bearer token
- **Ownership checks:** Server-side ownership validation
- **Rate limiting:** Per-user rate limiting on provider operations
- **BYOK enforcement:** No platform-owned credentials (BYOK_ONLY mode)

## BYOK Modes

### BYOK_ONLY (Default)
- Users must provide their own provider credentials
- No platform-owned credentials
- Clear error when no valid credential: "Connect an LLM provider to use MetaIoid"

### PLATFORM_CREDITS (Future)
- Platform provides shared credentials
- Usage metered and billed
- Quota management per user

### HYBRID (Future)
- Users can use own credentials or platform credits
- Fallback to platform credits when user credentials unavailable
- Clear cost attribution

## Migration Strategy

### Phase 1: Credential Foundation
1. Integrate existing CredentialVault
2. Migrate environment variable keys to user-default credentials
3. Add provider credential endpoints
4. Add credential isolation tests

### Phase 2: Provider Architecture
1. Implement ProviderRegistry
2. Define ProviderAdapter contract
3. Create ProviderRoutingEngine
4. Implement ProviderHealth
5. Create ModelCatalog

### Phase 3: Adapter Migration
1. Refactor OpenRouter to adapter pattern
2. Refactor NVIDIA to adapter pattern
3. Add OpenAI adapter
4. Add Anthropic adapter
5. Add Google adapter

### Phase 4: Frontend Integration
1. Add provider settings UI
2. Add credential management UI
3. Implement provider preference management
4. Add provider usage visualization

### Phase 5: Provider Expansion
1. Add provider health monitoring
2. Implement async job system
3. Add provider usage observability
4. Expand to 50+ providers

## Testing Strategy

### Unit Tests
- CredentialVault operations (create, read, test, rotate, revoke, delete)
- ProviderRegistry operations (register, update, deregister)
- ProviderAdapter contract compliance
- ProviderRoutingEngine logic
- ProviderHealth tracking
- ModelCatalog operations

### Integration Tests
- End-to-end provider execution
- Fallback logic
- Credential isolation
- Cross-user access prevention
- Credential rotation
- Health check accuracy

### Security Tests
- User A cannot read User B credentials
- User A cannot modify User B credentials
- Revoked credentials stop working
- Rotated credentials replace old ones
- Keys never appear in logs
- Keys never appear in API responses
- Keys never appear in URLs
- Cross-project credential isolation
- Cross-workspace credential isolation
- Expired sessions cannot access vault

### Contract Tests
- Authentication
- Credential validation
- Model discovery
- Request normalization
- Response normalization
- Error normalization
- Rate limiting
- Timeout
- Cancellation
- Secret redaction

## Observability

### Metrics to Track
- Provider usage (per provider, per user)
- Model usage (per model, per user)
- Latency (p50, p95, p99)
- Success/failure rates
- Fallback usage
- Credential validity rate
- Health check results
- Rate limit hits

### Logging
- Provider calls (without secrets)
- Routing decisions
- Fallback triggers
- Health status changes
- Credential operations (audit trail)

### Monitoring
- Provider health alerts
- Credential failure alerts
- Rate limit warnings
- Usage quota alerts
- Error rate spikes

## Performance Considerations

### Caching
- Provider manifest cache (TTL: 1 hour)
- Model catalog cache (TTL: 30 minutes)
- Health status cache (TTL: 5 minutes)
- Routing decision cache (TTL: 1 minute)

### Optimization
- Avoid expensive discovery on every request
- Pre-fetch model catalogs
- Health check batching
- Connection pooling
- Request deduplication

### Cache Invalidation
- On credential changes
- On provider metadata changes
- On health status expiration
- On manual invalidation

## Error Handling

### Retry Strategy
- Exponential backoff for retryable errors
- Max retry limit (3 attempts)
- Fallback to next provider on persistent failure
- No retry for non-retryable errors (auth_failed, invalid_request)

### Error Types
- **Retryable:** rate_limited, timeout, unavailable
- **Non-retryable:** auth_failed, invalid_request, quota_exceeded, content_rejected
- **Fallback-triggered:** model_unavailable, rate_limited (with fallback)

### User Communication
- Clear error messages
- Suggested actions (e.g., "Check your API key")
- Provider-specific guidance
- Fallback notifications

## Future Extensions

### Provider Features
- Custom provider registration (user-defined adapters)
- Provider marketplace (community adapters)
- Provider templates (quick-start configurations)
- Provider groups (multi-provider strategies)

### Advanced Routing
- Cost optimization routing
- Latency optimization routing
- Quality optimization routing
- Multi-provider ensemble (multiple providers for single request)

### Credential Management
- Credential sharing (team/workspace)
- Credential templates
- Credential rotation automation
- Credential expiration alerts

### Observability
- Real-time provider dashboards
- Cost breakdown per provider
- Performance comparison
- Anomaly detection

## Conclusion

This architecture provides a secure, scalable foundation for the MetaIoid provider platform. The canonical components (CredentialVault, ProviderRegistry, ProviderAdapter, ProviderRoutingEngine, ProviderHealth, ModelCatalog) enable:

1. **Secure BYOK:** User-scoped, encrypted credential storage
2. **Provider Agnosticism:** Standardized adapter interface
3. **Intelligent Routing:** Capability-based provider selection
4. **Reliability:** Health tracking and fallback
5. **Extensibility:** Easy addition of new providers
6. **Observability:** Comprehensive monitoring and auditing

The architecture is designed to scale from 2 providers to 50+ providers without requiring core system rewrites.
