// Rate Limit Store - Abstraction for rate limiting with multiple backends
// SECURITY GATE #3: Prevents rate limit abuse and ensures user isolation
// Supports: memory (current), Redis (future), distributed backends
// Isolation: One user must not consume another user's rate budget

import { emit } from './events.js';

/**
 * Rate limit store interface
 */
class RateLimitStore {
  constructor(config = {}) {
    this.backend = config.backend || 'memory'; // memory, redis, etc.
    this.config = config;
    this.stores = {
      memory: new MemoryRateLimitStore(config),
      // Future: redis: new RedisRateLimitStore(config)
    };
  }

  /**
   * Check if rate limit is exceeded
   * @param {string} identifier - userId, ip, or composite identifier
   * @param {object} options - { route, operation, max, windowMs }
   * @returns {object} - { allowed: boolean, remaining: number, resetAt: number }
   */
  async checkLimit(identifier, options = {}) {
    const store = this.stores[this.backend];
    if (!store) {
      throw new Error(`Rate limit backend ${this.backend} not implemented`);
    }

    const result = await store.checkLimit(identifier, options);
    
    // Emit event for rate limit violations
    if (!result.allowed) {
      emit('security.rate_limit_exceeded', {
        identifier,
        route: options.route,
        operation: options.operation,
        backend: this.backend
      });
    }

    return result;
  }

  /**
   * Record a rate limit hit
   * @param {string} identifier - userId, ip, or composite identifier
   * @param {object} options - { route, operation }
   */
  async recordHit(identifier, options = {}) {
    const store = this.stores[this.backend];
    if (!store) {
      throw new Error(`Rate limit backend ${this.backend} not implemented`);
    }

    return await store.recordHit(identifier, options);
  }

  /**
   * Reset rate limit for an identifier (admin function)
   * @param {string} identifier - userId, ip, or composite identifier
   * @param {object} options - { route, operation }
   */
  async resetLimit(identifier, options = {}) {
    const store = this.stores[this.backend];
    if (!store) {
      throw new Error(`Rate limit backend ${this.backend} not implemented`);
    }

    const result = await store.resetLimit(identifier, options);
    
    emit('security.rate_limit_reset', {
      identifier,
      route: options.route,
      operation: options.operation,
      backend: this.backend
    });

    return result;
  }

  /**
   * Get rate limit statistics
   * @param {string} identifier - userId, ip, or composite identifier
   * @param {object} options - { route, operation }
   */
  async getStats(identifier, options = {}) {
    const store = this.stores[this.backend];
    if (!store) {
      throw new Error(`Rate limit backend ${this.backend} not implemented`);
    }

    return await store.getStats(identifier, options);
  }
}

/**
 * Memory-based rate limit store (current implementation)
 */
class MemoryRateLimitStore {
  constructor(config = {}) {
    this.limits = new Map(); // Map<identifier, { hits: number[], resetAt: number }>
    this.defaultMax = config.defaultMax || 100;
    this.defaultWindowMs = config.defaultWindowMs || 60000; // 1 minute
  }

  /**
   * Clean up expired entries
   */
  cleanup() {
    const now = Date.now();
    for (const [identifier, data] of this.limits.entries()) {
      if (data.resetAt <= now) {
        this.limits.delete(identifier);
      }
    }
  }

  /**
   * Check if rate limit is exceeded
   */
  async checkLimit(identifier, options = {}) {
    this.cleanup();

    const max = options.max || this.defaultMax;
    const windowMs = options.windowMs || this.defaultWindowMs;
    const now = Date.now();

    let data = this.limits.get(identifier);
    
    if (!data || data.resetAt <= now) {
      // Create new window
      data = {
        hits: [],
        resetAt: now + windowMs
      };
      this.limits.set(identifier, data);
    }

    // Filter hits within current window
    data.hits = data.hits.filter(hit => hit > now - windowMs);

    const remaining = Math.max(0, max - data.hits.length);
    const allowed = data.hits.length < max;

    return {
      allowed,
      remaining,
      resetAt: data.resetAt,
      current: data.hits.length,
      max
    };
  }

  /**
   * Record a rate limit hit
   */
  async recordHit(identifier, options = {}) {
    this.cleanup();

    const now = Date.now();
    let data = this.limits.get(identifier);
    
    if (!data) {
      const windowMs = options.windowMs || this.defaultWindowMs;
      data = {
        hits: [],
        resetAt: now + windowMs
      };
      this.limits.set(identifier, data);
    }

    data.hits.push(now);
    
    return {
      success: true,
      current: data.hits.length
    };
  }

  /**
   * Reset rate limit for an identifier
   */
  async resetLimit(identifier, options = {}) {
    this.limits.delete(identifier);
    return {
      success: true,
      message: 'Rate limit reset'
    };
  }

  /**
   * Get rate limit statistics
   */
  async getStats(identifier, options = {}) {
    this.cleanup();

    const data = this.limits.get(identifier);
    
    if (!data) {
      return {
        current: 0,
        remaining: this.defaultMax,
        resetAt: Date.now() + this.defaultWindowMs,
        max: this.defaultMax
      };
    }

    const windowMs = options.windowMs || this.defaultWindowMs;
    const now = Date.now();
    
    // Filter hits within current window
    const validHits = data.hits.filter(hit => hit > now - windowMs);

    return {
      current: validHits.length,
      remaining: Math.max(0, this.defaultMax - validHits.length),
      resetAt: data.resetAt,
      max: this.defaultMax
    };
  }
}

/**
 * Composite identifier builder for rate limiting
 */
export function buildRateLimitIdentifier(options) {
  const parts = [];
  
  if (options.userId) {
    parts.push(`user:${options.userId}`);
  } else if (options.ip) {
    parts.push(`ip:${options.ip}`);
  }
  
  if (options.route) {
    parts.push(`route:${options.route}`);
  }
  
  if (options.operation) {
    parts.push(`op:${options.operation}`);
  }
  
  if (options.authState) {
    parts.push(`auth:${options.authState}`);
  }
  
  // Default to IP if no identifier provided
  if (parts.length === 0 && options.ip) {
    parts.push(`ip:${options.ip}`);
  }
  
  return parts.join(':') || 'global';
}

/**
 * Rate limiting middleware generator
 */
export function createRateLimitMiddleware(store, options = {}) {
  const {
    max = options.max || 100,
    windowMs = options.windowMs || 60000,
    route = options.route || 'global',
    operation = options.operation
  } = options;

  return async (req, res, next) => {
    try {
      // Build identifier based on auth state
      const identifier = buildRateLimitIdentifier({
        userId: req.auth?.userId,
        ip: req.ip,
        route,
        operation,
        authState: req.auth ? 'authenticated' : 'unauthenticated'
      });

      // Check rate limit
      const result = await store.checkLimit(identifier, { max, windowMs, route, operation });

      // Add rate limit headers
      res.setHeader('X-RateLimit-Limit', result.max.toString());
      res.setHeader('X-RateLimit-Remaining', result.remaining.toString());
      res.setHeader('X-RateLimit-Reset', new Date(result.resetAt).toISOString());

      if (!result.allowed) {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000)
        });
      }

      // Record hit
      await store.recordHit(identifier, { route, operation });

      next();
    } catch (error) {
      // Fail open - don't block requests on rate limit errors
      console.error('Rate limit error:', error);
      next();
    }
  };
}

/**
 * Predefined rate limit configurations
 */
export const RateLimitPresets = {
  // Strict limits for authentication
  auth: {
    max: 5,
    windowMs: 60000, // 5 requests per minute
    route: 'auth'
  },

  // Moderate limits for general API
  api: {
    max: 100,
    windowMs: 60000, // 100 requests per minute
    route: 'api'
  },

  // Generous limits for authenticated users
  authenticated: {
    max: 200,
    windowMs: 60000, // 200 requests per minute
    authState: 'authenticated'
  },

  // Strict limits for expensive operations
  expensive: {
    max: 10,
    windowMs: 60000, // 10 requests per minute
    operation: 'expensive'
  },

  // Very strict limits for sensitive operations
  sensitive: {
    max: 3,
    windowMs: 60000, // 3 requests per minute
    operation: 'sensitive'
  }
};

// Export singleton instance
export const rateLimitStore = new RateLimitStore({
  backend: 'memory',
  defaultMax: 100,
  defaultWindowMs: 60000
});
