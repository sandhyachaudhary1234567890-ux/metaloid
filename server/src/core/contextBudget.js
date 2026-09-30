// Context Budget - Calculate and manage context window allocation
// METAIOID AGENT 1: ContextFabric + MetaCode Repository Intelligence
// Ensures context fits within model's context window with reservations for new results

/**
 * Context Budget Manager
 */
export class ContextBudget {
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
  
  /**
   * Get tier budget allocation
   */
  getTierBudget(tier) {
    const tierAllocation = {
      LIVE: 0.10,
      ACTIVE_TASK: 0.20,
      PROJECT: 0.40,
      LONG_TERM: 0.20,
      ARCHIVE: 0.10
    };
    
    return this.availableForRetrieval * (tierAllocation[tier] || 0.20);
  }
  
  /**
   * Get total available budget
   */
  getTotalAvailable() {
    return this.availableForRetrieval;
  }
  
  /**
   * Calculate remaining budget after items
   */
  calculateRemainingBudget(items) {
    const usedTokens = items.reduce((sum, item) => sum + this.estimateTokens(item), 0);
    return Math.max(0, this.availableForRetrieval - usedTokens);
  }
  
  /**
   * Estimate tokens for an item
   */
  estimateTokens(item) {
    if (item.tokenEstimate) {
      return item.tokenEstimate;
    }
    
    // Rough estimation: ~4 characters per token
    const content = item.content || '';
    return Math.ceil(content.length / 4);
  }
  
  /**
   * Check if context fits within budget
   */
  fitsInBudget(items) {
    const usedTokens = items.reduce((sum, item) => sum + this.estimateTokens(item), 0);
    return usedTokens <= this.availableForRetrieval;
  }
  
  /**
   * Filter items to fit within budget
   */
  filterByBudget(items, tier = null) {
    if (tier) {
      const tierBudget = this.getTierBudget(tier);
      const tierItems = items.filter(item => item.tier === tier);
      let usedTokens = 0;
      const filtered = [];
      
      for (const item of tierItems) {
        const itemTokens = this.estimateTokens(item);
        if (usedTokens + itemTokens <= tierBudget) {
          filtered.push(item);
          usedTokens += itemTokens;
        }
      }
      
      return filtered;
    } else {
      let usedTokens = 0;
      const filtered = [];
      
      for (const item of items) {
        const itemTokens = this.estimateTokens(item);
        if (usedTokens + itemTokens <= this.availableForRetrieval) {
          filtered.push(item);
          usedTokens += itemTokens;
        }
      }
      
      return filtered;
    }
  }
  
  /**
   * Get budget breakdown
   */
  getBudgetBreakdown() {
    return {
      maxContextWindow: this.maxContextWindow,
      reservedForNewResults: this.reservedForNewResults,
      reservedForModelOutput: this.reservedForModelOutput,
      reservedForRecovery: this.reservedForRecovery,
      availableForRetrieval: this.availableForRetrieval,
      tierBudgets: {
        LIVE: this.getTierBudget('LIVE'),
        ACTIVE_TASK: this.getTierBudget('ACTIVE_TASK'),
        PROJECT: this.getTierBudget('PROJECT'),
        LONG_TERM: this.getTierBudget('LONG_TERM'),
        ARCHIVE: this.getTierBudget('ARCHIVE')
      }
    };
  }
  
  /**
   * Update max context window
   */
  updateMaxContextWindow(newMax) {
    this.maxContextWindow = newMax;
    this.reservedForNewResults = newMax * 0.20;
    this.reservedForModelOutput = newMax * 0.30;
    this.reservedForRecovery = newMax * 0.10;
    this.availableForRetrieval = newMax - 
      this.reservedForNewResults - 
      this.reservedForModelOutput - 
      this.reservedForRecovery;
  }
}

/**
 * Create context budget manager
 */
export function createContextBudget(maxContextWindow = 128000) {
  return new ContextBudget(maxContextWindow);
}
