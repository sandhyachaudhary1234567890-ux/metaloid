// Retrieval Engine - Multi-strategy context retrieval system
// METAIOID AGENT 1: ContextFabric + MetaCode Repository Intelligence
// Supports keyword, semantic, symbol, dependency, Git history, and test relationship retrieval

import fs from 'node:fs';
import path from 'node:path';
import { SemanticSearchEngine } from './semanticSearch.js';
import { GitHistorySearchEngine } from './gitHistorySearch.js';

/**
 * Retrieval Strategies
 */
export const RetrievalStrategies = {
  KEYWORD: 'KEYWORD',
  SEMANTIC: 'SEMANTIC',
  SYMBOL: 'SYMBOL',
  DEPENDENCY: 'DEPENDENCY',
  GIT_HISTORY: 'GIT_HISTORY',
  TEST_RELATIONSHIP: 'TEST_RELATIONSHIP'
};

/**
 * Retrieval Engine - Main retrieval orchestration
 */
export class RetrievalEngine {
  constructor(codebaseIndex, codeGraph, options = {}) {
    this.codebaseIndex = codebaseIndex;
    this.codeGraph = codeGraph;
    this.cache = new Map();
    this.cacheTTL = 3600000; // 1 hour
    
    // Initialize semantic search
    this.semanticSearch = new SemanticSearchEngine({
      providerRegistry: options.providerRegistry,
      userId: options.userId
    });
    
    // Initialize Git history search
    this.gitHistorySearch = new GitHistorySearchEngine(options.projectPath || process.cwd());
    
    // Initialize providers
    this.semanticSearchInitialized = false;
    this.gitHistoryInitialized = false;
  }
  
  /**
   * Initialize retrieval engines
   */
  async initialize() {
    // Initialize semantic search
    this.semanticSearchInitialized = await this.semanticSearch.initialize();
    
    // Initialize Git history search
    await this.gitHistorySearch.initialize();
    this.gitHistoryInitialized = this.gitHistorySearch.isAvailable();
    
    console.log('Retrieval engines initialized:', {
      semantic: this.semanticSearchInitialized,
      gitHistory: this.gitHistoryInitialized
    });
  }
  
  /**
   * Retrieve context for a task using multiple strategies
   */
  async retrieveContext(task, options = {}) {
    const {
      strategies = [RetrievalStrategies.KEYWORD, RetrievalStrategies.SYMBOL, RetrievalStrategies.DEPENDENCY],
      maxResults = 20,
      projectPath
    } = options;
    
    const retrievalResults = new Map();
    
    // Execute each retrieval strategy
    for (const strategy of strategies) {
      const results = await this._executeStrategy(strategy, task, options);
      retrievalResults.set(strategy, results);
    }
    
    // Combine and rank results
    const combinedResults = this._combineResults(retrievalResults, strategies);
    
    // Return top results
    return combinedResults.slice(0, maxResults);
  }
  
  /**
   * Execute a specific retrieval strategy
   */
  async _executeStrategy(strategy, task, options) {
    switch (strategy) {
      case RetrievalStrategies.KEYWORD:
        return this._keywordSearch(task.query || task.prompt, options);
      case RetrievalStrategies.SEMANTIC:
        return this._semanticSearch(task.query || task.prompt, options);
      case RetrievalStrategies.SYMBOL:
        return this._symbolSearch(task.query || task.prompt, options);
      case RetrievalStrategies.DEPENDENCY:
        return this._dependencySearch(task.currentFile, options);
      case RetrievalStrategies.GIT_HISTORY:
        return this._gitHistorySearch(task.query || task.prompt, options);
      case RetrievalStrategies.TEST_RELATIONSHIP:
        return this._testRelationshipSearch(task.currentFile, options);
      default:
        return [];
    }
  }
  
  /**
   * Keyword search - exact and fuzzy string matching
   */
  _keywordSearch(query, options) {
    const results = [];
    const keywords = this._extractKeywords(query);
    
    for (const keyword of keywords) {
      const fileResults = this.codebaseIndex.searchFiles(keyword);
      const symbolResults = this.codebaseIndex.searchSymbols(keyword);
      
      for (const file of fileResults) {
        results.push({
          type: 'file',
          filePath: file.filePath,
          content: this._getFileContent(file.absolutePath),
          score: this._calculateKeywordScore(keyword, file),
          strategy: RetrievalStrategies.KEYWORD
        });
      }
      
      for (const symbol of symbolResults) {
        results.push({
          type: 'symbol',
          filePath: symbol.filePath,
          symbolName: symbol.name,
          symbolType: symbol.type,
          line: symbol.line,
          content: this._getFileContent(symbol.absolutePath),
          score: this._calculateKeywordScore(keyword, symbol),
          strategy: RetrievalStrategies.KEYWORD
        });
      }
    }
    
    return results;
  }
  
  /**
   * Semantic search - embedding-based similarity
   */
  async _semanticSearch(query, options) {
    if (!this.semanticSearchInitialized) {
      console.log('Semantic search not initialized, using keyword fallback');
      return this._keywordSearch(query, options);
    }
    
    try {
      const results = await this.semanticSearch.search(query, this.codebaseIndex, {
        maxResults: options.maxResults || 20,
        useCache: true
      });
      
      return results;
    } catch (error) {
      console.error('Semantic search failed, using keyword fallback:', error.message);
      return this._keywordSearch(query, options);
    }
  }
  
  /**
   * Symbol search - symbol index lookup
   */
  _symbolSearch(query, options) {
    const results = [];
    const keywords = this._extractKeywords(query);
    
    for (const keyword of keywords) {
      const symbolResults = this.codebaseIndex.searchSymbols(keyword);
      
      for (const symbol of symbolResults) {
        results.push({
          type: 'symbol',
          filePath: symbol.filePath,
          symbolName: symbol.name,
          symbolType: symbol.type,
          line: symbol.line,
          signature: symbol.signature,
          isExported: symbol.isExported,
          content: this._getFileContent(symbol.absolutePath),
          score: this._calculateSymbolScore(symbol, keyword),
          strategy: RetrievalStrategies.SYMBOL
        });
      }
    }
    
    return results;
  }
  
  /**
   * Dependency search - dependency graph traversal
   */
  _dependencySearch(currentFile, options) {
    const results = [];
    
    if (!currentFile) return results;
    
    const relativePath = path.relative(this.codebaseIndex.projectPath, currentFile);
    
    // Get direct dependencies
    const dependencies = this.codeGraph.getDependencies(relativePath);
    
    for (const dep of dependencies) {
      results.push({
        type: 'dependency',
        filePath: dep.filePath,
        content: this._getFileContent(path.join(this.codebaseIndex.projectPath, dep.filePath)),
        score: this._calculateDependencyScore(dep),
        strategy: RetrievalStrategies.DEPENDENCY
      });
    }
    
    // Get dependents (files that depend on this file)
    const dependents = this.codeGraph.getDependents(relativePath);
    
    for (const dep of dependents) {
      results.push({
        type: 'dependent',
        filePath: dep.filePath,
        content: this._getFileContent(path.join(this.codebaseIndex.projectPath, dep.filePath)),
        score: this._calculateDependencyScore(dep),
        strategy: RetrievalStrategies.DEPENDENCY
      });
    }
    
    return results;
  }
  
  /**
   * Git history search - commit analysis
   */
  async _gitHistorySearch(query, options) {
    if (!this.gitHistoryInitialized) {
      console.log('Git history not available');
      return [];
    }
    
    try {
      const commits = await this.gitHistorySearch.searchCommits(query, {
        maxResults: options.maxResults || 20,
        since: '3 months ago'
      });
      
      const results = [];
      for (const commit of commits) {
        results.push({
          type: 'git_commit',
          commitHash: commit.hash,
          author: commit.author,
          date: commit.date,
          message: commit.message,
          score: this._calculateGitScore(commit, query),
          strategy: RetrievalStrategies.GIT_HISTORY
        });
      }
      
      return results;
    } catch (error) {
      console.error('Git history search failed:', error.message);
      return [];
    }
  }
  
  /**
   * Test relationship search - test-to-code mapping
   */
  _testRelationshipSearch(currentFile, options) {
    const results = [];
    
    if (!currentFile) return results;
    
    const relativePath = path.relative(this.codebaseIndex.projectPath, currentFile);
    const tests = this.codeGraph.getTestsForFile(relativePath);
    
    for (const testPath of tests) {
      const testEntry = this.codebaseIndex.testIndex.get(testPath);
      if (testEntry) {
        results.push({
          type: 'test',
          filePath: testPath,
          testFramework: testEntry.testFramework,
          testNames: testEntry.testNames,
          content: this._getFileContent(path.join(this.codebaseIndex.projectPath, testPath)),
          score: this._calculateTestScore(testEntry),
          strategy: RetrievalStrategies.TEST_RELATIONSHIP
        });
      }
    }
    
    return results;
  }
  
  /**
   * Combine results from multiple strategies
   */
  _combineResults(retrievalResults, strategies) {
    const combined = [];
    const seen = new Set();
    
    // Weight different strategies
    const strategyWeights = {
      [RetrievalStrategies.KEYWORD]: 0.30,
      [RetrievalStrategies.SEMANTIC]: 0.40,
      [RetrievalStrategies.SYMBOL]: 0.30,
      [RetrievalStrategies.DEPENDENCY]: 0.50,
      [RetrievalStrategies.GIT_HISTORY]: 0.20,
      [RetrievalStrategies.TEST_RELATIONSHIP]: 0.40
    };
    
    for (const strategy of strategies) {
      const results = retrievalResults.get(strategy) || [];
      const weight = strategyWeights[strategy] || 0.5;
      
      for (const result of results) {
        const key = `${result.type}:${result.filePath}:${result.symbolName || ''}`;
        
        if (!seen.has(key)) {
          seen.add(key);
          result.combinedScore = result.score * weight;
          result.strategies = [strategy];
          combined.push(result);
        } else {
          // Boost score if found by multiple strategies
          const existing = combined.find(r => 
            r.type === result.type && 
            r.filePath === result.filePath && 
            (r.symbolName || '') === (result.symbolName || '')
          );
          if (existing) {
            existing.combinedScore += result.score * weight;
            existing.strategies.push(strategy);
          }
        }
      }
    }
    
    // Sort by combined score
    combined.sort((a, b) => b.combinedScore - a.combinedScore);
    
    return combined;
  }
  
  /**
   * Extract keywords from query
   */
  _extractKeywords(query) {
    if (!query) return [];
    
    // Simple keyword extraction - split by common delimiters
    const keywords = query
      .toLowerCase()
      .split(/[\s,.;:!?(){}\[\]<>"'`\/\\|]+/)
      .filter(word => word.length > 2) // Filter short words
      .filter(word => !['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been', 'will', 'with', 'this', 'that', 'from', 'they', 'would', 'there', 'their', 'what', 'about', 'which', 'when', 'make', 'like', 'into', 'just', 'over', 'such', 'your', 'does', 'more', 'also', 'than', 'some', 'only', 'could', 'after', 'very', 'other', 'should', 'into'].includes(word));
    
    return [...new Set(keywords)]; // Remove duplicates
  }
  
  /**
   * Calculate keyword score
   */
  _calculateKeywordScore(keyword, item) {
    let score = 0.5;
    
    // Exact match gets higher score
    if (item.fileName && item.fileName.toLowerCase() === keyword.toLowerCase()) {
      score += 0.3;
    }
    
    // Important files get higher score
    if (item.importance === 'critical') {
      score += 0.2;
    } else if (item.importance === 'high') {
      score += 0.1;
    }
    
    return Math.min(1.0, score);
  }
  
  /**
   * Calculate symbol score
   */
  _calculateSymbolScore(symbol, keyword) {
    let score = 0.5;
    
    // Exact symbol name match
    if (symbol.name.toLowerCase() === keyword.toLowerCase()) {
      score += 0.3;
    }
    
    // Exported symbols get higher score
    if (symbol.isExported) {
      score += 0.2;
    }
    
    // Function/class types get higher score
    if (symbol.type === 'function' || symbol.type === 'class') {
      score += 0.1;
    }
    
    return Math.min(1.0, score);
  }
  
  /**
   * Calculate dependency score
   */
  _calculateDependencyScore(node) {
    let score = 0.5;
    
    // More dependents = higher importance
    score += Math.min(0.3, node.dependents.length * 0.05);
    
    // More dependencies = lower importance (could be utility)
    score -= Math.min(0.2, node.dependencies.length * 0.02);
    
    // Important files get higher score
    if (node.importance === 'critical') {
      score += 0.2;
    } else if (node.importance === 'high') {
      score += 0.1;
    }
    
    return Math.max(0.1, Math.min(1.0, score));
  }
  
  /**
   * Calculate test score
   */
  _calculateTestScore(testEntry) {
    let score = 0.5;
    
    // More test names = higher score
    score += Math.min(0.2, testEntry.testNames.length * 0.05);
    
    // Recently run tests get higher score
    if (testEntry.lastRun) {
      const age = Date.now() - testEntry.lastRun;
      if (age < 86400000) { // Less than 1 day
        score += 0.2;
      } else if (age < 604800000) { // Less than 1 week
        score += 0.1;
      }
    }
    
    // Failed tests get higher score
    if (testEntry.lastStatus === 'fail') {
      score += 0.3;
    }
    
    return Math.min(1.0, score);
  }
  
  /**
   * Calculate Git commit score
   */
  _calculateGitScore(commit, query) {
    let score = 0.5;
    
    // Recent commits get higher score
    const commitDate = new Date(commit.date).getTime();
    const age = Date.now() - commitDate;
    if (age < 86400000) { // Less than 1 day
      score += 0.3;
    } else if (age < 604800000) { // Less than 1 week
      score += 0.2;
    } else if (age < 2592000000) { // Less than 1 month
      score += 0.1;
    }
    
    // Query match in commit message
    if (query && commit.message.toLowerCase().includes(query.toLowerCase())) {
      score += 0.2;
    }
    
    return Math.min(1.0, score);
  }
  
  /**
   * Get file content
   */
  _getFileContent(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf8');
      }
    } catch (error) {
      console.error(`Failed to read file ${filePath}:`, error.message);
    }
    return '';
  }
  
  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }
  
  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      cacheSize: this.cache.size,
      cacheTTL: this.cacheTTL
    };
  }
}

/**
 * Create retrieval engine
 */
export function createRetrievalEngine(codebaseIndex, codeGraph) {
  return new RetrievalEngine(codebaseIndex, codeGraph);
}
