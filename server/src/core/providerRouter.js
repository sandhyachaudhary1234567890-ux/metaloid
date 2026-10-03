// Provider Routing Engine - Intelligent provider selection based on task, capabilities, and preferences
// PROVIDER PLATFORM #7: Provider selection logic with fallback support
// Inputs: task, user preferences, project policy, available credentials, provider health
// Output: primary provider, fallback candidates, routing reason

import { getProvider, listProviders, getProviderModels } from './providerRegistry.js';
import { getUserCredential, listUserCredentialProviders, getCredentialTestStatus } from './credentialVault.js';

/**
 * Routing Decision
 */
export class RoutingDecision {
  constructor(primary, fallback = [], confidence = 0.8) {
    this.primary = primary;
    this.fallback = fallback;
    this.confidence = confidence;
  }
}

/**
 * Provider Routing Engine
 */
export class ProviderRoutingEngine {
  constructor(credentialVault) {
    this.credentialVault = credentialVault;
    this.routingCache = new Map();
    this.cacheTTL = 60000; // 1 minute cache
  }
  
  /**
   * Resolve provider for a task
   */
  async resolveProvider(userId, routingContext) {
    const {
      task,
      userPreferences = {},
      projectPolicy = {},
      providerHealth = new Map(),
      modelCapabilities = new Map()
    } = routingContext;
    
    // Check cache
    const cacheKey = this._getCacheKey(userId, task, userPreferences);
    const cached = this.routingCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.decision;
    }
    
    // Get available credentials
    const availableCredentials = await this._getAvailableCredentials(userId);
    
    // Filter providers by capability match
    const capableProviders = this._filterByCapability(task, availableCredentials);
    
    // Filter by user authorization
    const authorizedProviders = this._filterByAuthorization(capableProviders, userPreferences, projectPolicy);
    
    // Filter by health status
    const healthyProviders = this._filterByHealth(authorizedProviders, providerHealth);
    
    if (healthyProviders.length === 0) {
      throw new Error('No healthy providers available. Connect a provider to use MetaIoid.');
    }
    
    // Rank providers
    const rankedProviders = this._rankProviders(healthyProviders, task, userPreferences, providerHealth);
    
    // Select primary provider
    const primary = rankedProviders[0];
    
    // Generate fallback candidates
    const fallback = rankedProviders.slice(1, 4); // Top 3 fallbacks
    
    // Build routing decision
    const decision = new RoutingDecision(
      {
        providerId: primary.providerId,
        modelId: primary.modelId,
        credentialId: primary.credentialId,
        reason: primary.reason
      },
      fallback.map(f => ({
        providerId: f.providerId,
        modelId: f.modelId,
        credentialId: f.credentialId,
        reason: f.reason
      })),
      primary.confidence
    );
    
    // Cache decision
    this.routingCache.set(cacheKey, {
      timestamp: Date.now(),
      decision
    });
    
    return decision;
  }
  
  /**
   * Get available credentials for user
   */
  async _getAvailableCredentials(userId) {
    const credentialProviders = await listUserCredentialProviders(userId);
    
    return credentialProviders.map(cp => ({
      providerId: cp.providerId,
      credentialId: cp.id,
      testStatus: 'unknown'
    }));
  }
  
  /**
   * Filter providers by capability match
   */
  _filterByCapability(task, availableCredentials) {
    const result = [];
    
    for (const cred of availableCredentials) {
      const provider = getProvider(cred.providerId);
      if (!provider) continue;
      
      // Check if provider supports required capabilities
      const supportsCapability = this._checkCapabilityMatch(task, provider);
      
      if (supportsCapability) {
        // Select best model for task
        const modelId = this._selectBestModel(task, provider);
        
        result.push({
          providerId: cred.providerId,
          credentialId: cred.credentialId,
          modelId,
          testStatus: cred.testStatus,
          provider
        });
      }
    }
    
    return result;
  }
  
  /**
   * Check if provider supports task requirements
   */
  _checkCapabilityMatch(task, provider) {
    const { type, requirements = {} } = task;
    
    // Check streaming requirement
    if (requirements.streaming && !provider.capabilities.streaming) {
      return false;
    }
    
    // Check async requirement
    if (requirements.async && !provider.capabilities.async) {
      return false;
    }
    
    // Check modality requirements
    if (requirements.modalities && requirements.modalities.length > 0) {
      const hasAllModalities = requirements.modalities.every(modality =>
        provider.capabilities.supportedModalities.includes(modality)
      );
      if (!hasAllModalities) {
        return false;
      }
    }
    
    // Check task type compatibility
    if (type === 'vision' && !provider.capabilities.supportedModalities.includes('vision')) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Select best model for task
   */
  _selectBestModel(task, provider) {
    const { type, requirements = {} } = task;
    const models = provider.models;
    
    if (models.length === 0) {
      return null;
    }
    
    // If specific model requested, use it
    if (requirements.modelId) {
      const requested = models.find(m => m.modelId === requirements.modelId);
      if (requested) return requested.modelId;
    }
    
    // Select based on task type
    if (type === 'vision') {
      const visionModel = models.find(m => m.capabilities.includes('vision'));
      if (visionModel) return visionModel.modelId;
    }
    
    if (type === 'coding') {
      const codingModel = models.find(m => m.capabilities.includes('coding'));
      if (codingModel) return codingModel.modelId;
    }
    
    // Default to first model
    return models[0].modelId;
  }
  
  /**
   * Filter by user authorization and project policy
   */
  _filterByAuthorization(providers, userPreferences, projectPolicy) {
    let result = providers;
    
    // Apply project policy
    if (projectPolicy.requiredProviders && projectPolicy.requiredProviders.length > 0) {
      result = result.filter(p => projectPolicy.requiredProviders.includes(p.providerId));
    }
    
    if (projectPolicy.excludedProviders && projectPolicy.excludedProviders.length > 0) {
      result = result.filter(p => !projectPolicy.excludedProviders.includes(p.providerId));
    }
    
    // Apply user preferences
    if (userPreferences.excludedProviders && userPreferences.excludedProviders.length > 0) {
      result = result.filter(p => !userPreferences.excludedProviders.includes(p.providerId));
    }
    
    return result;
  }
  
  /**
   * Filter by health status
   */
  _filterByHealth(providers, providerHealth) {
    return providers.filter(p => {
      const health = providerHealth.get(p.providerId);
      
      // If no health info, assume healthy
      if (!health) return true;
      
      // Exclude unhealthy providers
      const unhealthyStatuses = ['auth_failed', 'unavailable'];
      return !unhealthyStatuses.includes(health.status);
    });
  }
  
  /**
   * Rank providers by preferences and task requirements
   */
  _rankProviders(providers, task, userPreferences, providerHealth) {
    const ranked = providers.map(p => {
      let score = 0;
      const reasons = [];
      
      // User default provider gets highest priority
      if (userPreferences.defaultProvider === p.providerId) {
        score += 100;
        reasons.push('User default');
      }
      
      // User fallback providers get priority
      if (userPreferences.fallbackProviders && userPreferences.fallbackProviders.includes(p.providerId)) {
        score += 50;
        reasons.push('User fallback');
      }
      
      // Health status affects score
      const health = providerHealth.get(p.providerId);
      if (health) {
        if (health.status === 'healthy') {
          score += 20;
          reasons.push('Healthy');
        } else if (health.status === 'degraded') {
          score += 10;
          reasons.push('Degraded');
        } else if (health.status === 'rate_limited') {
          score -= 30;
          reasons.push('Rate limited');
        }
      }
      
      // Latency preference
      if (task.requirements?.latency === 'low' && health?.latency) {
        // Lower latency = higher score
        score += Math.max(0, 50 - health.latency / 100);
        reasons.push('Low latency');
      }
      
      // Cost preference
      if (task.requirements?.cost === 'free') {
        // Could add free tier detection here
        score += 10;
        reasons.push('Cost preference');
      }
      
      // Task-specific capability match
      if (task.type === 'vision' && p.provider.capabilities.supportedModalities.includes('vision')) {
        score += 30;
        reasons.push('Vision capable');
      }
      
      if (task.type === 'coding' && p.provider.capabilities.supportedModalities.includes('coding')) {
        score += 30;
        reasons.push('Coding capable');
      }
      
      return {
        ...p,
        score,
        reason: reasons.join(', ') || 'Available',
        confidence: Math.min(1, score / 100)
      };
    });
    
    // Sort by score descending
    ranked.sort((a, b) => b.score - a.score);
    
    return ranked;
  }
  
  /**
   * Select fallback provider
   */
  selectFallback(routingDecision, failedProviderId) {
    // Find next fallback that is not the failed provider
    const nextFallback = routingDecision.fallback.find(f => f.providerId !== failedProviderId);
    
    if (!nextFallback) {
      throw new Error('No fallback providers available');
    }
    
    return nextFallback;
  }
  
  /**
   * Invalidate cache for user
   */
  invalidateCache(userId) {
    for (const [key, value] of this.routingCache.entries()) {
      if (key.startsWith(userId)) {
        this.routingCache.delete(key);
      }
    }
  }
  
  /**
   * Generate cache key
   */
  _getCacheKey(userId, task, userPreferences) {
    const taskKey = `${task.type}-${task.requirements?.streaming}-${task.requirements?.latency}`;
    const prefKey = userPreferences.defaultProvider || 'none';
    return `${userId}-${taskKey}-${prefKey}`;
  }
  
  /**
   * Get routing statistics
   */
  getStats() {
    return {
      cacheSize: this.routingCache.size,
      cacheTTL: this.cacheTTL
    };
  }
}

/**
 * Create default routing engine
 */
export function createRoutingEngine(credentialVault) {
  return new ProviderRoutingEngine(credentialVault);
}
