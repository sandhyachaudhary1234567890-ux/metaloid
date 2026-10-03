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
export async function getUserCredential(userId, providerId) {
  needUser(userId);

  const db = await supa();
  if (db) {
    const row = await db.credGet(userId, providerId);
    if (!row) return null;
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
      throw new Error('Failed to decrypt credential');
    }
  }
  
  const credential = credentials.userCredentials.find(
    c => c.userId === userId && c.providerId === providerId && c.isActive
  );
  
  if (!credential) {
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
    
    throw new Error('Failed to decrypt credential');
  }
}

/**
 * Delete user credential
 */
export async function deleteUserCredential(userId, providerId) {
  needUser(userId);

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

  const db = await supa();
  if (db) return db.credList(userId);
  
  return credentials.userCredentials
    .filter(c => c.userId === userId && c.isActive)
    .map(c => ({
      id: c.id,
      providerId: c.providerId,
      isActive: c.isActive,
      createdAt: c.metadata.createdAt,
      lastRotatedAt: c.lastRotatedAt,
      rotationCount: c.rotationCount
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
