// Data Access Layer - Repository abstraction for clean database migration
// SECURITY GATE #4: Decouples business logic from storage implementation
// Supports: JSON (current), SQLite (future), Postgres (future)
// Repositories: User, Memory, Mission, Workspace, Device, Credential

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = process.env.METALOID_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');

/**
 * Base repository interface
 */
class BaseRepository {
  constructor(config = {}) {
    this.backend = config.backend || 'json'; // json, sqlite, postgres, etc.
    this.config = config;
  }

  /**
   * Initialize repository
   */
  async initialize() {
    // Override in subclasses
  }

  /**
   * Health check
   */
  async health() {
    return {
      status: 'healthy',
      backend: this.backend
    };
  }
}

/**
 * JSON-based repository implementation (current)
 */
class JSONRepository extends BaseRepository {
  constructor(config) {
    super(config);
    this.dataFile = path.join(DIR, `${config.collection}.json`);
    this.data = [];
    this.load();
  }

  load() {
    try {
      fs.mkdirSync(DIR, { recursive: true });
      if (fs.existsSync(this.dataFile)) {
        this.data = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
      }
    } catch { /* start empty */ }
  }

  save() {
    try {
      fs.writeFileSync(this.dataFile, JSON.stringify(this.data, null, 2).slice(0, 5_000_000));
    } catch { /* disk full — state stays in RAM */ }
  }

  async findAll(filter = {}) {
    let results = this.data;
    
    // Apply filters
    if (filter.userId) {
      results = results.filter(item => item.userId === filter.userId);
    }
    
    if (filter.projectId) {
      results = results.filter(item => item.projectId === filter.projectId);
    }
    
    if (filter.isActive !== undefined) {
      results = results.filter(item => item.isActive === filter.isActive);
    }
    
    return results;
  }

  async findById(id) {
    return this.data.find(item => item.id === id) || null;
  }

  async create(item) {
    item.id = item.id || this.generateId();
    item.createdAt = item.createdAt || new Date().toISOString();
    item.updatedAt = new Date().toISOString();
    
    this.data.unshift(item);
    this.save();
    
    return item;
  }

  async update(id, updates) {
    const index = this.data.findIndex(item => item.id === id);
    if (index === -1) return null;
    
    this.data[index] = {
      ...this.data[index],
      ...updates,
      id, // Preserve ID
      updatedAt: new Date().toISOString()
    };
    
    this.save();
    return this.data[index];
  }

  async delete(id) {
    const index = this.data.findIndex(item => item.id === id);
    if (index === -1) return false;
    
    this.data.splice(index, 1);
    this.save();
    return true;
  }

  async deleteByUserId(userId) {
    const before = this.data.length;
    this.data = this.data.filter(item => item.userId !== userId);
    this.save();
    return before - this.data.length;
  }

  generateId() {
    return `${this.config.collection}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

/**
 * User Repository
 */
export class UserRepository extends JSONRepository {
  constructor(config = {}) {
    super({ ...config, collection: 'users' });
    this.data = this.data.users || [];
  }

  save() {
    try {
      fs.writeFileSync(this.dataFile, JSON.stringify({ users: this.data }, null, 2).slice(0, 2_000_000));
    } catch { /* disk full — state stays in RAM */ }
  }

  load() {
    try {
      fs.mkdirSync(DIR, { recursive: true });
      if (fs.existsSync(this.dataFile)) {
        const loaded = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
        this.data = loaded.users || [];
      }
    } catch { /* start empty */ }
  }

  async findByHandle(handle) {
    const h = String(handle || '').trim().toLowerCase();
    return this.data.find(u => u.handle === h) || null;
  }

  async findByEmail(email) {
    const e = String(email || '').trim().toLowerCase();
    return this.data.find(u => u.email === e) || null;
  }

  async count() {
    return this.data.length;
  }
}

/**
 * Memory Repository
 */
export class MemoryRepository extends JSONRepository {
  constructor(config = {}) {
    super({ ...config, collection: 'memory' });
    this.data = this.data.records || [];
  }

  save() {
    try {
      fs.writeFileSync(this.dataFile, JSON.stringify({ records: this.data }, null, 2).slice(0, 2_000_000));
    } catch { /* disk full — state stays in RAM */ }
  }

  load() {
    try {
      fs.mkdirSync(DIR, { recursive: true });
      if (fs.existsSync(this.dataFile)) {
        const loaded = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
        this.data = loaded.records || [];
      }
    } catch { /* start empty */ }
  }

  async findByUserIdAndClass(userId, cls) {
    return this.data.filter(m => m.userId === userId && m.class === cls);
  }

  async search(userId, query, options = {}) {
    const q = String(query || '').toLowerCase();
    let results = this.data.filter(m => m.userId === userId);
    
    if (q) {
      results = results.filter(m => m.content.toLowerCase().includes(q));
    }
    
    if (options.cls) {
      results = results.filter(m => m.class === options.cls);
    }
    
    if (options.limit) {
      results = results.slice(0, options.limit);
    }
    
    return results;
  }
}

/**
 * Mission Repository
 */
export class MissionRepository extends JSONRepository {
  constructor(config = {}) {
    super({ ...config, collection: 'missions' });
    this.data = this.data.missions || [];
  }

  save() {
    try {
      fs.writeFileSync(this.dataFile, JSON.stringify({ missions: this.data }, null, 2).slice(0, 5_000_000));
    } catch { /* disk full — state stays in RAM */ }
  }

  load() {
    try {
      fs.mkdirSync(DIR, { recursive: true });
      if (fs.existsSync(this.dataFile)) {
        const loaded = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
        this.data = loaded.missions || [];
        
        // Crash recovery: RUNNING missions return to QUEUED
        this.data = this.data.map(m => {
          if (m.status === 'RUNNING') {
            m.status = 'QUEUED';
            m.timeline = m.timeline || [];
            m.timeline.push({
              at: new Date().toISOString(),
              event: 'Recovered',
              detail: 'Gateway restarted; mission re-queued from checkpoint.'
            });
          }
          return m;
        });
      }
    } catch { /* start empty */ }
  }

  async findByUserId(userId) {
    return this.data.filter(m => m.userId === userId);
  }

  async findLatestActive(userId) {
    return this.data.find(m => 
      m.userId === userId && 
      ['QUEUED', 'RUNNING', 'PAUSED', 'BLOCKED'].includes(m.status)
    ) || null;
  }

  async findByStatus(userId, status) {
    return this.data.filter(m => m.userId === userId && m.status === status);
  }
}

/**
 * Workspace Repository
 */
export class WorkspaceRepository extends JSONRepository {
  constructor(config = {}) {
    super({ ...config, collection: 'workspaces' });
    this.data = this.data.workspaces || [];
  }

  save() {
    try {
      fs.writeFileSync(this.dataFile, JSON.stringify({ workspaces: this.data }, null, 2).slice(0, 2_000_000));
    } catch { /* disk full — state stays in RAM */ }
  }

  load() {
    try {
      fs.mkdirSync(DIR, { recursive: true });
      if (fs.existsSync(this.dataFile)) {
        const loaded = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
        this.data = loaded.workspaces || [];
      }
    } catch { /* start empty */ }
  }

  async findByUserId(userId) {
    return this.data.filter(w => w.userId === userId);
  }

  async findByHandle(userId, handle) {
    const h = String(handle || '').trim().toLowerCase();
    return this.data.find(w => w.userId === userId && w.handle === h) || null;
  }
}

/**
 * Device Repository
 */
export class DeviceRepository extends JSONRepository {
  constructor(config = {}) {
    super({ ...config, collection: 'devices' });
    this.data = this.data.devices || [];
  }

  save() {
    try {
      fs.writeFileSync(this.dataFile, JSON.stringify({ devices: this.data }, null, 2).slice(0, 2_000_000));
    } catch { /* disk full — state stays in RAM */ }
  }

  load() {
    try {
      fs.mkdirSync(DIR, { recursive: true });
      if (fs.existsSync(this.dataFile)) {
        const loaded = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
        this.data = loaded.devices || [];
      }
    } catch { /* start empty */ }
  }

  async findByUserId(userId) {
    return this.data.filter(d => d.userId === userId);
  }

  async findByDeviceId(deviceId) {
    return this.data.find(d => d.deviceId === deviceId) || null;
  }

  async findActiveByUserId(userId) {
    return this.data.filter(d => d.userId === userId && d.isActive);
  }
}

/**
 * Credential Repository (delegates to CredentialVault)
 */
export class CredentialRepository extends BaseRepository {
  constructor(config = {}) {
    super(config);
    // CredentialVault handles actual storage
    this.vault = config.vault;
  }

  async initialize() {
    // CredentialVault initializes itself
  }

  async health() {
    return this.vault ? this.vault.vaultHealth() : { status: 'unavailable' };
  }

  // User credential operations delegate to vault
  async storeUserCredential(userId, providerId, credential, metadata) {
    return this.vault.storeUserCredential(userId, providerId, credential, metadata);
  }

  async getUserCredential(userId, providerId) {
    return this.vault.getUserCredential(userId, providerId);
  }

  async deleteUserCredential(userId, providerId) {
    return this.vault.deleteUserCredential(userId, providerId);
  }

  async rotateUserCredential(userId, providerId, newCredential) {
    return this.vault.rotateUserCredential(userId, providerId, newCredential);
  }

  async listUserCredentialProviders(userId) {
    return this.vault.listUserCredentialProviders(userId);
  }

  // Platform credential operations
  async storePlatformCredential(providerId, credential, metadata) {
    return this.vault.storePlatformCredential(providerId, credential, metadata);
  }

  async getPlatformCredential(providerId) {
    return this.vault.getPlatformCredential(providerId);
  }

  // Project credential operations
  async storeProjectCredential(userId, projectId, providerId, credential, metadata) {
    return this.vault.storeProjectCredential(userId, projectId, providerId, credential, metadata);
  }

  async getProjectCredential(userId, projectId, providerId) {
    return this.vault.getProjectCredential(userId, projectId, providerId);
  }

  // Audit operations
  async getCredentialAuditLog(userId, providerId) {
    return this.vault.getCredentialAuditLog(userId, providerId);
  }

  async deleteUserCredentials(userId) {
    return this.vault.deleteUserCredentials(userId);
  }
}

/**
 * Repository factory
 */
export class RepositoryFactory {
  constructor(config = {}) {
    this.config = config;
    this.repositories = {};
    this.backend = config.backend || 'json';
  }

  /**
   * Get or create repository instance
   */
  getRepository(type) {
    if (!this.repositories[type]) {
      switch (type) {
        case 'user':
          this.repositories[type] = new UserRepository(this.config);
          break;
        case 'memory':
          this.repositories[type] = new MemoryRepository(this.config);
          break;
        case 'mission':
          this.repositories[type] = new MissionRepository(this.config);
          break;
        case 'workspace':
          this.repositories[type] = new WorkspaceRepository(this.config);
          break;
        case 'device':
          this.repositories[type] = new DeviceRepository(this.config);
          break;
        case 'credential':
          this.repositories[type] = new CredentialRepository(this.config);
          break;
        default:
          throw new Error(`Unknown repository type: ${type}`);
      }
    }
    return this.repositories[type];
  }

  /**
   * Initialize all repositories
   */
  async initializeAll() {
    for (const repo of Object.values(this.repositories)) {
      await repo.initialize();
    }
  }

  /**
   * Health check for all repositories
   */
  async health() {
    const health = {
      backend: this.backend,
      repositories: {}
    };

    for (const [type, repo] of Object.entries(this.repositories)) {
      health.repositories[type] = await repo.health();
    }

    return health;
  }
}

// Export singleton factory instance
export const repositoryFactory = new RepositoryFactory({
  backend: 'json',
  vault: null // Will be set when CredentialVault is initialized
});