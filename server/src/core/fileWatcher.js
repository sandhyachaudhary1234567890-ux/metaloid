// File Watcher - Real-time file change detection
// METAIOID AGENT 1: ContextFabric Hardening & Real Integration
// Supports file created, modified, deleted, rename detection
// Invalidates ContextFabric cache on important file changes

import fs from 'node:fs';
import path from 'node:path';

/**
 * File Watcher - Real-time file change detection
 */
export class FileWatcher {
  constructor(projectPath, options = {}) {
    this.projectPath = projectPath;
    this.watchers = new Map();
    this.onChange = options.onChange || null;
    this.includePatterns = options.includePatterns || [];
    this.excludePatterns = options.excludePatterns || [
      'node_modules',
      'dist',
      'build',
      '.git',
      'coverage',
      '.cache',
      'tmp',
      'temp',
      'logs',
      '__pycache__',
      '.pytest_cache',
      'venv',
      'env',
      '.venv',
      'target',
      'bin',
      'obj'
    ];
    this.debounceMs = options.debounceMs || 1000;
    this.debounceTimers = new Map();
    this.watching = false;
  }
  
  /**
   * Start watching files
   */
  async start() {
    if (this.watching) {
      console.log('File watcher already running');
      return;
    }
    
    console.log('Starting file watcher for:', this.projectPath);
    
    try {
      // Watch the entire project directory
      this._watchDirectory(this.projectPath);
      this.watching = true;
      console.log('File watcher started');
    } catch (error) {
      console.error('Failed to start file watcher:', error.message);
    }
  }
  
  /**
   * Stop watching files
   */
  stop() {
    console.log('Stopping file watcher...');
    
    for (const [watchPath, watcher] of this.watchers) {
      try {
        watcher.close();
      } catch (error) {
        console.error('Failed to close watcher for:', watchPath, error.message);
      }
    }
    
    this.watchers.clear();
    this.debounceTimers.forEach(timer => clearTimeout(timer));
    this.debounceTimers.clear();
    this.watching = false;
    
    console.log('File watcher stopped');
  }
  
  /**
   * Watch a directory recursively
   */
  _watchDirectory(dir) {
    try {
      // Skip excluded directories
      if (this._shouldExclude(dir)) {
        return;
      }
      
      // Create watcher for this directory
      const watcher = fs.watch(dir, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        
        const filePath = path.join(dir, filename);
        
        // Skip excluded files
        if (this._shouldExclude(filePath)) {
          return;
        }
        
        // Debounce the change event
        this._debounceChange(filePath, eventType);
      });
      
      this.watchers.set(dir, watcher);
      
      // Recursively watch subdirectories
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.isDirectory()) {
          this._watchDirectory(path.join(dir, item.name));
        }
      }
    } catch (error) {
      console.error('Failed to watch directory:', dir, error.message);
    }
  }
  
  /**
   * Debounce change events
   */
  _debounceChange(filePath, eventType) {
    const key = filePath;
    
    // Clear existing timer
    if (this.debounceTimers.has(key)) {
      clearTimeout(this.debounceTimers.get(key));
    }
    
    // Set new timer
    const timer = setTimeout(() => {
      this._handleChange(filePath, eventType);
      this.debounceTimers.delete(key);
    }, this.debounceMs);
    
    this.debounceTimers.set(key, timer);
  }
  
  /**
   * Handle file change
   */
  _handleChange(filePath, eventType) {
    let changeType;
    
    if (!fs.existsSync(filePath)) {
      changeType = 'deleted';
    } else if (fs.statSync(filePath).isDirectory()) {
      changeType = 'directory';
    } else {
      changeType = eventType === 'rename' ? 'renamed' : 'modified';
    }
    
    const change = {
      filePath,
      changeType,
      timestamp: Date.now()
    };
    
    console.log('File change detected:', change);
    
    // Notify callback
    if (this.onChange) {
      this.onChange(change);
    }
  }
  
  /**
   * Check if path should be excluded
   */
  _shouldExclude(filePath) {
    const relativePath = path.relative(this.projectPath, filePath);
    
    for (const pattern of this.excludePatterns) {
      if (relativePath.includes(pattern) || relativePath === pattern) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Check if path should be included
   */
  _shouldInclude(filePath) {
    if (this.includePatterns.length === 0) {
      return true;
    }
    
    const relativePath = path.relative(this.projectPath, filePath);
    
    for (const pattern of this.includePatterns) {
      if (relativePath.includes(pattern) || relativePath === pattern) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return {
      projectPath: this.projectPath,
      watching: this.watching,
      watchedDirectories: this.watchers.size,
      debounceTimers: this.debounceTimers.size
    };
  }
}

/**
 * Create file watcher
 */
export function createFileWatcher(projectPath, options = {}) {
  return new FileWatcher(projectPath, options);
}
