// ContextFabric - Canonical context orchestration layer
// METAIOID AGENT 1: ContextFabric + MetaCode Repository Intelligence
// Enable MetaIoid to work with large codebases through intelligent context retrieval

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emit } from './events.js';

const DIR = process.env.METALOID_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const CONTEXT_CACHE_DIR = path.join(DIR, 'context_cache');
const INDEX_CACHE_DIR = path.join(DIR, 'codebase_index');

// Ensure cache directories exist
try {
  fs.mkdirSync(CONTEXT_CACHE_DIR, { recursive: true });
  fs.mkdirSync(INDEX_CACHE_DIR, { recursive: true });
} catch { /* ignore */ }

/**
 * Context Tiers
 */
export const ContextTiers = {
  LIVE: 'LIVE',
  ACTIVE_TASK: 'ACTIVE_TASK',
  PROJECT: 'PROJECT',
  LONG_TERM: 'LONG_TERM',
  ARCHIVE: 'ARCHIVE'
};

/**
 * Context Budget Allocation (percentages)
 */
const BUDGET_ALLOCATION = {
  [ContextTiers.LIVE]: 0.10,        // 10% - Current interaction
  [ContextTiers.ACTIVE_TASK]: 0.20, // 20% - Current task state
  [ContextTiers.PROJECT]: 0.40,     // 40% - Project architecture
  [ContextTiers.LONG_TERM]: 0.20,   // 20% - Historical knowledge
  [ContextTiers.ARCHIVE]: 0.10      // 10% - On-demand retrieval
};

/**
 * Context Scoring Weights
 */
const SCORING_WEIGHTS = {
  taskRelevance: 0.35,
  projectRelevance: 0.25,
  dependencyImportance: 0.15,
  recency: 0.10,
  confidence: 0.10,
  userPriority: 0.05,
  verificationValue: 0.05
};

/**
 * Context Item
 */
class ContextItem {
  constructor(tier, content, metadata = {}) {
    this.id = `${tier}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    this.tier = tier;
    this.content = content;
    this.metadata = {
      timestamp: Date.now(),
      source: 'unknown',
      importance: 'medium',
      ...metadata
    };
    this.score = 0;
    this.tokenEstimate = this._estimateTokens();
  }
  
  _estimateTokens() {
    // Rough token estimation: ~4 characters per token
    return Math.ceil(this.content.length / 4);
  }
  
  updateScore(factors) {
    this.score = 
      (factors.taskRelevance * SCORING_WEIGHTS.taskRelevance) +
      (factors.projectRelevance * SCORING_WEIGHTS.projectRelevance) +
      (factors.dependencyImportance * SCORING_WEIGHTS.dependencyImportance) +
      (factors.recency * SCORING_WEIGHTS.recency) +
      (factors.confidence * SCORING_WEIGHTS.confidence) +
      (factors.userPriority * SCORING_WEIGHTS.userPriority) +
      (factors.verificationValue * SCORING_WEIGHTS.verificationValue);
  }
}

/**
 * Context Budget
 */
class ContextBudget {
  constructor(maxContextWindow = 128000) {
    this.maxContextWindow = maxContextWindow;
    this.reservedForNewResults = maxContextWindow * 0.20;
    this.reservedForModelOutput = maxContextWindow * 0.30;
    this.reservedForRecovery = maxContextWindow * 0.10;
    this.availableForRetrieval = maxContextWindow - 
      this.reservedForNewResults - 
      this.reservedForModelOutput - 
      this.reservedForRecovery;
  }
  
  getTierBudget(tier) {
    return this.availableForRetrieval * (BUDGET_ALLOCATION[tier] || 0.20);
  }
  
  getTotalAvailable() {
    return this.availableForRetrieval;
  }
}

/**
 * Context Fabric - Main orchestration class
 */
export class ContextFabric {
  constructor(options = {}) {
    this.maxContextWindow = options.maxContextWindow || 128000;
    this.budget = new ContextBudget(this.maxContextWindow);
    this.contextCache = new Map();
    this.indexCache = new Map();
    this.staleContextDetector = new StaleContextDetector();
    this.cacheTTL = options.cacheTTL || 3600000; // 1 hour default
  }
  
  /**
   * Retrieve context for a task
   */
  async retrieveContext(task, options = {}) {
    const {
      projectPath,
      currentFile,
      includeLive = true,
      includeActiveTask = true,
      includeProject = true,
      includeLongTerm = true,
      customTiers = []
    } = options;
    
    const context = {
      items: [],
      totalTokens: 0,
      tierBreakdown: {}
    };
    
    // LIVE Context
    if (includeLive) {
      const liveContext = await this._retrieveLiveContext(task, currentFile);
      context.items.push(...liveContext);
      context.tierBreakdown[ContextTiers.LIVE] = liveContext.length;
    }
    
    // ACTIVE_TASK Context
    if (includeActiveTask) {
      const activeTaskContext = await this._retrieveActiveTaskContext(task);
      context.items.push(...activeTaskContext);
      context.tierBreakdown[ContextTiers.ACTIVE_TASK] = activeTaskContext.length;
    }
    
    // PROJECT Context
    if (includeProject && projectPath) {
      const projectContext = await this._retrieveProjectContext(task, projectPath);
      context.items.push(...projectContext);
      context.tierBreakdown[ContextTiers.PROJECT] = projectContext.length;
    }
    
    // LONG_TERM Context
    if (includeLongTerm && projectPath) {
      const longTermContext = await this._retrieveLongTermContext(task, projectPath);
      context.items.push(...longTermContext);
      context.tierBreakdown[ContextTiers.LONG_TERM] = longTermContext.length;
    }
    
    // Custom tiers
    for (const customTier of customTiers) {
      const customContext = await this._retrieveCustomContext(task, customTier);
      context.items.push(...customContext);
      context.tierBreakdown[customTier.name] = customContext.length;
    }
    
    // Score and rank context items
    this._scoreContextItems(context.items, task);
    
    // Filter by budget
    context.items = this._filterByBudget(context.items);
    
    // Calculate total tokens
    context.totalTokens = context.items.reduce((sum, item) => sum + item.tokenEstimate, 0);
    
    // Update tier breakdown after filtering
    context.tierBreakdown = context.items.reduce((breakdown, item) => {
      breakdown[item.tier] = (breakdown[item.tier] || 0) + 1;
      return breakdown;
    }, {});
    
    return context;
  }
  
  /**
   * Retrieve LIVE context
   */
  async _retrieveLiveContext(task, currentFile) {
    const items = [];
    
    // Current prompt
    if (task.prompt) {
      items.push(new ContextItem(ContextTiers.LIVE, task.prompt, {
        source: 'prompt',
        importance: 'critical'
      }));
    }
    
    // Current file
    if (currentFile && fs.existsSync(currentFile)) {
      const content = fs.readFileSync(currentFile, 'utf8');
      items.push(new ContextItem(ContextTiers.LIVE, content, {
        source: 'current_file',
        filePath: currentFile,
        importance: 'critical'
      }));
    }
    
    // Current tool result
    if (task.toolResult) {
      items.push(new ContextItem(ContextTiers.LIVE, task.toolResult, {
        source: 'tool_result',
        importance: 'high'
      }));
    }
    
    // Current error
    if (task.error) {
      items.push(new ContextItem(ContextTiers.LIVE, task.error, {
        source: 'error',
        importance: 'critical'
      }));
    }
    
    return items;
  }
  
  /**
   * Retrieve ACTIVE_TASK context
   */
  async _retrieveActiveTaskContext(task) {
    const items = [];
    
    // Current plan
    if (task.plan) {
      items.push(new ContextItem(ContextTiers.ACTIVE_TASK, task.plan, {
        source: 'plan',
        importance: 'critical'
      }));
    }
    
    // Recent edits
    if (task.recentEdits && Array.isArray(task.recentEdits)) {
      for (const edit of task.recentEdits) {
        if (edit.filePath && fs.existsSync(edit.filePath)) {
          const content = fs.readFileSync(edit.filePath, 'utf8');
          items.push(new ContextItem(ContextTiers.ACTIVE_TASK, content, {
            source: 'recent_edit',
            filePath: edit.filePath,
            importance: 'high'
          }));
        }
      }
    }
    
    // Related tests
    if (task.relatedTests && Array.isArray(task.relatedTests)) {
      for (const testPath of task.relatedTests) {
        if (fs.existsSync(testPath)) {
          const content = fs.readFileSync(testPath, 'utf8');
          items.push(new ContextItem(ContextTiers.ACTIVE_TASK, content, {
            source: 'test',
            filePath: testPath,
            importance: 'high'
          }));
        }
      }
    }
    
    // Current failures
    if (task.failures && Array.isArray(task.failures)) {
      for (const failure of task.failures) {
        items.push(new ContextItem(ContextTiers.ACTIVE_TASK, failure, {
          source: 'failure',
          importance: 'critical'
        }));
      }
    }
    
    return items;
  }
  
  /**
   * Retrieve PROJECT context
   */
  async _retrieveProjectContext(task, projectPath) {
    const items = [];
    
    // This would integrate with CodebaseIndex to retrieve project-relevant files
    // For now, placeholder implementation
    
    // TODO: Integrate with CodebaseIndex
    // const codebaseIndex = await this.getCodebaseIndex(projectPath);
    // const relevantFiles = codebaseIndex.retrieveByTask(task);
    
    return items;
  }
  
  /**
   * Retrieve LONG_TERM context
   */
  async _retrieveLongTermContext(task, projectPath) {
    const items = [];
    
    // This would integrate with ProjectMemory to retrieve historical context
    // For now, placeholder implementation
    
    // TODO: Integrate with ProjectMemory
    // const projectMemory = await this.getProjectMemory(projectPath);
    // const historicalDecisions = projectMemory.retrieveDecisions(task);
    
    return items;
  }
  
  /**
   * Retrieve custom context
   */
  async _retrieveCustomContext(task, customTier) {
    const items = [];
    
    // Placeholder for custom tier retrieval
    // Custom tiers can be defined by users or plugins
    
    return items;
  }
  
  /**
   * Score context items
   */
  _scoreContextItems(items, task) {
    for (const item of items) {
      const factors = this._calculateScoringFactors(item, task);
      item.updateScore(factors);
    }
    
    // Sort by score descending
    items.sort((a, b) => b.score - a.score);
  }
  
  /**
   * Calculate scoring factors for an item
   */
  _calculateScoringFactors(item, task) {
    const factors = {
      taskRelevance: 0.5,
      projectRelevance: 0.5,
      dependencyImportance: 0.5,
      recency: 0.5,
      confidence: 0.5,
      userPriority: 0.5,
      verificationValue: 0.5
    };
    
    // Task relevance
    if (item.metadata.importance === 'critical') {
      factors.taskRelevance = 1.0;
    } else if (item.metadata.importance === 'high') {
      factors.taskRelevance = 0.8;
    }
    
    // Recency
    const age = Date.now() - item.metadata.timestamp;
    if (age < 3600000) { // Less than 1 hour
      factors.recency = 1.0;
    } else if (age < 86400000) { // Less than 1 day
      factors.recency = 0.7;
    } else if (age < 604800000) { // Less than 1 week
      factors.recency = 0.4;
    } else {
      factors.recency = 0.1;
    }
    
    // Project relevance (placeholder - would use code graph)
    factors.projectRelevance = this._calculateProjectRelevance(item);
    
    // Dependency importance (placeholder - would use dependency graph)
    factors.dependencyImportance = this._calculateDependencyImportance(item);
    
    return factors;
  }
  
  /**
   * Calculate project relevance (placeholder)
   */
  _calculateProjectRelevance(item) {
    // TODO: Integrate with CodeGraph
    return 0.5;
  }
  
  /**
   * Calculate dependency importance (placeholder)
   */
  _calculateDependencyImportance(item) {
    // TODO: Integrate with DependencyGraph
    return 0.5;
  }
  
  /**
   * Filter context items by budget
   */
  _filterByBudget(items) {
    const tierBudgets = {};
    const filteredItems = [];
    
    // Calculate tier budgets
    for (const tier of Object.values(ContextTiers)) {
      tierBudgets[tier] = this.budget.getTierBudget(tier);
    }
    
    // Filter items by tier budget
    for (const tier of Object.values(ContextTiers)) {
      const tierItems = items.filter(item => item.tier === tier);
      let tierTokenCount = 0;
      
      for (const item of tierItems) {
        if (tierTokenCount + item.tokenEstimate <= tierBudgets[tier]) {
          filteredItems.push(item);
          tierTokenCount += item.tokenEstimate;
        }
      }
    }
    
    return filteredItems;
  }
  
  /**
   * Compact context if needed
   */
  async compactContext(context) {
    // TODO: Implement context compaction
    // This would summarize large files, remove duplicates, etc.
    return context;
  }
  
  /**
   * Invalidate stale context
   */
  invalidateContext(projectPath) {
    this.staleContextDetector.invalidateProject(projectPath);
  }

  /** Clear volatile per-manager state during project teardown. */
  clearCache() {
    this.contextCache.clear();
    this.indexCache.clear();
    this.staleContextDetector.fileVersions.clear();
  }
  
  /**
   * Get context cache statistics
   */
  getCacheStats() {
    return {
      contextCacheSize: this.contextCache.size,
      indexCacheSize: this.indexCache.size,
      staleContextDetector: this.staleContextDetector.getStats()
    };
  }
}

/**
 * Stale Context Detector
 */
class StaleContextDetector {
  constructor() {
    this.fileVersions = new Map();
    this.ttl = 3600000; // 1 hour default
  }
  
  /**
   * Track file version
   */
  trackFile(filePath) {
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      this.fileVersions.set(filePath, {
        mtime: stats.mtimeMs,
        size: stats.size,
        hash: this._calculateFileHash(filePath)
      });
    }
  }
  
  /**
   * Check if file is stale
   */
  isFileStale(filePath) {
    const tracked = this.fileVersions.get(filePath);
    if (!tracked) return true;
    
    if (!fs.existsSync(filePath)) return true;
    
    const stats = fs.statSync(filePath);
    return stats.mtimeMs !== tracked.mtime || stats.size !== tracked.size;
  }
  
  /**
   * Invalidate project context
   */
  invalidateProject(projectPath) {
    for (const [filePath] of this.fileVersions) {
      if (filePath.startsWith(projectPath)) {
        this.fileVersions.delete(filePath);
      }
    }
  }
  
  /**
   * Calculate file hash (simple version)
   */
  _calculateFileHash(filePath) {
    // Simple hash based on file stats for now
    // In production, use proper content hash
    const stats = fs.statSync(filePath);
    return `${stats.mtimeMs}-${stats.size}`;
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return {
      trackedFiles: this.fileVersions.size,
      ttl: this.ttl
    };
  }
}

/**
 * Create default ContextFabric instance
 */
export function createContextFabric(options = {}) {
  return new ContextFabric(options);
}
