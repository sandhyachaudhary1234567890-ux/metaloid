// Git History Search - Real Git-aware retrieval
// METAIOID AGENT 1: ContextFabric Hardening & Real Integration
// Supports commit history, changed files, commit messages, blame, file history

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Git History Search Engine
 */
export class GitHistorySearchEngine {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.isGitRepo = false;
    this.gitAvailable = false;
  }
  
  /**
   * Initialize Git repository detection
   */
  async initialize() {
    try {
      // Check if git is available
      await execAsync('git --version', { cwd: this.projectPath });
      this.gitAvailable = true;
      
      // Check if project is a git repository
      await execAsync('git rev-parse --git-dir', { cwd: this.projectPath });
      this.isGitRepo = true;
      
      console.log('Git history search initialized for:', this.projectPath);
    } catch (error) {
      console.log('Git history not available:', error.message);
      this.isGitRepo = false;
      this.gitAvailable = false;
    }
  }
  
  /**
   * Search commit history for a query
   */
  async searchCommits(query, options = {}) {
    if (!this.isGitRepo || !this.gitAvailable) {
      return [];
    }
    
    const {
      maxResults = 20,
      since = '3 months ago',
      author = null
    } = options;
    
    try {
      let command = `git log --since="${since}" --pretty=format:"%H|%an|%ae|%ad|%s" --date=iso`;
      
      if (author) {
        command += ` --author="${author}"`;
      }
      
      if (query) {
        command += ` --grep="${query}"`;
      }
      
      command += ` -${maxResults}`;
      
      const { stdout } = await execAsync(command, { cwd: this.projectPath });
      const commits = this._parseCommitLog(stdout);
      
      return commits;
    } catch (error) {
      console.error('Git commit search failed:', error.message);
      return [];
    }
  }
  
  /**
   * Get files changed in a commit
   */
  async getCommitFiles(commitHash) {
    if (!this.isGitRepo || !this.gitAvailable) {
      return [];
    }
    
    try {
      const command = `git show --name-status --pretty=format: ${commitHash}`;
      const { stdout } = await execAsync(command, { cwd: this.projectPath });
      const files = this._parseCommitFiles(stdout);
      
      return files;
    } catch (error) {
      console.error('Failed to get commit files:', error.message);
      return [];
    }
  }
  
  /**
   * Get file history
   */
  async getFileHistory(filePath, options = {}) {
    if (!this.isGitRepo || !this.gitAvailable) {
      return [];
    }
    
    const { maxResults = 20 } = options;
    
    try {
      const command = `git log --follow --pretty=format:"%H|%an|%ad|%s" --date=iso -${maxResults} -- "${filePath}"`;
      const { stdout } = await execAsync(command, { cwd: this.projectPath });
      const history = this._parseCommitLog(stdout);
      
      return history;
    } catch (error) {
      console.error('Failed to get file history:', error.message);
      return [];
    }
  }
  
  /**
   * Get blame information for a file
   */
  async getFileBlame(filePath, options = {}) {
    if (!this.isGitRepo || !this.gitAvailable) {
      return [];
    }
    
    const { lineStart = 1, lineEnd = null } = options;
    
    try {
      let command = `git blame --line-porcelain`;
      
      if (lineStart && lineEnd) {
        command += ` -L ${lineStart},${lineEnd}`;
      }
      
      command += ` "${filePath}"`;
      
      const { stdout } = await execAsync(command, { cwd: this.projectPath });
      const blame = this._parseBlame(stdout);
      
      return blame;
    } catch (error) {
      console.error('Failed to get file blame:', error.message);
      return [];
    }
  }
  
  /**
   * Get commits that modified a file
   */
  async getFileCommits(filePath, options = {}) {
    if (!this.isGitRepo || !this.gitAvailable) {
      return [];
    }
    
    const { maxResults = 20 } = options;
    
    try {
      const command = `git log --pretty=format:"%H|%an|%ad|%s" --date=iso -${maxResults} -- "${filePath}"`;
      const { stdout } = await execAsync(command, { cwd: this.projectPath });
      const commits = this._parseCommitLog(stdout);
      
      return commits;
    } catch (error) {
      console.error('Failed to get file commits:', error.message);
      return [];
    }
  }
  
  /**
   * Search for commits that modified files matching a pattern
   */
  async searchCommitsByFilePattern(pattern, options = {}) {
    if (!this.isGitRepo || !this.gitAvailable) {
      return [];
    }
    
    const {
      maxResults = 20,
      since = '3 months ago'
    } = options;
    
    try {
      const command = `git log --since="${since}" --name-only --pretty=format:"%H|%an|%ad|%s" --date=iso -${maxResults} -- "${pattern}"`;
      const { stdout } = await execAsync(command, { cwd: this.projectPath });
      const commits = this._parseCommitLog(stdout);
      
      return commits;
    } catch (error) {
      console.error('Failed to search commits by file pattern:', error.message);
      return [];
    }
  }
  
  /**
   * Get related commits (commits that modified related files)
   */
  async getRelatedCommits(filePath, options = {}) {
    if (!this.isGitRepo || !this.gitAvailable) {
      return [];
    }
    
    const { maxResults = 10 } = options;
    
    try {
      // Get commits that modified the file
      const fileCommits = await this.getFileCommits(filePath, { maxResults: 5 });
      
      // Get files changed in those commits
      const relatedFiles = new Set();
      for (const commit of fileCommits) {
        const files = await this.getCommitFiles(commit.hash);
        for (const file of files) {
          if (file.filePath !== filePath) {
            relatedFiles.add(file.filePath);
          }
        }
      }
      
      // Get commits that modified related files
      const relatedCommits = [];
      for (const relatedFile of relatedFiles) {
        const commits = await this.getFileCommits(relatedFile, { maxResults: 3 });
        relatedCommits.push(...commits);
      }
      
      // Deduplicate and limit
      const seen = new Set();
      const uniqueCommits = [];
      for (const commit of relatedCommits) {
        if (!seen.has(commit.hash)) {
          seen.add(commit.hash);
          uniqueCommits.push(commit);
        }
      }
      
      return uniqueCommits.slice(0, maxResults);
    } catch (error) {
      console.error('Failed to get related commits:', error.message);
      return [];
    }
  }
  
  /**
   * Get commit diff
   */
  async getCommitDiff(commitHash, options = {}) {
    if (!this.isGitRepo || !this.gitAvailable) {
      return null;
    }
    
    const { filePath = null } = options;
    
    try {
      let command = `git show ${commitHash}`;
      
      if (filePath) {
        command += ` -- "${filePath}"`;
      }
      
      const { stdout } = await execAsync(command, { cwd: this.projectPath });
      
      return stdout;
    } catch (error) {
      console.error('Failed to get commit diff:', error.message);
      return null;
    }
  }
  
  /**
   * Parse commit log output
   */
  _parseCommitLog(output) {
    const commits = [];
    const lines = output.split('\n');
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      const parts = line.split('|');
      if (parts.length >= 5) {
        commits.push({
          hash: parts[0],
          author: parts[1],
          email: parts[2],
          date: parts[3],
          message: parts.slice(4).join('|')
        });
      }
    }
    
    return commits;
  }
  
  /**
   * Parse commit files output
   */
  _parseCommitFiles(output) {
    const files = [];
    const lines = output.split('\n');
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      const parts = line.split('\t');
      if (parts.length >= 2) {
        files.push({
          status: parts[0],
          filePath: parts[1]
        });
      }
    }
    
    return files;
  }
  
  /**
   * Parse blame output
   */
  _parseBlame(output) {
    const blame = [];
    const lines = output.split('\n');
    let currentEntry = null;
    
    for (const line of lines) {
      if (line.startsWith('\t')) {
        // This is the actual line content
        if (currentEntry) {
          currentEntry.line = line.substring(1);
          blame.push(currentEntry);
          currentEntry = null;
        }
      } else {
        // This is blame metadata
        const parts = line.split(' ');
        if (parts[0] && parts[0].length === 40) {
          currentEntry = {
            hash: parts[0],
            author: parts[1],
            authorMail: parts[2],
            authorTime: parts[3],
            authorTz: parts[4],
            committer: parts[5],
            committerMail: parts[6],
            committerTime: parts[7],
            committerTz: parts[8],
            summary: parts.slice(9).join(' ')
          };
        }
      }
    }
    
    return blame;
  }
  
  /**
   * Check if Git is available
   */
  isAvailable() {
    return this.gitAvailable && this.isGitRepo;
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return {
      projectPath: this.projectPath,
      isGitRepo: this.isGitRepo,
      gitAvailable: this.gitAvailable
    };
  }
}

/**
 * Create Git history search engine
 */
export function createGitHistorySearchEngine(projectPath) {
  return new GitHistorySearchEngine(projectPath);
}
