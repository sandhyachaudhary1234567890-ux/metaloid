// ContextFabric Integration - Connect ContextFabric with existing MetaIoid systems
// METAIOID AGENT 1: ContextFabric Hardening & Real Integration
// Integrates with: AgentRuntime, CheckpointManager, ToolRegistry, SkillRegistry, ProviderRegistry

import { ContextFabric } from './contextFabric.js';
import { CodebaseIndex } from './codebaseIndex.js';
import { CodeGraph } from './codeGraph.js';
import { RetrievalEngine, RetrievalStrategies } from './retrievalEngine.js';
import { ContextScorer } from './contextScoring.js';
import { ContextBudget } from './contextBudget.js';
import { ContextCompactor } from './contextCompaction.js';
import { ProjectMemoryManager } from './projectMemory.js';
import { RepositoryOnboarding } from './repositoryOnboarding.js';
import fs from 'node:fs';
import path from 'node:path';

/**
 * ContextFabricManager - Main integration manager
 * Provides a clean interface for AgentRuntime and other systems to use ContextFabric
 */
export class ContextFabricManager {
  constructor(options = {}) {
    this.projectPath = options.projectPath || process.cwd();
    this.userId = options.userId || null;
    this.projectId = options.projectId || null;
    
    // Initialize ContextFabric components
    this.codebaseIndex = new CodebaseIndex(this.projectPath);
    this.codeGraph = new CodeGraph(this.projectPath);
    this.retrievalEngine = new RetrievalEngine(this.codebaseIndex, this.codeGraph);
    this.contextScorer = new ContextScorer(this.codebaseIndex, this.codeGraph);
    this.contextBudget = new ContextBudget(options.maxContextWindow || 128000);
    this.contextCompactor = new ContextCompactor();
    this.projectMemory = new ProjectMemoryManager(this.projectPath);
    this.repositoryOnboarding = new RepositoryOnboarding(this.projectPath);
    this.contextFabric = new ContextFabric({
      maxContextWindow: options.maxContextWindow || 128000,
      cacheTTL: options.cacheTTL || 3600000
    });
    
    // Provider integration for semantic search
    this.embeddingProvider = null;
    
    // Initialize if project exists
    this.initialized = false;
  }
  
  /**
   * Initialize ContextFabric for a project
   */
  async initialize() {
    console.log('Initializing ContextFabric for project:', this.projectPath);
    
    try {
      // 1. Load or build codebase index
      const indexLoaded = this.codebaseIndex.loadIndex();
      if (!indexLoaded) {
        await this.codebaseIndex.buildIndex();
      }
      
      // 2. Load or build code graph
      const graphLoaded = this.codeGraph.loadGraph();
      if (!graphLoaded) {
        await this.codeGraph.buildGraph(this.codebaseIndex);
      }
      
      // 3. Load project memory
      this.projectMemory.loadMemory();
      
      // 4. Run repository onboarding if needed
      const summary = this.repositoryOnboarding.getEngineeringSummary();
      if (!summary) {
        await this.repositoryOnboarding.onboard();
      }
      
      // 5. Initialize embedding provider if available
      await this._initializeEmbeddingProvider();
      
      this.initialized = true;
      console.log('ContextFabric initialized successfully');
      
      return {
        indexStats: this.codebaseIndex.getStats(),
        graphStats: this.codeGraph.getStats(),
        memoryStats: this.projectMemory.getStats(),
        engineeringSummary: this.repositoryOnboarding.getEngineeringSummary()
      };
    } catch (error) {
      console.error('Failed to initialize ContextFabric:', error);
      throw error;
    }
  }
  
  /**
   * Build context for a task (main interface for AgentRuntime)
   */
  async buildContext(task, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    const {
      currentFile,
      maxContextWindow,
      includeProjectContext = true,
      includeHistoricalContext = true,
      relevantSkills = [],
      relevantTools = []
    } = options;
    const budget = maxContextWindow
      ? new ContextBudget(maxContextWindow)
      : this.contextBudget;
    
    // 1. Retrieve context using ContextFabric
    const resolvedCurrentFile = currentFile || task.currentFile;
    const context = await this.contextFabric.retrieveContext(task, {
      projectPath: this.projectPath,
      currentFile: resolvedCurrentFile,
      includeProjectContext,
      includeHistoricalContext
    });

    // ContextFabric owns the short-lived conversation layers. The retrieval
    // engine owns repository intelligence, so merge the two here instead of
    // leaving project context as a placeholder.
    const retrievedItems = await this.retrievalEngine.retrieveContext({
      ...task,
      currentFile: resolvedCurrentFile
    }, {
      strategies: [
        RetrievalStrategies.KEYWORD,
        RetrievalStrategies.SYMBOL,
        RetrievalStrategies.DEPENDENCY,
        RetrievalStrategies.TEST_RELATIONSHIP
      ],
      maxResults: 20,
      projectPath: this.projectPath
    });
    context.items.push(...retrievedItems.map(item => this._normalizeContextItem(item)));

    // Normalize live ContextItem instances to the same public shape used by
    // retrieval, checkpoints, scoring, and the UI.
    context.items = context.items.map(item => this._normalizeContextItem(item));
    
    // 2. Enhance with skill-based context
    if (relevantSkills.length > 0) {
      const skillContext = await this._retrieveSkillContext(relevantSkills);
      context.items.push(...skillContext);
    }
    
    // 3. Enhance with tool-based context
    if (relevantTools.length > 0) {
      const toolContext = await this._retrieveToolContext(relevantTools);
      context.items.push(...toolContext);
    }
    
    // 4. Score and rank all context items
    this.contextScorer.scoreContextItems(context.items, task);
    
    // 5. Filter by budget
    const itemLimit = Math.max(500, Math.floor(budget.getTotalAvailable() * 4));
    const compactor = maxContextWindow
      ? new ContextCompactor({ maxSize: itemLimit })
      : this.contextCompactor;
    context.items = compactor.removeDuplicates(context.items);
    context.items = compactor.compactContext({ ...context, items: context.items }).items;
    context.items = budget.filterByBudget(context.items);
    
    // 6. Compact if needed
    if (!budget.fitsInBudget(context.items)) {
      const compacted = compactor.compactContext(context);
      context.items = compacted.items;
    }
    context.totalTokens = context.items.reduce((total, item) => total + budget.estimateTokens(item), 0);
    
    // 7. Calculate context completeness
    context.completeness = this._calculateContextCompleteness(context, task);
    
    return context;
  }
  
  /**
   * Check if context is sufficient for a task
   */
  isContextSufficient(context, task) {
    const threshold = 0.7; // 70% completeness threshold
    return context.completeness >= threshold;
  }
  
  /**
   * Retrieve additional context if current context is insufficient
   */
  async retrieveAdditionalContext(context, task, missingCategories) {
    const additionalItems = [];
    
    for (const category of missingCategories) {
      switch (category) {
        case 'auth_files':
          additionalItems.push(...await this._retrieveAuthFiles(task));
          break;
        case 'tests':
          additionalItems.push(...await this._retrieveTests(task));
          break;
        case 'dependencies':
          additionalItems.push(...await this._retrieveDependencies(task));
          break;
        case 'decisions':
          additionalItems.push(...await this._retrieveDecisions(task));
          break;
      }
    }
    
    // Score and filter new items
    this.contextScorer.scoreContextItems(additionalItems, task);
    additionalItems.sort((a, b) => b.score - a.score);
    
    return additionalItems.slice(0, 10); // Top 10 additional items
  }
  
  /**
   * Invalidate context when files change
   */
  invalidateContext(changedFiles) {
    this.contextFabric.invalidateContext(this.projectPath);
    
    // Invalidate affected file versions in stale detector
    for (const filePath of changedFiles) {
      this.contextFabric.staleContextDetector.trackFile(filePath);
    }
    
    // Rebuild index/graph if significant changes
    if (changedFiles.length > 5) {
      this._scheduleRebuild();
    }
  }
  
  /**
   * Save context snapshot for checkpoint
   */
  saveContextSnapshot(taskId, context) {
    const snapshot = {
      taskId,
      timestamp: Date.now(),
      contextReferences: context.items.map(item => ({
        type: item.type,
        filePath: item.filePath,
        symbolName: item.symbolName,
        tier: item.tier,
        score: item.score,
        metadata: item.metadata,
        // A prompt, decision, or other non-file item cannot be reconstructed
        // from the repository. Preserve its small source text for a faithful
        // checkpoint without duplicating indexed file contents.
        content: item.type === 'file' || item.type === 'symbol' ? undefined : item.content
      })),
      projectIndexVersion: this.codebaseIndex.indexTimestamp,
      projectGraphVersion: this.codeGraph.graphTimestamp,
      totalTokens: context.totalTokens,
      completeness: context.completeness
    };
    
    return snapshot;
  }
  
  /**
   * Restore context from checkpoint
   */
  async restoreContextSnapshot(snapshot) {
    // Verify index/graph versions
    if (snapshot.projectIndexVersion !== this.codebaseIndex.indexTimestamp ||
        snapshot.projectGraphVersion !== this.codeGraph.graphTimestamp) {
      console.log('Index/graph changed since checkpoint, rebuilding...');
      await this._scheduleRebuild();
    }
    
    // Reconstruct context from references
    const context = {
      items: [],
      totalTokens: 0,
      completeness: snapshot.completeness
    };
    
    for (const ref of snapshot.contextReferences) {
      let item;
      
      if (ref.type === 'file' && ref.filePath) {
        const filePath = ref.filePath;
        const fileEntry = this.codebaseIndex.fileIndex.get(filePath) ||
          Array.from(this.codebaseIndex.fileIndex.values()).find(candidate => candidate.absolutePath === filePath);
        if (fileEntry) {
          const content = this._getFileContent(fileEntry.absolutePath);
          item = {
            type: 'file',
            filePath,
            content,
            tier: ref.tier,
            score: ref.score
          };
        }
      } else if (ref.type === 'symbol' && ref.filePath && ref.symbolName) {
        const symbol = Array.from(this.codebaseIndex.symbolIndex.values()).find(candidate =>
          candidate.filePath === ref.filePath && candidate.name === ref.symbolName
        );
        if (symbol) {
          const content = this._getFileContent(symbol.absolutePath);
          item = {
            type: 'symbol',
            filePath: ref.filePath,
            symbolName: ref.symbolName,
            content,
            tier: ref.tier,
            score: ref.score
          };
        }
      } else if (typeof ref.content === 'string') {
        item = {
          type: ref.type || 'context',
          filePath: ref.filePath,
          symbolName: ref.symbolName,
          content: ref.content,
          tier: ref.tier,
          score: ref.score,
          metadata: ref.metadata
        };
      }
      
      if (item) {
        context.items.push(item);
        context.totalTokens += this.contextBudget.estimateTokens(item);
      }
    }
    
    return context;
  }
  
  /**
   * Retrieve skill-based context
   */
  async _retrieveSkillContext(skillIds) {
    const items = [];
    
    // Integrate with existing SkillRegistry
    const { discoverSkills, skillBrief } = await import('./skills.js');
    
    for (const skillId of skillIds) {
      const brief = skillBrief(skillId);
      if (brief) {
        items.push({
          type: 'skill',
          skillId,
          content: JSON.stringify(brief),
          tier: 'PROJECT',
          metadata: {
            source: 'skill_registry',
            importance: 'medium'
          }
        });
      }
    }
    
    return items;
  }
  
  /**
   * Retrieve tool-based context
   */
  async _retrieveToolContext(toolNames) {
    const items = [];
    
    // Integrate with existing ToolRegistry
    const { listTools } = await import('./tools.js');
    const allTools = listTools();
    
    for (const toolName of toolNames) {
      const tool = allTools.find(t => t.name === toolName);
      if (tool) {
        items.push({
          type: 'tool',
          toolName,
          content: JSON.stringify(tool),
          tier: 'PROJECT',
          metadata: {
            source: 'tool_registry',
            importance: 'medium'
          }
        });
      }
    }
    
    return items;
  }
  
  /**
   * Initialize embedding provider for semantic search
   */
  async _initializeEmbeddingProvider() {
    // The gateway routing engine requires a user-scoped credential vault. This
    // project-level manager does not own one, so it must not fabricate a
    // provider decision. Retrieval remains on its deterministic keyword/symbol
    // path until an explicit gateway-scoped embedding adapter is supplied.
    this.embeddingProvider = null;
  }
  
  /**
   * Calculate context completeness
   */
  _calculateContextCompleteness(context, task) {
    let completeness = 0.5; // Base completeness
    
    // Check for critical files
    if (task.currentFile) {
      const hasCurrentFile = context.items.some(item => 
        item.filePath === task.currentFile || item.metadata?.source === 'current_file'
      );
      if (hasCurrentFile) completeness += 0.25;
    }
    
    // Check for tests
    const hasTests = context.items.some(item => item.type === 'test');
    if (hasTests) completeness += 0.1;
    
    // Check for dependencies
    const hasDependencies = context.items.some(item => item.type === 'dependency');
    if (hasDependencies) completeness += 0.1;
    
    // Check for decisions/memory
    const hasMemory = context.items.some(item => 
      item.metadata?.source === 'memory' || item.tier === 'LONG_TERM'
    );
    if (hasMemory) completeness += 0.1;
    
    return Math.min(1.0, completeness);
  }
  
  /**
   * Retrieve auth-related files
   */
  async _retrieveAuthFiles(task) {
    const authKeywords = ['auth', 'session', 'login', 'user', 'permission'];
    const results = [];
    
    for (const keyword of authKeywords) {
      const files = this.codebaseIndex.searchFiles(keyword);
      for (const file of files) {
        const content = this._getFileContent(file.absolutePath);
        results.push({
          type: 'file',
          filePath: file.filePath,
          content,
          tier: 'PROJECT',
          metadata: {
            source: 'retrieval',
            importance: 'high'
          }
        });
      }
    }
    
    return results;
  }
  
  /**
   * Retrieve tests
   */
  async _retrieveTests(task) {
    const testFiles = this.codebaseIndex.getTestFiles();
    const results = [];
    
    for (const file of testFiles) {
      const content = this._getFileContent(file.absolutePath);
      results.push({
        type: 'test',
        filePath: file.filePath,
        content,
        tier: 'PROJECT',
        metadata: {
          source: 'retrieval',
          importance: 'high'
        }
      });
    }
    
    return results;
  }
  
  /**
   * Retrieve dependencies
   */
  async _retrieveDependencies(task) {
    const currentFile = task.currentFile;
    if (!currentFile) return [];
    
    const relativePath = currentFile.replace(this.projectPath, '').replace(/^\//, '');
    const dependencies = this.codeGraph.getDependencies(relativePath);
    const results = [];
    
    for (const dep of dependencies) {
      const content = this._getFileContent(
        path.join(this.projectPath, dep.filePath)
      );
      results.push({
        type: 'dependency',
        filePath: dep.filePath,
        content,
        tier: 'PROJECT',
        metadata: {
          source: 'retrieval',
          importance: 'medium'
        }
      });
    }

    // Package manifests are first-class dependency context even when the
    // current source file has no local imports. This is particularly useful
    // for requests such as "update authentication dependencies".
    for (const manifestName of ['package.json', 'requirements.txt', 'pyproject.toml', 'Cargo.toml', 'go.mod']) {
      const manifest = this.codebaseIndex.fileIndex.get(manifestName);
      if (!manifest) continue;
      results.push({
        type: 'dependency',
        filePath: manifest.filePath,
        content: this._getFileContent(manifest.absolutePath),
        tier: 'PROJECT',
        metadata: {
          source: 'dependency_manifest',
          importance: 'high',
          isConfig: true
        }
      });
    }
    
    return results;
  }
  
  /**
   * Retrieve decisions from project memory
   */
  async _retrieveDecisions(task) {
    const decisions = this.projectMemory.getDecisions(20);
    const results = [];
    
    for (const decision of decisions) {
      results.push({
        type: 'decision',
        content: `${decision.decision}\nRationale: ${decision.rationale}`,
        tier: 'LONG_TERM',
        metadata: {
          source: 'project_memory',
          importance: 'medium'
        }
      });
    }
    
    return results;
  }
  
  /**
   * Get file content
   */
  _getFileContent(filePath) {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      return '';
    }
  }

  _normalizeContextItem(item) {
    const metadata = item.metadata || {};
    const source = metadata.source;
    const type = item.type || (source === 'current_file' || source === 'recent_edit'
      ? 'file'
      : source === 'test'
        ? 'test'
        : 'context');

    return {
      ...item,
      type,
      filePath: item.filePath || metadata.filePath,
      tier: item.tier || 'PROJECT',
      metadata: {
        timestamp: item.timestamp || metadata.timestamp || Date.now(),
        ...metadata,
        source: source || 'retrieval'
      }
    };
  }
  
  /**
   * Schedule index/graph rebuild
   */
  _scheduleRebuild() {
    // Debounced rebuild to avoid excessive rebuilding
    if (this.rebuildTimeout) {
      clearTimeout(this.rebuildTimeout);
    }
    
    this.rebuildTimeout = setTimeout(async () => {
      console.log('Rebuilding index and graph...');
      await this.codebaseIndex.buildIndex();
      await this.codeGraph.buildGraph(this.codebaseIndex);
      this.rebuildTimeout = null;
    }, 5000); // 5 second debounce
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return {
      initialized: this.initialized,
      projectPath: this.projectPath,
      userId: this.userId,
      projectId: this.projectId,
      indexStats: this.codebaseIndex.getStats(),
      graphStats: this.codeGraph.getStats(),
      memoryStats: this.projectMemory.getStats(),
      cacheStats: this.contextFabric.getCacheStats(),
      embeddingProvider: this.embeddingProvider?.providerId || null
    };
  }
  
  /**
   * Clean up resources
   */
  async cleanup() {
    if (this.rebuildTimeout) {
      clearTimeout(this.rebuildTimeout);
    }
    
    this.contextFabric.clearCache();
    this.initialized = false;
  }
}

/**
 * Create ContextFabric manager for a project
 */
export function createContextFabricManager(options = {}) {
  return new ContextFabricManager(options);
}
