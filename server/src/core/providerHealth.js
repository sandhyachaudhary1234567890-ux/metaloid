// Provider Health System - Track provider health status per provider and per user credential
// PROVIDER PLATFORM #8: Health tracking with automatic detection and recovery
// Status: healthy, degraded, auth_failed, rate_limited, unavailable

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emit } from './events.js';

const DIR = process.env.METALOID_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const HEALTH_FILE = path.join(DIR, 'provider_health.json');

const HEALTH_TTL = 5 * 60 * 1000; // 5 minutes
const FAILURE_THRESHOLD = 3; // Consecutive failures before marking unhealthy
const RECOVERY_THRESHOLD = 2; // Consecutive successes before marking healthy

let healthStore = {
  global: {}, // Provider-level health (infrastructure issues)
  perUser: {} // User-credential-level health (credential-specific issues)
};

// Load persisted health data
try {
  fs.mkdirSync(DIR, { recursive: true });
  if (fs.existsSync(HEALTH_FILE)) {
    healthStore = JSON.parse(fs.readFileSync(HEALTH_FILE, 'utf8'));
  }
} catch { /* start empty */ }

function persistHealth() {
  try {
    fs.writeFileSync(HEALTH_FILE, JSON.stringify(healthStore, null, 2).slice(0, 5_000_000));
  } catch { /* disk full — state stays in RAM */ }
}

/**
 * Health Status Types
 */
export const HealthStatus = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  AUTH_FAILED: 'auth_failed',
  RATE_LIMITED: 'rate_limited',
  UNAVAILABLE: 'unavailable'
};

/**
 * Provider Health Manager
 */
export class ProviderHealthManager {
  constructor() {
    // Housekeeping, not work: this timer must never be the reason a process
    // stays alive. Un-unref'd it pinned the event loop of anything that merely
    // imported the gateway — a short-lived script, a test run, or a serverless
    // instance that should be free to freeze the moment its request is done.
    this.cleanupInterval = setInterval(() => this._cleanupExpired(), 60000);
    if (typeof this.cleanupInterval.unref === 'function') this.cleanupInterval.unref();
  }
  
  /**
   * Record provider call result
   */
  recordCall(providerId, userId, credentialId, success, latency, error = null) {
    const now = Date.now();
    
    // Update global health
    this._updateGlobalHealth(providerId, success, latency, error, now);
    
    // Update per-user health if userId provided
    if (userId && credentialId) {
      this._updateUserHealth(providerId, userId, credentialId, success, latency, error, now);
    }
    
    persistHealth();
    
    // Emit event for monitoring
    emit('provider.health_update', {
      providerId,
      userId,
      success,
      latency,
      status: this.getHealthStatus(providerId, userId, credentialId)
    });
  }
  
  /**
   * Update global provider health
   */
  _updateGlobalHealth(providerId, success, latency, error, now) {
    if (!healthStore.global[providerId]) {
      healthStore.global[providerId] = {
        status: HealthStatus.HEALTHY,
        lastCheck: now,
        lastSuccess: now,
        lastFailure: null,
        failureCount: 0,
        successCount: 0,
        latency: null,
        errorSummary: null
      };
    }
    
    const health = healthStore.global[providerId];
    health.lastCheck = now;
    
    if (success) {
      health.lastSuccess = now;
      health.successCount++;
      health.failureCount = 0; // Reset on success
      
      // Update latency (moving average)
      if (latency) {
        health.latency = health.latency ? (health.latency * 0.8 + latency * 0.2) : latency;
      }
      
      // Check recovery
      if (health.status !== HealthStatus.HEALTHY && health.successCount >= RECOVERY_THRESHOLD) {
        health.status = HealthStatus.HEALTHY;
        health.errorSummary = null;
      }
    } else {
      health.lastFailure = now;
      health.failureCount++;
      
      // Classify error type
      if (error) {
        if (error.includes('auth') || error.includes('401') || error.includes('403')) {
          health.status = HealthStatus.AUTH_FAILED;
        } else if (error.includes('rate') || error.includes('429')) {
          health.status = HealthStatus.RATE_LIMITED;
        } else if (error.includes('timeout') || error.includes('408')) {
          health.status = HealthStatus.DEGRADED;
        } else {
          health.status = HealthStatus.UNAVAILABLE;
        }
        health.errorSummary = error.substring(0, 200);
      }
      
      // Mark unhealthy after threshold
      if (health.failureCount >= FAILURE_THRESHOLD) {
        if (health.status === HealthStatus.HEALTHY) {
          health.status = HealthStatus.DEGRADED;
        }
      }
    }
  }
  
  /**
   * Update per-user credential health
   */
  _updateUserHealth(providerId, userId, credentialId, success, latency, error, now) {
    const userKey = `${userId}`;
    const credKey = `${providerId}:${credentialId}`;
    
    if (!healthStore.perUser[userKey]) {
      healthStore.perUser[userKey] = {};
    }
    
    if (!healthStore.perUser[userKey][credKey]) {
      healthStore.perUser[userKey][credKey] = {
        providerId,
        credentialId,
        status: HealthStatus.HEALTHY,
        lastCheck: now,
        lastSuccess: now,
        lastFailure: null,
        failureCount: 0,
        successCount: 0,
        latency: null,
        errorSummary: null
      };
    }
    
    const health = healthStore.perUser[userKey][credKey];
    health.lastCheck = now;
    
    if (success) {
      health.lastSuccess = now;
      health.successCount++;
      health.failureCount = 0;
      
      if (latency) {
        health.latency = health.latency ? (health.latency * 0.8 + latency * 0.2) : latency;
      }
      
      if (health.status !== HealthStatus.HEALTHY && health.successCount >= RECOVERY_THRESHOLD) {
        health.status = HealthStatus.HEALTHY;
        health.errorSummary = null;
      }
    } else {
      health.lastFailure = now;
      health.failureCount++;
      
      if (error) {
        if (error.includes('auth') || error.includes('401') || error.includes('403')) {
          health.status = HealthStatus.AUTH_FAILED;
        } else if (error.includes('rate') || error.includes('429')) {
          health.status = HealthStatus.RATE_LIMITED;
        } else if (error.includes('timeout') || error.includes('408')) {
          health.status = HealthStatus.DEGRADED;
        } else {
          health.status = HealthStatus.UNAVAILABLE;
        }
        health.errorSummary = error.substring(0, 200);
      }
      
      if (health.failureCount >= FAILURE_THRESHOLD) {
        if (health.status === HealthStatus.HEALTHY) {
          health.status = HealthStatus.DEGRADED;
        }
      }
    }
  }
  
  /**
   * Get health status
   */
  getHealthStatus(providerId, userId = null, credentialId = null) {
    // If userId and credentialId provided, return per-user health
    if (userId && credentialId) {
      const userKey = userId;
      const credKey = `${providerId}:${credentialId}`;
      const userHealth = healthStore.perUser[userKey]?.[credKey];
      
      if (userHealth) {
        return {
          status: userHealth.status,
          latency: userHealth.latency,
          lastCheck: userHealth.lastCheck,
          lastSuccess: userHealth.lastSuccess,
          lastFailure: userHealth.lastFailure,
          failureCount: userHealth.failureCount,
          successCount: userHealth.successCount,
          errorSummary: userHealth.errorSummary
        };
      }
      
      // Fallback to global health if no per-user data
    }
    
    // Return global health
    const globalHealth = healthStore.global[providerId];
    
    if (globalHealth) {
      return {
        status: globalHealth.status,
        latency: globalHealth.latency,
        lastCheck: globalHealth.lastCheck,
        lastSuccess: globalHealth.lastSuccess,
        lastFailure: globalHealth.lastFailure,
        failureCount: globalHealth.failureCount,
        successCount: globalHealth.successCount,
        errorSummary: globalHealth.errorSummary
      };
    }
    
    // No health data - assume healthy
    return {
      status: HealthStatus.HEALTHY,
      latency: null,
      lastCheck: null,
      lastSuccess: null,
      lastFailure: null,
      failureCount: 0,
      successCount: 0,
      errorSummary: null
    };
  }
  
  /**
   * Get all provider health statuses
   */
  getAllHealthStatuses() {
    const result = {};
    
    for (const [providerId, health] of Object.entries(healthStore.global)) {
      result[providerId] = {
        global: { ...health },
        users: {}
      };
      
      // Add per-user health for this provider
      for (const [userId, userHealths] of Object.entries(healthStore.perUser)) {
        for (const [credKey, credHealth] of Object.entries(userHealths)) {
          if (credHealth.providerId === providerId) {
            result[providerId].users[userId] = credHealth;
          }
        }
      }
    }
    
    return result;
  }
  
  /**
   * Get user's credential health statuses
   */
  getUserHealthStatuses(userId) {
    const userHealths = healthStore.perUser[userId] || {};
    
    return Object.entries(userHealths).map(([credKey, health]) => ({
      providerId: health.providerId,
      credentialId: health.credentialId,
      status: health.status,
      latency: health.latency,
      lastCheck: health.lastCheck,
      lastSuccess: health.lastSuccess,
      lastFailure: health.lastFailure,
      failureCount: health.failureCount,
      successCount: health.successCount,
      errorSummary: health.errorSummary
    }));
  }
  
  /**
   * Reset health status (manual recovery)
   */
  resetHealthStatus(providerId, userId = null, credentialId = null) {
    if (userId && credentialId) {
      const userKey = userId;
      const credKey = `${providerId}:${credentialId}`;
      
      if (healthStore.perUser[userKey]?.[credKey]) {
        healthStore.perUser[userKey][credKey].status = HealthStatus.HEALTHY;
        healthStore.perUser[userKey][credKey].failureCount = 0;
        healthStore.perUser[userKey][credKey].errorSummary = null;
        persistHealth();
        return true;
      }
    } else {
      if (healthStore.global[providerId]) {
        healthStore.global[providerId].status = HealthStatus.HEALTHY;
        healthStore.global[providerId].failureCount = 0;
        healthStore.global[providerId].errorSummary = null;
        persistHealth();
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Clean up expired health data
   */
  _cleanupExpired() {
    const now = Date.now();
    let cleaned = 0;
    
    // Clean up per-user health that hasn't been checked recently
    for (const [userId, userHealths] of Object.entries(healthStore.perUser)) {
      for (const [credKey, health] of Object.entries(userHealths)) {
        if (health.lastCheck && now - health.lastCheck > HEALTH_TTL * 10) {
          delete healthStore.perUser[userId][credKey];
          cleaned++;
        }
      }
      
      // Remove empty user entries
      if (Object.keys(healthStore.perUser[userId]).length === 0) {
        delete healthStore.perUser[userId];
      }
    }
    
    if (cleaned > 0) {
      persistHealth();
    }
  }
  
  /**
   * Get health statistics
   */
  getStats() {
    const globalCount = Object.keys(healthStore.global).length;
    const userCount = Object.keys(healthStore.perUser).length;
    const totalUserHealths = Object.values(healthStore.perUser).reduce((sum, uh) => sum + Object.keys(uh).length, 0);
    
    const statusCounts = {
      [HealthStatus.HEALTHY]: 0,
      [HealthStatus.DEGRADED]: 0,
      [HealthStatus.AUTH_FAILED]: 0,
      [HealthStatus.RATE_LIMITED]: 0,
      [HealthStatus.UNAVAILABLE]: 0
    };
    
    for (const health of Object.values(healthStore.global)) {
      statusCounts[health.status]++;
    }
    
    return {
      globalProviderCount: globalCount,
      userCount,
      totalUserCredentialHealths: totalUserHealths,
      statusDistribution: statusCounts
    };
  }
  
  /**
   * Shutdown cleanup
   */
  shutdown() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

/**
 * Global health manager instance
 */
let globalHealthManager = null;

/**
 * Get or create global health manager
 */
export function getHealthManager() {
  if (!globalHealthManager) {
    globalHealthManager = new ProviderHealthManager();
  }
  return globalHealthManager;
}

/**
 * Record provider call (convenience function)
 */
export function recordProviderCall(providerId, userId, credentialId, success, latency, error) {
  const manager = getHealthManager();
  manager.recordCall(providerId, userId, credentialId, success, latency, error);
}

/**
 * Get provider health status (convenience function)
 */
export function getProviderHealth(providerId, userId = null, credentialId = null) {
  const manager = getHealthManager();
  return manager.getHealthStatus(providerId, userId, credentialId);
}
