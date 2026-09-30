// Project Memory - Integration with existing ContextEngine
// METAIOID AGENT 1: ContextFabric + MetaCode Repository Intelligence
// Stores architecture, decisions, failures, tests, changes, and task summaries

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = process.env.METALOID_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const PROJECT_MEMORY_DIR = path.join(DIR, 'project_memory');

// Ensure memory directory exists
try {
  fs.mkdirSync(PROJECT_MEMORY_DIR, { recursive: true });
} catch { /* ignore */ }

/**
 * Memory Types
 */
export const MemoryTypes = {
  ARCHITECTURE: 'architecture',
  DECISION: 'decision',
  FAILURE: 'failure',
  TEST: 'test',
  CHANGE: 'change',
  TASK: 'task',
  CONVENTION: 'convention',
  COMMAND: 'command',
  ISSUE: 'issue',
  CONSTRAINT: 'constraint'
};

/**
 * Project Memory Manager
 */
export class ProjectMemoryManager {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.memory = new Map();
    this.memoryFile = path.join(PROJECT_MEMORY_DIR, this._getMemoryFileName());
    this.loadMemory();
  }
  
  /**
   * Store architecture summary
   */
  storeArchitecture(summary, components = [], patterns = []) {
    const entry = {
      type: MemoryTypes.ARCHITECTURE,
      summary,
      components,
      patterns,
      timestamp: Date.now()
    };
    
    this._upsertMemory('architecture', entry);
    return entry;
  }
  
  /**
   * Store decision
   */
  storeDecision(decision, rationale, relatedFiles = []) {
    const entry = {
      type: MemoryTypes.DECISION,
      decision,
      rationale,
      relatedFiles,
      timestamp: Date.now()
    };
    
    this._addMemory('decisions', entry);
    return entry;
  }
  
  /**
   * Store failure
   */
  storeFailure(description, attempted = [], solution = '', relatedFiles = []) {
    const entry = {
      type: MemoryTypes.FAILURE,
      description,
      attempted,
      solution,
      relatedFiles,
      timestamp: Date.now()
    };
    
    this._addMemory('failures', entry);
    return entry;
  }
  
  /**
   * Store test result
   */
  storeTest(testName, status, duration, relatedFiles = []) {
    const entry = {
      type: MemoryTypes.TEST,
      testName,
      status, // 'pass' | 'fail' | 'skip'
      duration,
      relatedFiles,
      timestamp: Date.now()
    };
    
    this._addMemory('tests', entry);
    return entry;
  }
  
  /**
   * Store change
   */
  storeChange(description, files = [], impact = '') {
    const entry = {
      type: MemoryTypes.CHANGE,
      description,
      files,
      impact,
      timestamp: Date.now()
    };
    
    this._addMemory('changes', entry);
    return entry;
  }
  
  /**
   * Store task summary
   */
  storeTaskSummary(objective, status, files = [], decisions = []) {
    const entry = {
      type: MemoryTypes.TASK,
      objective,
      status, // 'in_progress' | 'completed' | 'failed'
      files,
      decisions,
      timestamp: Date.now()
    };
    
    this._addMemory('tasks', entry);
    return entry;
  }
  
  /**
   * Store convention
   */
  storeConvention(convention) {
    const entry = {
      type: MemoryTypes.CONVENTION,
      convention,
      timestamp: Date.now()
    };
    
    this._addMemory('conventions', entry);
    return entry;
  }
  
  /**
   * Store command
   */
  storeCommand(command, description) {
    const entry = {
      type: MemoryTypes.COMMAND,
      command,
      description,
      timestamp: Date.now()
    };
    
    this._addMemory('commands', entry);
    return entry;
  }
  
  /**
   * Store known issue
   */
  storeKnownIssue(description, workaround) {
    const entry = {
      type: MemoryTypes.ISSUE,
      description,
      workaround,
      timestamp: Date.now()
    };
    
    this._addMemory('issues', entry);
    return entry;
  }
  
  /**
   * Store constraint
   */
  storeConstraint(constraint, rationale) {
    const entry = {
      type: MemoryTypes.CONSTRAINT,
      constraint,
      rationale,
      timestamp: Date.now()
    };
    
    this._addMemory('constraints', entry);
    return entry;
  }
  
  /**
   * Retrieve architecture summary
   */
  getArchitecture() {
    return this.memory.get('architecture');
  }
  
  /**
   * Retrieve decisions
   */
  getDecisions(limit = 50) {
    const decisions = this.memory.get('decisions') || [];
    return decisions.slice(-limit);
  }
  
  /**
   * Retrieve failures
   */
  getFailures(limit = 50) {
    const failures = this.memory.get('failures') || [];
    return failures.slice(-limit);
  }
  
  /**
   * Retrieve tests
   */
  getTests(limit = 100) {
    const tests = this.memory.get('tests') || [];
    return tests.slice(-limit);
  }
  
  /**
   * Retrieve changes
   */
  getChanges(limit = 100) {
    const changes = this.memory.get('changes') || [];
    return changes.slice(-limit);
  }
  
  /**
   * Retrieve tasks
   */
  getTasks(limit = 50) {
    const tasks = this.memory.get('tasks') || [];
    return tasks.slice(-limit);
  }
  
  /**
   * Retrieve conventions
   */
  getConventions() {
    return this.memory.get('conventions') || [];
  }
  
  /**
   * Retrieve commands
   */
  getCommands() {
    return this.memory.get('commands') || [];
  }
  
  /**
   * Retrieve known issues
   */
  getKnownIssues() {
    return this.memory.get('issues') || [];
  }
  
  /**
   * Retrieve constraints
   */
  getConstraints() {
    return this.memory.get('constraints') || [];
  }
  
  /**
   * Search memory by keyword
   */
  searchMemory(keyword) {
    const results = [];
    const lowerKeyword = keyword.toLowerCase();
    
    for (const [key, value] of this.memory) {
      if (Array.isArray(value)) {
        for (const entry of value) {
          const content = JSON.stringify(entry).toLowerCase();
          if (content.includes(lowerKeyword)) {
            results.push(entry);
          }
        }
      } else if (typeof value === 'object') {
        const content = JSON.stringify(value).toLowerCase();
        if (content.includes(lowerKeyword)) {
          results.push(value);
        }
      }
    }
    
    return results;
  }
  
  /**
   * Retrieve decisions by file
   */
  getDecisionsByFile(filePath) {
    const decisions = this.memory.get('decisions') || [];
    return decisions.filter(dec => 
      dec.relatedFiles && dec.relatedFiles.includes(filePath)
    );
  }
  
  /**
   * Retrieve failures by file
   */
  getFailuresByFile(filePath) {
    const failures = this.memory.get('failures') || [];
    return failures.filter(fail => 
      fail.relatedFiles && fail.relatedFiles.includes(filePath)
    );
  }
  
  /**
   * Retrieve tests by file
   */
  getTestsByFile(filePath) {
    const tests = this.memory.get('tests') || [];
    return tests.filter(test => 
      test.relatedFiles && test.relatedFiles.includes(filePath)
    );
  }
  
  /**
   * Retrieve changes by file
   */
  getChangesByFile(filePath) {
    const changes = this.memory.get('changes') || [];
    return changes.filter(change => 
      change.files && change.files.includes(filePath)
    );
  }
  
  /**
   * Get memory statistics
   */
  getStats() {
    let totalEntries = 0;
    const typeCounts = {};
    
    for (const [key, value] of this.memory) {
      if (Array.isArray(value)) {
        totalEntries += value.length;
        typeCounts[key] = value.length;
      } else if (typeof value === 'object') {
        totalEntries += 1;
        typeCounts[key] = 1;
      }
    }
    
    return {
      projectPath: this.projectPath,
      totalEntries,
      typeCounts,
      lastUpdated: this.memory.get('lastUpdated') || Date.now()
    };
  }
  
  /**
   * Save memory to disk
   */
  saveMemory() {
    this.memory.set('lastUpdated', Date.now());
    
    try {
      fs.writeFileSync(this.memoryFile, JSON.stringify(Object.fromEntries(this.memory), null, 2));
    } catch (error) {
      console.error('Failed to save project memory:', error.message);
    }
  }
  
  /**
   * Load memory from disk
   */
  loadMemory() {
    if (fs.existsSync(this.memoryFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.memoryFile, 'utf8'));
        this.memory = new Map(Object.entries(data));
      } catch (error) {
        console.error('Failed to load project memory:', error.message);
        this.memory = new Map();
      }
    }
  }
  
  /**
   * Clear all memory
   */
  clearMemory() {
    this.memory.clear();
    this.saveMemory();
  }
  
  /**
   * Add memory entry to array
   */
  _addMemory(key, entry) {
    if (!this.memory.has(key)) {
      this.memory.set(key, []);
    }
    
    const array = this.memory.get(key);
    array.push(entry);
    
    // Keep only last 1000 entries per type
    if (array.length > 1000) {
      this.memory.set(key, array.slice(-1000));
    }
    
    this.saveMemory();
  }
  
  /**
   * Upsert memory entry (single value)
   */
  _upsertMemory(key, entry) {
    this.memory.set(key, entry);
    this.saveMemory();
  }
  
  /**
   * Get memory file name
   */
  _getMemoryFileName() {
    const hash = this._hashPath(this.projectPath);
    return `memory_${hash}.json`;
  }
  
  /**
   * Hash path for memory file name
   */
  _hashPath(filePath) {
    return filePath.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
  }
}

/**
 * Create project memory manager
 */
export function createProjectMemory(projectPath) {
  return new ProjectMemoryManager(projectPath);
}
