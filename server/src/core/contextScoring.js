// Context Scoring - Relevance ranking with multiple signals
// METAIOID AGENT 1: ContextFabric + MetaCode Repository Intelligence
// Ranks context by task relevance, project relevance, dependency importance, recency, etc.

/**
 * Scoring Weights
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
 * Context Scorer - Relevance ranking engine
 */
export class ContextScorer {
  constructor(codebaseIndex, codeGraph) {
    this.codebaseIndex = codebaseIndex;
    this.codeGraph = codeGraph;
  }
  
  /**
   * Score context items
   */
  scoreContextItems(items, task) {
    for (const item of items) {
      const factors = this.calculateScoringFactors(item, task);
      item.score = this.calculateFinalScore(factors);
      item.scoringFactors = factors;
    }
    
    // Sort by score descending
    items.sort((a, b) => b.score - a.score);
    
    return items;
  }
  
  /**
   * Calculate scoring factors for an item
   */
  calculateScoringFactors(item, task) {
    const factors = {
      taskRelevance: this.calculateTaskRelevance(item, task),
      projectRelevance: this.calculateProjectRelevance(item),
      dependencyImportance: this.calculateDependencyImportance(item),
      recency: this.calculateRecency(item),
      confidence: this.calculateConfidence(item),
      userPriority: this.calculateUserPriority(item),
      verificationValue: this.calculateVerificationValue(item)
    };
    
    return factors;
  }
  
  /**
   * Calculate final score from factors
   */
  calculateFinalScore(factors) {
    return (
      (factors.taskRelevance * SCORING_WEIGHTS.taskRelevance) +
      (factors.projectRelevance * SCORING_WEIGHTS.projectRelevance) +
      (factors.dependencyImportance * SCORING_WEIGHTS.dependencyImportance) +
      (factors.recency * SCORING_WEIGHTS.recency) +
      (factors.confidence * SCORING_WEIGHTS.confidence) +
      (factors.userPriority * SCORING_WEIGHTS.userPriority) +
      (factors.verificationValue * SCORING_WEIGHTS.verificationValue)
    );
  }
  
  /**
   * Calculate task relevance
   */
  calculateTaskRelevance(item, task) {
    let relevance = 0.5;
    
    // Direct mention in task
    if (task.query && item.content) {
      const query = task.query.toLowerCase();
      const content = item.content.toLowerCase();
      
      if (content.includes(query)) {
        relevance += 0.3;
      }
      
      // Multiple matches increase relevance
      const matchCount = (content.match(new RegExp(query, 'gi')) || []).length;
      relevance += Math.min(0.2, matchCount * 0.05);
    }
    
    // Importance from metadata
    if (item.metadata?.importance === 'critical') {
      relevance += 0.2;
    } else if (item.metadata?.importance === 'high') {
      relevance += 0.1;
    }
    
    // Current file gets highest relevance
    if (item.metadata?.source === 'current_file') {
      relevance += 0.3;
    }
    
    // Error gets high relevance
    if (item.metadata?.source === 'error') {
      relevance += 0.2;
    }
    
    return Math.min(1.0, relevance);
  }
  
  /**
   * Calculate project relevance
   */
  calculateProjectRelevance(item) {
    let relevance = 0.5;
    
    // Use code graph to determine centrality
    if (item.filePath && this.codeGraph) {
      const relativePath = item.filePath;
      const node = this.codeGraph.nodes.get(relativePath);
      
      if (node) {
        // Files with more dependents are more central
        relevance += Math.min(0.3, node.dependents.length * 0.05);
        
        // Important files get higher relevance
        if (node.importance === 'critical') {
          relevance += 0.2;
        } else if (node.importance === 'high') {
          relevance += 0.1;
        }
      }
    }
    
    // Config files are project-relevant
    if (item.metadata?.isConfig) {
      relevance += 0.2;
    }
    
    return Math.min(1.0, relevance);
  }
  
  /**
   * Calculate dependency importance
   */
  calculateDependencyImportance(item) {
    let importance = 0.5;
    
    if (item.filePath && this.codeGraph) {
      const relativePath = item.filePath;
      const node = this.codeGraph.nodes.get(relativePath);
      
      if (node) {
        // More dependents = higher importance
        importance += Math.min(0.3, node.dependents.length * 0.05);
        
        // Fewer dependencies = higher importance (less likely to be utility)
        importance -= Math.min(0.1, node.dependencies.length * 0.02);
      }
    }
    
    return Math.max(0.1, Math.min(1.0, importance));
  }
  
  /**
   * Calculate recency
   */
  calculateRecency(item) {
    const timestamp = item.metadata?.timestamp || item.timestamp || Date.now();
    const age = Date.now() - timestamp;
    
    // Recent items get higher recency score
    if (age < 3600000) { // Less than 1 hour
      return 1.0;
    } else if (age < 86400000) { // Less than 1 day
      return 0.8;
    } else if (age < 604800000) { // Less than 1 week
      return 0.5;
    } else if (age < 2592000000) { // Less than 1 month
      return 0.3;
    } else {
      return 0.1;
    }
  }
  
  /**
   * Calculate confidence
   */
  calculateConfidence(item) {
    let confidence = 0.5;
    
    // Index confidence
    if (item.metadata?.source === 'index') {
      confidence += 0.2;
    }
    
    // Symbol confidence
    if (item.type === 'symbol' && item.isExported) {
      confidence += 0.2;
    }
    
    // Test coverage
    if (item.metadata?.testCoverage) {
      confidence += Math.min(0.2, item.metadata.testCoverage * 0.01);
    }
    
    return Math.min(1.0, confidence);
  }
  
  /**
   * Calculate user priority
   */
  calculateUserPriority(item) {
    let priority = 0.5;
    
    // User explicitly marked important
    if (item.metadata?.userPriority === 'high') {
      priority += 0.4;
    } else if (item.metadata?.userPriority === 'medium') {
      priority += 0.2;
    } else if (item.metadata?.userPriority === 'low') {
      priority -= 0.2;
    }
    
    // User explicitly included
    if (item.metadata?.userIncluded) {
      priority += 0.3;
    }
    
    // User explicitly excluded
    if (item.metadata?.userExcluded) {
      priority -= 0.4;
    }
    
    return Math.max(0.0, Math.min(1.0, priority));
  }
  
  /**
   * Calculate verification value
   */
  calculateVerificationValue(item) {
    let value = 0.5;
    
    // Test coverage
    if (item.type === 'test') {
      value += 0.3;
    }
    
    // Verification history
    if (item.metadata?.verificationHistory) {
      const history = item.metadata.verificationHistory;
      const successRate = history.filter(h => h.success).length / history.length;
      value += successRate * 0.3;
    }
    
    // Bug fix history
    if (item.metadata?.bugFixHistory) {
      value += 0.2;
    }
    
    return Math.min(1.0, value);
  }
  
  /**
   * Re-score items after context changes
   */
  rescoreItems(items, task, changedFiles = []) {
    for (const item of items) {
      // Boost score for changed files
      if (item.filePath && changedFiles.includes(item.filePath)) {
        item.score *= 1.5;
      }
      
      // Re-score with updated task
      const factors = this.calculateScoringFactors(item, task);
      item.score = this.calculateFinalScore(factors);
      item.scoringFactors = factors;
    }
    
    // Re-sort
    items.sort((a, b) => b.score - a.score);
    
    return items;
  }
}

/**
 * Create context scorer
 */
export function createContextScorer(codebaseIndex, codeGraph) {
  return new ContextScorer(codebaseIndex, codeGraph);
}
