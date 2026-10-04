// Credential Vault - Secure credential storage with encryption and auditing
// SECURITY GATE #5: Critical prerequisite for BYOK provider platform
// USER-SCOPED: All credentials are isolated by userId
// ENCRYPTED AT REST: AES-256-GCM encryption
// AUDITED: All credential operations are logged
// REVOCABLE: Credentials can be revoked and rotated

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emit } from './events.js';
import { encrypt, decrypt, redactCredential, MASTER_KEY, ENCRYPTION_ALGORITHM } from './crypto.js';
import * as accountBridge from './accountBridge.js';

const DIR = process.env.METALOID_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const CREDENTIALS_FILE = path.join(DIR, 'credentials.json');
const AUDIT_FILE = path.join(DIR, 'credential_audit.json');

// Encryption: single implementation in ./crypto.js (file mode and Supabase
// mode produce identical ciphertext shapes). MASTER_KEY from environment in
// production (see vaultHealth().masterKeyConfigured).
void MASTER_KEY;

let credentials = { userCredentials: [], platformCredentials: [] };
let auditLog = [];

// Load persisted data
try {
  fs.mkdirSync(DIR, { recursive: true });
  if (fs.existsSync(CREDENTIALS_FILE)) {
    credentials = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
  }
  if (fs.existsSync(AUDIT_FILE)) {
    auditLog = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8'));
  }
} catch { /* start empty */ }

function persistCredentials() {
  try {
    fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2).slice(0, 5_000_000));
  } catch { /* disk full — state stays in RAM */ }
}

function persistAudit() {
  try {
    fs.writeFileSync(AUDIT_FILE, JSON.stringify(auditLog, null, 2).slice(0, 5_000_000));
  } catch { /* disk full — state stays in RAM */ }
}

const uid = (p) => `${p}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;

/**
 * A stored key the server can no longer open. Distinct from "no key": the UI
 * must offer "replace it" rather than behaving as if nothing was ever saved.
 */
function unreadableError() {
  const e = new Error('This saved key can no longer be decrypted — it was encrypted with a different server key.');
  e.code = 'credential_unreadable';
  return e;
}

function needUser(userId) {
  if (!userId || typeof userId !== 'string') throw new Error('userId required');
}

async function supa() {
  const m = await import('./supadb.js');
  return m.dbMode() ? m : null;
}

/**
 * Record audit entry
 */
function recordAudit(entry) {
  auditLog.unshift({
    ...entry,
    timestamp: new Date().toISOString(),
    id: uid('audit')
  });
  
  // Keep only last 1000 audit entries
  if (auditLog.length > 1000) {
    auditLog = auditLog.slice(0, 1000);
  }
  
  persistAudit();
  emit('security.credential_audit', { 
    action: entry.action, 
    userId: entry.userId, 
    providerId: entry.providerId 
  });
}

/**
 * Store user credential
 */
export async function storeUserCredential(userId, providerId, credential, metadata = {}) {
  needUser(userId);

  // Validate inputs
  if (!providerId || typeof providerId !== 'string') {
    throw new Error('providerId required');
  }
  if (!credential || typeof credential !== 'string') {
    throw new Error('credential required');
  }

  // The account contract is the store chat reads (providerGateway resolves
  // keys through accountBridge). Writing anywhere else saves a key the LLM
  // can never use — the exact "entered the key but nothing activated" bug —
  // so authoritative deployments write through the contract.
  if (accountIsAuthoritative()) {
    const row = await accountBridge.saveCredential(userId, providerId, credential);
    return {
      id: row.id, providerId, isActive: true,
      createdAt: row.created_at || new Date().toISOString(),
      redacted: redactCredential(credential),
    };
  }

  const db = await supa();
  if (db) {
    return db.credStore(userId, providerId, encrypt(credential), metadata, redactCredential(credential));
  }
  
  // Check if credential already exists
  const existingIndex = credentials.userCredentials.findIndex(
    c => c.userId === userId && c.providerId === providerId
  );
  
  const encrypted = encrypt(credential);
  
  const credentialRecord = {
    id: uid('cred'),
    userId,
    providerId,
    encryptedData: encrypted,
    metadata: {
      ...metadata,
      createdAt: new Date().toISOString(),
    },
    // The mask is kept beside the ciphertext so listing credentials never
    // needs to decrypt them — the same rule the contract store follows.
    maskedHint: redactCredential(credential),
    isActive: true,
    lastRotatedAt: null,
    rotationCount: 0
  };
  
  if (existingIndex >= 0) {
    // Update existing credential
    const oldCredential = credentials.userCredentials[existingIndex];
    credentials.userCredentials[existingIndex] = credentialRecord;
    
    recordAudit({
      action: 'CREDENTIAL_ROTATED',
      userId,
      providerId,
      previousRotationCount: oldCredential.rotationCount,
      newRotationCount: 0,
      metadata
    });
  } else {
    // Create new credential
    credentials.userCredentials.push(credentialRecord);
    
    recordAudit({
      action: 'CREDENTIAL_STORED',
      userId,
      providerId,
      metadata
    });
  }
  
  persistCredentials();
  
  // Return public info (never the actual credential)
  return {
    id: credentialRecord.id,
    providerId,
    isActive: true,
    createdAt: credentialRecord.metadata.createdAt,
    // Redacted for safety
    redacted: redactCredential(credential)
  };
}

/**
 * Get user credential (decrypted)
 */
/**
 * Where a credential is read from, in priority order.
 *
 * The account-data contract is authoritative: it is what the app writes when
 * a user saves a key, and it is the only path that works on a serverless host
 * (there is no filesystem to hold a vault file). The file vault below it
 * remains for local development, and the legacy `supadb` branch is kept only
 * for a database that predates the current schema.
 */
const accountIsAuthoritative = () => String(process.env.SUPABASE_DB || '').toLowerCase() === 'supabase';

export async function getUserCredential(userId, providerId) {
  needUser(userId);

  // A stored-but-unreadable key is remembered (not swallowed) so callers can
  // say "replace this key" instead of behaving as if none was ever saved. It
  // is only *reported* if no readable copy exists further down the chain.
  let contractUnreadable = null;
  let fromAccount = null;
  try {
    fromAccount = await accountBridge.credentialFor(userId, providerId);
  } catch (e) {
    if (e && e.code === 'credential_unreadable') contractUnreadable = e;
    else throw e;
  }
  if (fromAccount) {
    return {
      id: `contract:${providerId}`, providerId, credential: fromAccount,
      metadata: {}, isActive: true, lastRotatedAt: null, rotationCount: 0,
    };
  }
  // Nothing readable in the contract, and the contract is the only configured
  // store: either the account has no key, or the key it has is broken.
  if (accountIsAuthoritative()) {
    if (contractUnreadable) throw contractUnreadable;
    return null;
  }

  const db = await supa();
  if (db) {
    const row = await db.credGet(userId, providerId);
    if (!row) {
      if (contractUnreadable) throw contractUnreadable;
      return null;
    }
    try {
      const data = db.decField(row.credential);
      if (!data) throw new Error('bad shape');
      const decrypted = decrypt(data);
      await db.credAudit(userId, providerId, 'CREDENTIAL_ACCESSED', { id: row.id });
      return {
        id: row.id, providerId, credential: decrypted,
        metadata: {}, isActive: true,
        lastRotatedAt: null, rotationCount: 0,
      };
    } catch {
      await db.credAudit(userId, providerId, 'CREDENTIAL_DECRYPTION_FAILED', {});
      throw unreadableError();
    }
  }
  
  const credential = credentials.userCredentials.find(
    c => c.userId === userId && c.providerId === providerId && c.isActive
  );
  
  if (!credential) {
    // No readable copy anywhere: a broken contract row is the real answer.
    if (contractUnreadable) throw contractUnreadable;
    return null;
  }
  
  try {
    const decrypted = decrypt(credential.encryptedData);
    
    recordAudit({
      action: 'CREDENTIAL_ACCESSED',
      userId,
      providerId,
      credentialId: credential.id
    });
    
    return {
      id: credential.id,
      providerId,
      credential: decrypted,
      metadata: credential.metadata,
      isActive: credential.isActive,
      lastRotatedAt: credential.lastRotatedAt,
      rotationCount: credential.rotationCount
    };
  } catch (error) {
    recordAudit({
      action: 'CREDENTIAL_DECRYPTION_FAILED',
      userId,
      providerId,
      credentialId: credential.id,
      error: error.message
    });
    
    throw unreadableError();
  }
}

/**
 * Readability of a stored key, without ever returning the secret.
 *
 * "Has a row" is not "works": a key encrypted under a rotated server key (or
 * written by a process with an ephemeral master key) can never be opened
 * again. The health probe asks this so it cannot report a broken credential
 * as a live one — which is what left users staring at "Connected" while every
 * message failed.
 */
export async function credentialReadiness(userId, providerId) {
  try {
    const c = await getUserCredential(userId, providerId);
    return c ? 'readable' : 'absent';
  } catch (e) {
    if (e && e.code === 'credential_unreadable') return 'unreadable';
    return 'unknown';
  }
}

/**
 * Delete user credential
 */
export async function deleteUserCredential(userId, providerId) {
  needUser(userId);

  // Delete from the store that was written to: the account contract when it
  // is authoritative, otherwise the legacy branches below.
  if (accountIsAuthoritative()) {
    const removed = await accountBridge.removeCredential(userId, providerId);
    return removed ? { ok: true } : { ok: false, error: 'Credential not found' };
  }

  const db = await supa();
  if (db) return db.credDelete(userId, providerId);
  
  const index = credentials.userCredentials.findIndex(
    c => c.userId === userId && c.providerId === providerId
  );
  
  if (index === -1) {
    return { ok: false, error: 'Credential not found' };
  }
  
  const credential = credentials.userCredentials[index];
  credentials.userCredentials.splice(index, 1);
  
  persistCredentials();
  
  recordAudit({
    action: 'CREDENTIAL_DELETED',
    userId,
    providerId,
    credentialId: credential.id
  });
  
  return { ok: true };
}

/**
 * Rotate user credential by credential ID
 */
export async function rotateUserCredentialById(userId, credentialId, newCredential) {
  needUser(userId);

  // Rotation is an overwrite through the same contract store: the new secret
  // lands in the envelope chat reads, and the row is marked unproven again.
  if (accountIsAuthoritative()) {
    const rows = await accountBridge.listCredentials(userId);
    const found = rows.find((c) => c.id === credentialId);
    if (!found) return { ok: false, error: 'Credential not found' };
    const row = await accountBridge.saveCredential(userId, found.provider, newCredential);
    return { ok: true, rotationCount: row.rotation_count || 0, redacted: redactCredential(newCredential) };
  }

  const db = await supa();
  if (db) {
    return db.credRotateById(userId, credentialId, encrypt(newCredential), redactCredential(newCredential));
  }
  
  const index = credentials.userCredentials.findIndex(
    c => c.userId === userId && c.id === credentialId
  );
  
  if (index === -1) {
    return { ok: false, error: 'Credential not found' };
  }
  
  const credential = credentials.userCredentials[index];
  const oldRotationCount = credential.rotationCount;
  
  // Encrypt new credential
  const encrypted = encrypt(newCredential);
  
  // Update credential
  credentials.userCredentials[index] = {
    ...credential,
    encryptedData: encrypted,
    lastRotatedAt: new Date().toISOString(),
    rotationCount: oldRotationCount + 1
  };
  
  persistCredentials();
  
  recordAudit({
    action: 'CREDENTIAL_ROTATED',
    userId,
    providerId: credential.providerId,
    credentialId: credential.id,
    previousRotationCount: oldRotationCount,
    newRotationCount: oldRotationCount + 1
  });
  
  return { 
    ok: true, 
    rotationCount: oldRotationCount + 1,
    redacted: redactCredential(newCredential)
  };
}

/**
 * Rotate user credential (legacy - by providerId)
 */
export async function rotateUserCredential(userId, providerId, newCredential) {
  needUser(userId);

  // Same contract rule as every other write: rotate through the store chat
  // reads, so the replacement secret is usable immediately.
  if (accountIsAuthoritative()) {
    const rows = await accountBridge.listCredentials(userId);
    const found = rows.find((c) => c.provider === providerId);
    if (!found) return { ok: false, error: 'Credential not found' };
    return rotateUserCredentialById(userId, found.id, newCredential);
  }

  const db = await supa();
  if (db) {
    const list = await db.credList(userId);
    const found = list.find((c) => c.providerId === providerId);
    if (!found) return { ok: false, error: 'Credential not found' };
    return db.credRotateById(userId, found.id, encrypt(newCredential), redactCredential(newCredential));
  }
  
  const index = credentials.userCredentials.findIndex(
    c => c.userId === userId && c.providerId === providerId
  );
  
  if (index === -1) {
    return { ok: false, error: 'Credential not found' };
  }
  
  const credential = credentials.userCredentials[index];
  const oldRotationCount = credential.rotationCount;
  
  // Encrypt new credential
  const encrypted = encrypt(newCredential);
  
  // Update credential
  credentials.userCredentials[index] = {
    ...credential,
    encryptedData: encrypted,
    lastRotatedAt: new Date().toISOString(),
    rotationCount: oldRotationCount + 1
  };
  
  persistCredentials();
  
  recordAudit({
    action: 'CREDENTIAL_ROTATED',
    userId,
    providerId,
    credentialId: credential.id,
    previousRotationCount: oldRotationCount,
    newRotationCount: oldRotationCount + 1
  });
  
  return { 
    ok: true, 
    rotationCount: oldRotationCount + 1,
    redacted: redactCredential(newCredential)
  };
}

/**
 * List user's credential providers (no actual credentials)
 */
export async function listUserCredentialProviders(userId) {
  needUser(userId);

  // The contract answers first for the same reason as getUserCredential: it
  // is the store the app writes to, and the only one a serverless host has.
  const fromAccount = await accountBridge.listCredentials(userId);
  if (fromAccount.length) {
    // The mask and the last verification verdict travel with the row: the
    // Settings list shows "••••1234 · connected" or "key rejected — replace
    // it", and without these two fields every stored key rendered as an
    // anonymous "key stored", which is how a rejected key stayed invisible.
    // Every stored row is returned, including a rejected one. Hiding it made
    // "key rejected — replace it" unreachable: the row simply vanished and the
    // user was told nothing was connected, with no way to see what to fix.
    // (Chat candidate ordering skips rejected keys — see providerGateway.)
    return fromAccount.map((c) => ({
      id: c.id,
      providerId: c.provider,
      isActive: true,
      createdAt: c.updated_at,
      lastRotatedAt: null,
      rotationCount: 0,
      redacted: c.masked_hint ?? null,
      status: c.status || 'unverified',
    }));
  }
  if (accountIsAuthoritative()) return [];

  const db = await supa();
  if (db) return db.credList(userId);
  
  return credentials.userCredentials
    // Same rule as the contract store: the row is listed (so the user can see
    // and replace it) even when the provider rejected it; the router is what
    // skips rejected keys.
    .filter(c => c.userId === userId && c.isActive)
    .map(c => ({
      id: c.id,
      providerId: c.providerId,
      isActive: c.isActive,
      createdAt: c.metadata.createdAt,
      lastRotatedAt: c.lastRotatedAt,
      rotationCount: c.rotationCount,
      redacted: c.maskedHint || null,
      status: c.metadata?.testStatus === 'valid' ? 'connected' : c.metadata?.testStatus === 'invalid' ? 'invalid' : 'unverified',
    }));
}

/**
 * Store platform credential (for platform-wide provider keys)
 */
export function storePlatformCredential(providerId, credential, metadata = {}) {
  if (!providerId || typeof providerId !== 'string') {
    throw new Error('providerId required');
  }
  if (!credential || typeof credential !== 'string') {
    throw new Error('credential required');
  }
  
  const encrypted = encrypt(credential);
  
  const credentialRecord = {
    id: uid('plat_cred'),
    providerId,
    encryptedData: encrypted,
    metadata: {
      ...metadata,
      createdAt: new Date().toISOString(),
    },
    isActive: true,
    lastRotatedAt: null,
    rotationCount: 0
  };
  
  // Check if platform credential already exists
  const existingIndex = credentials.platformCredentials.findIndex(
    c => c.providerId === providerId
  );
  
  if (existingIndex >= 0) {
    credentials.platformCredentials[existingIndex] = credentialRecord;
    
    recordAudit({
      action: 'PLATFORM_CREDENTIAL_ROTATED',
      providerId,
      metadata
    });
  } else {
    credentials.platformCredentials.push(credentialRecord);
    
    recordAudit({
      action: 'PLATFORM_CREDENTIAL_STORED',
      providerId,
      metadata
    });
  }
  
  persistCredentials();
  
  return {
    id: credentialRecord.id,
    providerId,
    isActive: true,
    createdAt: credentialRecord.metadata.createdAt,
    redacted: redactCredential(credential)
  };
}

/**
 * Get platform credential (decrypted)
 */
export function getPlatformCredential(providerId) {
  const credential = credentials.platformCredentials.find(
    c => c.providerId === providerId && c.isActive
  );
  
  if (!credential) {
    return null;
  }
  
  try {
    const decrypted = decrypt(credential.encryptedData);
    
    recordAudit({
      action: 'PLATFORM_CREDENTIAL_ACCESSED',
      providerId,
      credentialId: credential.id
    });
    
    return {
      id: credential.id,
      providerId,
      credential: decrypted,
      metadata: credential.metadata,
      isActive: credential.isActive,
      lastRotatedAt: credential.lastRotatedAt,
      rotationCount: credential.rotationCount
    };
  } catch (error) {
    recordAudit({
      action: 'PLATFORM_CREDENTIAL_DECRYPTION_FAILED',
      providerId,
      credentialId: credential.id,
      error: error.message
    });
    
    throw new Error('Failed to decrypt platform credential');
  }
}

/**
 * Store project-scoped credential
 */
export function storeProjectCredential(userId, projectId, providerId, credential, metadata = {}) {
  needUser(userId);
  
  if (!projectId || typeof projectId !== 'string') {
    throw new Error('projectId required');
  }
  if (!providerId || typeof providerId !== 'string') {
    throw new Error('providerId required');
  }
  if (!credential || typeof credential !== 'string') {
    throw new Error('credential required');
  }
  
  const encrypted = encrypt(credential);
  
  const credentialRecord = {
    id: uid('proj_cred'),
    userId,
    projectId,
    providerId,
    encryptedData: encrypted,
    metadata: {
      ...metadata,
      createdAt: new Date().toISOString(),
    },
    isActive: true,
    lastRotatedAt: null,
    rotationCount: 0
  };
  
  // Add to user credentials with project scope
  credentials.userCredentials.push(credentialRecord);
  
  persistCredentials();
  
  recordAudit({
    action: 'PROJECT_CREDENTIAL_STORED',
    userId,
    projectId,
    providerId,
    metadata
  });
  
  return {
    id: credentialRecord.id,
    projectId,
    providerId,
    isActive: true,
    createdAt: credentialRecord.metadata.createdAt,
    redacted: redactCredential(credential)
  };
}

/**
 * Get project-scoped credential
 */
export function getProjectCredential(userId, projectId, providerId) {
  needUser(userId);
  
  const credential = credentials.userCredentials.find(
    c => c.userId === userId && 
       c.projectId === projectId && 
       c.providerId === providerId && 
       c.isActive
  );
  
  if (!credential) {
    return null;
  }
  
  try {
    const decrypted = decrypt(credential.encryptedData);
    
    recordAudit({
      action: 'PROJECT_CREDENTIAL_ACCESSED',
      userId,
      projectId,
      providerId,
      credentialId: credential.id
    });
    
    return {
      id: credential.id,
      projectId,
      providerId,
      credential: decrypted,
      metadata: credential.metadata,
      isActive: credential.isActive,
      lastRotatedAt: credential.lastRotatedAt,
      rotationCount: credential.rotationCount
    };
  } catch (error) {
    recordAudit({
      action: 'PROJECT_CREDENTIAL_DECRYPTION_FAILED',
      userId,
      projectId,
      providerId,
      credentialId: credential.id,
      error: error.message
    });
    
    throw new Error('Failed to decrypt project credential');
  }
}

/**
 * Get credential audit log
 */
export async function getCredentialAuditLog(userId, providerId) {
  needUser(userId);

  const db = await supa();
  if (db) return db.credAuditLog(userId, providerId);
  
  let filtered = auditLog;
  
  if (userId) {
    filtered = filtered.filter(log => log.userId === userId);
  }
  
  if (providerId) {
    filtered = filtered.filter(log => log.providerId === providerId);
  }
  
  // Remove sensitive information from audit log
  return filtered.map(log => ({
    ...log,
    // Never include actual credentials in audit log
  }));
}

/**
 * Delete all user credentials (user deletion cascade)
 */
export async function deleteUserCredentials(userId) {
  needUser(userId);

  const db = await supa();
  if (db) return db.credDeleteAll(userId);
  
  const before = credentials.userCredentials.length;
  credentials.userCredentials = credentials.userCredentials.filter(c => c.userId !== userId);
  
  persistCredentials();
  
  recordAudit({
    action: 'ALL_USER_CREDENTIALS_DELETED',
    userId,
    count: before - credentials.userCredentials.length
  });
  
  return before - credentials.userCredentials.length;
}

/**
 * Test credential validity (for provider-specific validation)
 * This function doesn't actually test the provider - it just records the test status
 * Actual provider testing should be done by the ProviderAdapter
 */
export async function setCredentialTestStatus(userId, providerId, status, metadata = {}) {
  needUser(userId);

  const db = await supa();
  if (db) {
    const r = await db.credTestStatus(userId, providerId, status, metadata);
    return r;
  }
  
  const index = credentials.userCredentials.findIndex(
    c => c.userId === userId && c.providerId === providerId
  );
  
  if (index === -1) {
    return { ok: false, error: 'Credential not found' };
  }
  
  credentials.userCredentials[index].metadata = {
    ...credentials.userCredentials[index].metadata,
    lastTestedAt: new Date().toISOString(),
    testStatus: status, // 'valid' | 'invalid' | 'unknown'
    testMetadata: metadata
  };
  
  persistCredentials();
  
  recordAudit({
    action: 'CREDENTIAL_TESTED',
    userId,
    providerId,
    credentialId: credentials.userCredentials[index].id,
    status,
    metadata
  });
  
  return { ok: true, status };
}

/**
 * Get credential test status
 */
export async function getCredentialTestStatus(userId, providerId) {
  needUser(userId);

  const db = await supa();
  if (db) return db.credTestGet(userId, providerId);
  
  const credential = credentials.userCredentials.find(
    c => c.userId === userId && c.providerId === providerId
  );
  
  if (!credential) {
    return null;
  }
  
  return {
    providerId,
    lastTestedAt: credential.metadata.lastTestedAt,
    testStatus: credential.metadata.testStatus || 'unknown',
    testMetadata: credential.metadata.testMetadata || {}
  };
}

/**
 * Health check for credential vault
 */
export function vaultHealth() {
  return {
    status: 'healthy',
    userCredentialCount: credentials.userCredentials.length,
    platformCredentialCount: credentials.platformCredentials.length,
    auditLogEntries: auditLog.length,
    encryptionAlgorithm: ENCRYPTION_ALGORITHM,
    masterKeyConfigured: !!process.env.METALOID_CREDENTIAL_KEY
  };
}
