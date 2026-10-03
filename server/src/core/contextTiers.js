// Context Tiers - Implementation of context tier management
// METAIOID AGENT 1: ContextFabric + MetaCode Repository Intelligence
// Manages LIVE, ACTIVE_TASK, PROJECT, LONG_TERM, and ARCHIVE context tiers

import fs from 'node:fs';
import path from 'node:path';
import { ContextTiers } from './contextFabric.js';

/**
 * LIVE Context Manager
 * Current interaction state: prompt, tool results, current file, errors
 */
export class LiveContextManager {
  constructor() {
    this.currentPrompt = null;
    this.currentToolResult = null;
    this.currentFile = null;
    this.currentError = null;
    this.cursorPosition = null;
  }
  
  /**
   * Set current prompt
   */
  setPrompt(prompt) {
    this.currentPrompt = prompt;
  }
  
  /**
   * Set current tool result
   */
  setToolResult(result) {
    this.currentToolResult = result;
  }
  
  /**
   * Set current file
   */
  setCurrentFile(filePath, content = null) {
    this.currentFile = { filePath, content };
    if (content === null && filePath && fs.existsSync(filePath)) {
      this.currentFile.content = fs.readFileSync(filePath, 'utf8');
    }
  }
  
  /**
   * Set current error
   */
  setCurrentError(error) {
    this.currentError = error;
  }
  
  /**
   * Set cursor position
   */
  setCursorPosition(line, column) {
    this.cursorPosition = { line, column };
  }
  
  /**
   * Get LIVE context
   */
  getContext() {
    const context = {
      tier: ContextTiers.LIVE,
      items: []
    };
    
    if (this.currentPrompt) {
      context.items.push({
        type: 'prompt',
        content: this.currentPrompt,
        importance: 'critical',
        timestamp: Date.now()
      });
    }
    
    if (this.currentFile && this.currentFile.content) {
      context.items.push({
        type: 'file',
        filePath: this.currentFile.filePath,
        content: this.currentFile.content,
        importance: 'critical',
        timestamp: Date.now()
      });
    }
    
    if (this.currentToolResult) {
      context.items.push({
        type: 'tool_result',
        content: this.currentToolResult,
        importance: 'high',
        timestamp: Date.now()
      });
    }
    
    if (this.currentError) {
      context.items.push({
        type: 'error',
        content: this.currentError,
        importance: 'critical',
        timestamp: Date.now()
      });
    }
    
    if (this.cursorPosition) {
      context.items.push({
        type: 'cursor_position',
        content: JSON.stringify(this.cursorPosition),
        importance: 'medium',
        timestamp: Date.now()
      });
    }
    
    return context;
  }
  
  /**
   * Clear LIVE context
   */
  clear() {
    this.currentPrompt = null;
    this.currentToolResult = null;
    this.currentFile = null;
    this.currentError = null;
    this.cursorPosition = null;
  }
}

/**
 * ACTIVE_TASK Context Manager
 * Current task state: plan, recent edits, tests, failures, unfinished work
 */
export class ActiveTaskContextManager {
  constructor() {
    this.currentPlan = null;
    this.recentEdits = [];
    this.relatedTests = [];
    this.currentFailures = [];
    this.unfinishedWork = [];
    this.inProgressChanges = [];
  }
  
  /**
   * Set current plan
   */
  setPlan(plan) {
    this.currentPlan = plan;
  }
  
  /**
   * Add recent edit
   */
  addRecentEdit(filePath, changeType = 'edit') {
    this.recentEdits.push({
      filePath,
      changeType,
      timestamp: Date.now()
    });
    
    // Keep only last 10 edits
    if (this.recentEdits.length > 10) {
      this.recentEdits = this.recentEdits.slice(-10);
    }
  }
  
  /**
   * Add related test
   */
  addRelatedTest(testPath) {
    if (!this.relatedTests.includes(testPath)) {
      this.relatedTests.push(testPath);
    }
  }
  
  /**
   * Add current failure
   */
  addFailure(failure) {
    this.currentFailures.push({
      content: failure,
      timestamp: Date.now()
    });
  }
  
  /**
   * Add unfinished work
   */
  addUnfinishedWork(item) {
    this.unfinishedWork.push({
      description: item,
      timestamp: Date.now()
    });
  }
  
  /**
   * Add in-progress change
   */
  addInProgressChange(filePath, description) {
    this.inProgressChanges.push({
      filePath,
      description,
      timestamp: Date.now()
    });
  }
  
  /**
   * Get ACTIVE_TASK context
   */
  async getContext() {
    const context = {
      tier: ContextTiers.ACTIVE_TASK,
      items: []
    };
    
    if (this.currentPlan) {
      context.items.push({
        type: 'plan',
        content: this.currentPlan,
        importance: 'critical',
        timestamp: Date.now()
      });
    }
    
    // Recent edits
    for (const edit of this.recentEdits) {
      if (fs.existsSync(edit.filePath)) {
        const content = fs.readFileSync(edit.filePath, 'utf8');
        context.items.push({
          type: 'recent_edit',
          filePath: edit.filePath,
          changeType: edit.changeType,
          content,
          importance: 'high',
          timestamp: edit.timestamp
        });
      }
    }
    
    // Related tests
    for (const testPath of this.relatedTests) {
      if (fs.existsSync(testPath)) {
        const content = fs.readFileSync(testPath, 'utf8');
        context.items.push({
          type: 'test',
          filePath: testPath,
          content,
          importance: 'high',
          timestamp: Date.now()
        });
      }
    }
    
    // Current failures
    for (const failure of this.currentFailures) {
      context.items.push({
        type: 'failure',
        content: failure.content,
        importance: 'critical',
        timestamp: failure.timestamp
      });
    }
    
    // Unfinished work
    for (const work of this.unfinishedWork) {
      context.items.push({
        type: 'unfinished_work',
        content: work.description,
        importance: 'high',
        timestamp: work.timestamp
      });
    }
    
    // In-progress changes
    for (const change of this.inProgressChanges) {
      context.items.push({
        type: 'in_progress_change',
        filePath: change.filePath,
        description: change.description,
        importance: 'high',
        timestamp: change.timestamp
      });
    }
    
    return context;
  }
  
  /**
   * Clear ACTIVE_TASK context
   */
  clear() {
    this.currentPlan = null;
    this.recentEdits = [];
    this.relatedTests = [];
    this.currentFailures = [];
    this.unfinishedWork = [];
    this.inProgressChanges = [];
  }
}

/**
 * PROJECT Context Manager
 * Project architecture and important code
 */
export class ProjectContextManager {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.architectureSummary = null;
    this.keyFiles = [];
    this.dependencies = [];
    this.configurations = [];
    this.importantDecisions = [];
    this.projectConventions = [];
  }
  
  /**
   * Set architecture summary
   */
  setArchitectureSummary(summary) {
    this.architectureSummary = summary;
  }
  
  /**
   * Add key file
   */
  addKeyFile(filePath, importance = 'high') {
    if (!this.keyFiles.some(f => f.filePath === filePath)) {
      this.keyFiles.push({
        filePath,
        importance,
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * Add dependency
   */
  addDependency(name, version, type = 'production') {
    if (!this.dependencies.some(d => d.name === name)) {
      this.dependencies.push({
        name,
        version,
        type,
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * Add configuration
   */
  addConfiguration(filePath, configType) {
    if (!this.configurations.some(c => c.filePath === filePath)) {
      this.configurations.push({
        filePath,
        configType,
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * Add important decision
   */
  addImportantDecision(decision, rationale) {
    this.importantDecisions.push({
      decision,
      rationale,
      timestamp: Date.now()
    });
  }
  
  /**
   * Add project convention
   */
  addProjectConvention(convention) {
    if (!this.projectConventions.includes(convention)) {
      this.projectConventions.push(convention);
    }
  }
  
  /**
   * Get PROJECT context
   */
  async getContext() {
    const context = {
      tier: ContextTiers.PROJECT,
      items: []
    };
    
    if (this.architectureSummary) {
      context.items.push({
        type: 'architecture_summary',
        content: this.architectureSummary,
        importance: 'critical',
        timestamp: Date.now()
      });
    }
    
    // Key files
    for (const keyFile of this.keyFiles) {
      const filePath = path.join(this.projectPath, keyFile.filePath);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        context.items.push({
          type: 'key_file',
          filePath,
          content,
          importance: keyFile.importance,
          timestamp: keyFile.timestamp
        });
      }
    }
    
    // Dependencies
    if (this.dependencies.length > 0) {
      context.items.push({
        type: 'dependencies',
        content: JSON.stringify(this.dependencies, null, 2),
        importance: 'medium',
        timestamp: Date.now()
      });
    }
    
    // Configurations
    for (const config of this.configurations) {
      const filePath = path.join(this.projectPath, config.filePath);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        context.items.push({
          type: 'configuration',
          filePath,
          configType: config.configType,
          content,
          importance: 'high',
          timestamp: config.timestamp
        });
      }
    }
    
    // Important decisions
    for (const decision of this.importantDecisions) {
      context.items.push({
        type: 'decision',
        content: `${decision.decision}\nRationale: ${decision.rationale}`,
        importance: 'high',
        timestamp: decision.timestamp
      });
    }
    
    // Project conventions
    if (this.projectConventions.length > 0) {
      context.items.push({
        type: 'conventions',
        content: this.projectConventions.join('\n'),
        importance: 'medium',
        timestamp: Date.now()
      });
    }
    
    return context;
  }
  
  /**
   * Clear PROJECT context
   */
  clear() {
    this.architectureSummary = null;
    this.keyFiles = [];
    this.dependencies = [];
    this.configurations = [];
    this.importantDecisions = [];
    this.projectConventions = [];
  }
}

/**
 * LONG_TERM Context Manager
 * Historical project knowledge
 */
export class LongTermContextManager {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.historicalDecisions = [];
    this.importantFixes = [];
    this.milestones = [];
    this.architectureEvolution = [];
    this.knownIssues = [];
  }
  
  /**
   * Add historical decision
   */
  addHistoricalDecision(decision, rationale, timestamp = Date.now()) {
    this.historicalDecisions.push({
      decision,
      rationale,
      timestamp
    });
  }
  
  /**
   * Add important fix
   */
  addImportantFix(description, filesAffected, timestamp = Date.now()) {
    this.importantFixes.push({
      description,
      filesAffected,
      timestamp
    });
  }
  
  /**
   * Add milestone
   */
  addMilestone(description, timestamp = Date.now()) {
    this.milestones.push({
      description,
      timestamp
    });
  }
  
  /**
   * Add architecture evolution
   */
  addArchitectureEvolution(description, timestamp = Date.now()) {
    this.architectureEvolution.push({
      description,
      timestamp
    });
  }
  
  /**
   * Add known issue
   */
  addKnownIssue(description, workaround, timestamp = Date.now()) {
    this.knownIssues.push({
      description,
      workaround,
      timestamp
    });
  }
  
  /**
   * Get LONG_TERM context
   */
  async getContext() {
    const context = {
      tier: ContextTiers.LONG_TERM,
      items: []
    };
    
    // Historical decisions
    for (const decision of this.historicalDecisions) {
      context.items.push({
        type: 'historical_decision',
        content: `${decision.decision}\nRationale: ${decision.rationale}`,
        importance: 'medium',
        timestamp: decision.timestamp
      });
    }
    
    // Important fixes
    for (const fix of this.importantFixes) {
      context.items.push({
        type: 'important_fix',
        content: `${fix.description}\nFiles: ${fix.filesAffected.join(', ')}`,
        importance: 'medium',
        timestamp: fix.timestamp
      });
    }
    
    // Milestones
    for (const milestone of this.milestones) {
      context.items.push({
        type: 'milestone',
        content: milestone.description,
        importance: 'low',
        timestamp: milestone.timestamp
      });
    }
    
    // Architecture evolution
    for (const evolution of this.architectureEvolution) {
      context.items.push({
        type: 'architecture_evolution',
        content: evolution.description,
        importance: 'medium',
        timestamp: evolution.timestamp
      });
    }
    
    // Known issues
    for (const issue of this.knownIssues) {
      context.items.push({
        type: 'known_issue',
        content: `${issue.description}\nWorkaround: ${issue.workaround}`,
        importance: 'medium',
        timestamp: issue.timestamp
      });
    }
    
    return context;
  }
  
  /**
   * Clear LONG_TERM context
   */
  clear() {
    this.historicalDecisions = [];
    this.importantFixes = [];
    this.milestones = [];
    this.architectureEvolution = [];
    this.knownIssues = [];
  }
}

/**
 * ARCHIVE Context Manager
 * Searchable but not auto-injected context
 */
export class ArchiveContextManager {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.allFiles = [];
    this.historicalCode = [];
    this.deprecatedCode = [];
    this.documentation = [];
  }
  
  /**
   * Index all project files
   */
  async indexAllFiles() {
    // This would integrate with CodebaseIndex
    // For now, placeholder
    this.allFiles = [];
  }
  
  /**
   * Add historical code
   */
  addHistoricalCode(filePath, content, timestamp = Date.now()) {
    this.historicalCode.push({
      filePath,
      content,
      timestamp
    });
  }
  
  /**
   * Add deprecated code
   */
  addDeprecatedCode(filePath, reason, timestamp = Date.now()) {
    this.deprecatedCode.push({
      filePath,
      reason,
      timestamp
    });
  }
  
  /**
   * Add documentation
   */
  addDocumentation(filePath, content, timestamp = Date.now()) {
    this.documentation.push({
      filePath,
      content,
      timestamp
    });
  }
  
  /**
   * Get ARCHIVE context (on-demand only)
   */
  async getContext(query) {
    const context = {
      tier: ContextTiers.ARCHIVE,
      items: []
    };
    
    // This would implement search-based retrieval
    // For now, placeholder
    
    return context;
  }
  
  /**
   * Search archive
   */
  async search(query) {
    // This would implement keyword/semantic search
    // For now, placeholder
    return [];
  }
  
  /**
   * Clear ARCHIVE context
   */
  clear() {
    this.allFiles = [];
    this.historicalCode = [];
    this.deprecatedCode = [];
    this.documentation = [];
  }
}

/**
 * Context Tier Manager - Orchestrates all tier managers
 */
export class ContextTierManager {
  constructor(projectPath) {
    this.liveContext = new LiveContextManager();
    this.activeTaskContext = new ActiveTaskContextManager();
    this.projectContext = new ProjectContextManager(projectPath);
    this.longTermContext = new LongTermContextManager(projectPath);
    this.archiveContext = new ArchiveContextManager(projectPath);
  }
  
  /**
   * Get context from specific tier
   */
  async getTierContext(tier) {
    switch (tier) {
      case ContextTiers.LIVE:
        return this.liveContext.getContext();
      case ContextTiers.ACTIVE_TASK:
        return this.activeTaskContext.getContext();
      case ContextTiers.PROJECT:
        return this.projectContext.getContext();
      case ContextTiers.LONG_TERM:
        return this.longTermContext.getContext();
      case ContextTiers.ARCHIVE:
        return this.archiveContext.getContext();
      default:
        throw new Error(`Unknown tier: ${tier}`);
    }
  }
  
  /**
   * Get all tier contexts
   */
  async getAllContexts() {
    return {
      [ContextTiers.LIVE]: await this.liveContext.getContext(),
      [ContextTiers.ACTIVE_TASK]: await this.activeTaskContext.getContext(),
      [ContextTiers.PROJECT]: await this.projectContext.getContext(),
      [ContextTiers.LONG_TERM]: await this.longTermContext.getContext(),
      [ContextTiers.ARCHIVE]: await this.archiveContext.getContext()
    };
  }
  
  /**
   * Clear all tier contexts
   */
  clearAll() {
    this.liveContext.clear();
    this.activeTaskContext.clear();
    this.projectContext.clear();
    this.longTermContext.clear();
    this.archiveContext.clear();
  }
  
  /**
   * Get individual tier managers
   */
  get managers() {
    return {
      live: this.liveContext,
      activeTask: this.activeTaskContext,
      project: this.projectContext,
      longTerm: this.longTermContext,
      archive: this.archiveContext
    };
  }
}
