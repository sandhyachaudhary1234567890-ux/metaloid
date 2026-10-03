// Shared crypto — AES-256-GCM credential encryption (single implementation).
// Used by credentialVault (file mode) and supadb (Supabase mode) so both
// paths produce byte-identical ciphertext shapes. MASTER_KEY should be set
// via METALOID_CREDENTIAL_KEY in production; dev falls back to an ephemeral
// key (vault decryptable only within the same process boot).

import crypto from 'node:crypto';

export const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
export const KEY_LENGTH = 32;
export const IV_LENGTH = 16;
export const SALT_LENGTH = 64;

export const MASTER_KEY = process.env.METALOID_CREDENTIAL_KEY || crypto.randomBytes(KEY_LENGTH).toString('hex');

export function deriveKey(masterKey, salt) {
  return crypto.pbkdf2Sync(masterKey, salt, 100000, KEY_LENGTH, 'sha256');
}

export function encrypt(plaintext, masterKey = MASTER_KEY) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(masterKey, salt);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return {
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    encrypted,
    authTag: authTag.toString('hex'),
  };
}

export function decrypt(encryptedData, masterKey = MASTER_KEY) {
  const salt = Buffer.from(encryptedData.salt, 'hex');
  const key = deriveKey(masterKey, salt);
  const iv = Buffer.from(encryptedData.iv, 'hex');
  const authTag = Buffer.from(encryptedData.authTag, 'hex');
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function redactCredential(value) {
  if (!value || typeof value !== 'string') return '[REDACTED]';
  if (value.length <= 8) return '****';
  return value.substring(0, 4) + '****' + value.substring(value.length - 4);
}
