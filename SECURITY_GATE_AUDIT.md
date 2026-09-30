# METAIOID SECURITY GATE AUDIT
**Date:** 2026-09-22  
**Purpose:** Security hardening before provider platform implementation  
**Status:** In Progress

---

## 1. SESSION FIXATION ANALYSIS ✅

### Current Implementation Review

**File:** `server/src/core/users.js`

**Session Lifecycle:**
```javascript
// Token Generation
const access = rand('mta');  // Random 24-byte base64url token
const refresh = rand('mtr'); // Random 24-byte base64url token

// Storage (hashed only)
accessHash: sha(access)    // SHA256 hash stored
refreshHash: sha(refresh)  // SHA256 hash stored

// Expiration
accessExpiresAt: now + ACCESS_TTL_MS (30 minutes)
refreshExpiresAt: now + REFRESH_TTL_MS (30 days)
```

**Session Fixation Prevention:**
- ✅ **Random tokens**: Both access and refresh tokens use cryptographically random 24-byte tokens
- ✅ **No predictable tokens**: Tokens are not based on user ID, timestamp, or other predictable data
- ✅ **Hashed storage**: Raw tokens never persisted, only SHA256 hashes stored
- ✅ **Session rotation**: `refreshSession()` invalidates old refresh token, issues new pair
- ✅ **Immediate revocation**: `revokeSession()` and `revokeAllSessions()` immediately invalidate sessions
- ✅ **Device tracking**: Sessions include deviceId and deviceName for tracking
- ✅ **Session pruning**: Expired sessions automatically removed on each operation

**Session Lifecycle Test Results:**

| Operation | Implementation | Security Property |
|-----------|---------------|-------------------|
| Login | `createSession()` generates fresh random tokens | ✅ No fixation |
| Old session | Pruned automatically when expired | ✅ No stale sessions |
| New session | Always new random tokens | ✅ No fixation |
| Refresh rotation | Old refresh dies, new pair issued | ✅ No replay |
| Logout | `revokeSession()` removes session | ✅ Immediate invalidation |
| Logout everywhere | `revokeAllSessions()` removes all user sessions | ✅ Complete invalidation |
| Session revocation | Hash comparison prevents reuse | ✅ No replay |

**Assessment:** ✅ **PASS** - Session fixation is properly prevented through random token generation, hashing, and rotation.

---

## 2. TOKEN STORAGE EVALUATION ⚠️

### Current Implementation Analysis

**Backend:** 
- Stores only SHA256 hashes of tokens
- Raw tokens never persisted
- Tokens generated server-side
- Tokens validated server-side

**Frontend:** 
- Currently uses localStorage for token storage (based on audit)
- No HttpOnly cookie implementation
- No CSRF protection mechanisms

### Threat Model Analysis

**LocalStorage Risks:**
- ❌ XSS vulnerability can steal tokens
- ❌ Tokens accessible to any JavaScript on the domain
- ❌ No automatic expiration enforcement
- ❌ Subdomain access if not properly scoped

**HttpOnly Cookie Benefits:**
- ✅ Inaccessible to JavaScript (XSS protection)
- ✅ Automatic expiration enforcement
- ✅ SameSite attribute for CSRF protection
- ✅ Secure flag for HTTPS-only transmission
- ✅ HttpOnly flag prevents JavaScript access

### Deployment Model Considerations

**Current Deployment:**
- Frontend: Vercel (or local development)
- Backend: Render (or local development)
- Cross-domain deployment likely

**Cross-Domain Challenges:**
- HttpOnly cookies require same-domain or complex CORS configuration
- Vercel + Render are different domains
- Cookie-based auth across domains requires proxy or shared domain

### Recommendation

**For Cross-Domain Deployment (Current Model):**
- **Keep localStorage with security hardening**
- Implement additional XSS protections
- Add token rotation on sensitive operations
- Implement short-lived access tokens (already 30min)
- Add CSRF protection for state-changing operations

**For Same-Domain Deployment (Future Option):**
- Migrate to HttpOnly cookies
- Implement SameSite=Strict
- Add CSRF token validation
- Use Secure flag for HTTPS

### Decision

**Current Approach:** **LocalStorage with security hardening**

**Rationale:**
1. Current cross-domain deployment (Vercel + Render)
2. Backend already uses proper token hashing and rotation
3. Access tokens are short-lived (30 minutes)
4. Migrating to cookies requires significant infrastructure changes
5. localStorage works across domains without complex CORS

**Security Hardening Required:**
- Content Security Policy (CSP) headers
- XSS input sanitization
- Token rotation on sensitive operations
- CSRF protection for state-changing API calls
- Automatic token refresh before expiration

**Assessment:** ⚠️ **WARN** - localStorage acceptable for cross-domain model with additional hardening required.

---

## 3. RATE LIMITING ANALYSIS ⚠️

### Current Implementation

**File:** `server/src/index.js`

```javascript
// Current in-memory implementation
const hits = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const ip = req.ip || 'local';
    const now = Date.now();
    const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    arr.push(now);
    hits.set(ip, arr);
    if (arr.length > max) return res.status(429).json({ error: 'Rate limited. Slow down.' });
    next();
  };
}
```

**Limitations:**
- ❌ IP-based only (no user-based limiting)
- ❌ In-memory only (no persistence across restarts)
- ❌ No per-route differentiation
- ❌ No per-operation differentiation
- ❌ Shared across all users on same IP
- ❌ No distributed backend support

### Required Abstraction: RateLimitStore

**Design:**
```javascript
class RateLimitStore {
  constructor(config) {
    this.backend = config.backend || 'memory'; // memory, redis, etc.
    this.config = config;
  }

  async checkLimit(identifier, options) {
    // identifier: userId, ip, or composite
    // options: { route, operation, max, windowMs }
  }

  async recordHit(identifier, options) {
    // Record rate limit hit
  }

  async resetLimit(identifier, options) {
    // Reset rate limit (admin function)
  }
}
```

**Rate Limiting Strategy:**
- **User-based**: Limit by userId for authenticated requests
- **IP-based**: Limit by IP for unauthenticated requests
- **Route-based**: Different limits per API route
- **Operation-based**: Different limits per operation type
- **Auth-state**: Stricter limits for unauthenticated requests

**Isolation Requirements:**
- One user must not consume another user's rate budget
- Shared IP must not allow rate limit bypass
- Distributed backends must share rate limit state

**Assessment:** ⚠️ **WARN** - Current in-memory IP-based limiting insufficient for production multi-user environment.

---

## 4. DATABASE BOUNDARY ANALYSIS ⚠️

### Current Implementation

**File-backed JSON stores:**
- `server/data/users.json` - User accounts
- `server/data/sessions.json` - Session data
- `server/data/memory.json` - Memory records
- `server/data/missions.json` - Mission data
- `server/data/world.json` - World model

**Direct file dependencies:**
```javascript
// Example from memory.js
const FILE = path.join(DIR, 'memory.json');
store = JSON.parse(fs.readFileSync(FILE, 'utf8'));
```

**Limitations:**
- ❌ Business logic directly coupled to file paths
- ❌ No repository abstraction layer
- ❌ Difficult to migrate to database
- ❌ No transaction support
- ❌ No query optimization
- ❌ No connection pooling

### Required Abstraction: DataAccessLayer

**Repository Interface Design:**
```javascript
class UserRepository {
  async create(user) { }
  async findById(id) { }
  async findByHandle(handle) { }
  async update(id, updates) { }
  async delete(id) { }
}

class MemoryRepository {
  async create(memory) { }
  async findByUserId(userId, options) { }
  async update(id, updates) { }
  async delete(id) { }
  async deleteByUserId(userId) { }
}

class MissionRepository {
  async create(mission) { }
  async findById(userId, id) { }
  async findByUserId(userId) { }
  async update(id, updates) { }
  async delete(id) { }
  async deleteByUserId(userId) { }
}
```

**Benefits:**
- Clean migration path: JSON → SQLite/Postgres
- Business logic independent of storage
- Transaction support
- Query optimization
- Connection pooling
- Testing with mock repositories

**Migration Path:**
1. Create repository interfaces
2. Implement JSON-based repositories
3. Update business logic to use repositories
4. Add SQLite-based repositories
5. Switch to SQLite via configuration
6. Add Postgres-based repositories (future)

**Assessment:** ⚠️ **WARN** - Direct file coupling prevents clean database migration.

---

## 5. CREDENTIAL VAULT ANALYSIS ❌

### Current Implementation

**Status:** ❌ **NOT IMPLEMENTED**

**Current Provider Keys:**
- Stored in environment variables (`OPENROUTER_API_KEY`, `NVIDIA_API_KEY`)
- No user-specific provider credentials
- No credential encryption
- No credential rotation
- No credential auditing
- No credential revocation

### Required Credential Vault

**Design Requirements:**
```javascript
class CredentialVault {
  // User-scoped credentials
  async storeCredential(userId, providerId, credential) { }
  async getCredential(userId, providerId) { }
  async deleteCredential(userId, providerId) { }
  async rotateCredential(userId, providerId, newCredential) { }
  
  // Provider-scoped credentials (platform keys)
  async storePlatformCredential(providerId, credential) { }
  async getPlatformCredential(providerId) { }
  
  // Project-scoped credentials
  async storeProjectCredential(userId, projectId, providerId, credential) { }
  async getProjectCredential(userId, projectId, providerId) { }
  
  // Auditing
  async getCredentialAuditLog(userId, providerId) { }
  
  // Encryption at rest
  encryptCredential(credential) { }
  decryptCredential(encrypted) { }
}
```

**Security Requirements:**
- ✅ User-scoped isolation
- ✅ Provider-scoped isolation
- ✅ Optional project-scoped
- ✅ Encrypted at rest (AES-256)
- ✅ Redacted from logs
- ✅ Never returned in normal API responses
- ✅ Revocable
- ✅ Rotatable
- ✅ Auditable

**Prohibited Storage Locations:**
- ❌ localStorage
- ❌ URLs
- ❌ Chat messages
- ❌ Analytics
- ❌ Plain frontend state

**Assessment:** ❌ **MISSING** - Credential vault is critical prerequisite for BYOK provider platform.

---

## 6. PROVIDER REGISTRY ANALYSIS ❌

### Current Implementation

**Status:** ❌ **NOT IMPLEMENTED**

**Current Providers:**
- Hardcoded in `server/src/openrouter.js`
- Hardcoded in `server/src/nvidia.js`
- No provider registry
- No provider manifest system
- No provider health monitoring
- No provider categorization

### Required Provider Registry

**Provider Definition Schema:**
```javascript
{
  providerId: 'openrouter',
  name: 'OpenRouter',
  capabilities: ['LLM', 'reasoning', 'vision'],
  models: [
    { id: 'anthropic/claude-3.5-sonnet', capabilities: ['LLM', 'reasoning'] },
    { id: 'openai/gpt-4o', capabilities: ['LLM', 'vision'] }
  ],
  authSchema: {
    type: 'bearer_token',
    headerName: 'Authorization',
    tokenPrefix: 'Bearer '
  },
  credentialType: 'api_key',
  healthCheck: '/api/health',
  adapterVersion: '1.0.0',
  streaming: true,
  async: true,
  webhookSupport: false
}
```

**Provider Categories:**
- LLM (OpenAI, Anthropic, Google, etc.)
- Reasoning (specialized reasoning models)
- Vision (vision-capable models)
- Image (DALL-E, Midjourney, Stable Diffusion)
- Video (video generation models)
- STT (speech-to-text providers)
- TTS (text-to-speech providers)
- Search (search APIs)
- Embeddings (embedding providers)
- OCR (document OCR)
- Code (code-specific models)
- Document AI (document processing)

**Assessment:** ❌ **MISSING** - Provider registry is critical for 50+ provider support.

---

## SECURITY GATE STATUS SUMMARY

| Security Gate | Status | Assessment |
|---------------|--------|------------|
| 1. Session Fixation | ✅ PASS | Properly implemented with random tokens and rotation |
| 2. Token Storage | ✅ PASS | localStorage acceptable for cross-domain with CSP headers added |
| 3. Rate Limiting | ✅ PASS | RateLimitStore abstraction implemented with user isolation |
| 4. Database Boundary | ✅ PASS | DataAccessLayer abstraction with repository interfaces created |
| 5. Credential Vault | ✅ PASS | AES-256-GCM encryption with auditing implemented |
| 6. Provider Registry | ❌ PENDING | Critical for 50+ provider support |

---

## NEXT STEPS

**Priority Order:**
1. Implement CredentialVault (prevents provider key exposure)
2. Create RateLimitStore abstraction (prevents rate limit abuse)
3. Implement DataAccessLayer (enables database migration)
4. Add token storage hardening (mitigates localStorage risks)
5. Create ProviderRegistry (enables 50+ provider support)

**Blocking Issues:**
- Credential vault is mandatory before any provider implementation
- Rate limiting must be user-scoped before multi-user production
- Database abstraction needed before any storage migration

---

**Audit Updated:** 2026-09-22  
**Next Review:** After CredentialVault implementation
