// Codebase Index - Repository intelligence for files, symbols, dependencies, and tests
// METAIOID AGENT 1: ContextFabric + MetaCode Repository Intelligence
// Enables intelligent codebase understanding and retrieval

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = process.env.METALOID_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const INDEX_CACHE_DIR = path.join(DIR, 'codebase_index');

// Ensure cache directory exists
try {
  fs.mkdirSync(INDEX_CACHE_DIR, { recursive: true });
} catch { /* ignore */ }

/**
 * Language detection patterns
 */
const LANGUAGE_PATTERNS = {
  javascript: ['.js', '.jsx', '.mjs'],
  typescript: ['.ts', '.tsx'],
  python: ['.py'],
  java: ['.java'],
  go: ['.go'],
  rust: ['.rs'],
  cpp: ['.cpp', '.cc', '.cxx', '.h', '.hpp'],
  csharp: ['.cs'],
  php: ['.php'],
  ruby: ['.rb'],
  swift: ['.swift'],
  kotlin: ['.kt', '.kts'],
  scala: ['.scala'],
  dart: ['.dart'],
  elixir: ['.ex', '.exs'],
  lua: ['.lua'],
  r: ['.r', '.R'],
  sql: ['.sql'],
  html: ['.html', '.htm'],
  css: ['.css', '.scss', '.sass', '.less'],
  json: ['.json'],
  yaml: ['.yaml', '.yml'],
  xml: ['.xml'],
  markdown: ['.md', '.markdown'],
  shell: ['.sh', '.bash', '.zsh', '.fish'],
  powershell: ['.ps1', '.psm1'],
  dockerfile: ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml']
};

/**
 * File importance patterns
 */
const IMPORTANCE_PATTERNS = {
  critical: [
    'package.json', 'package-lock.json', 'yarn.lock',
    'requirements.txt', 'poetry.lock', 'Pipfile',
    'Cargo.toml', 'Cargo.lock',
    'go.mod', 'go.sum',
    'pom.xml', 'build.gradle',
    'tsconfig.json', 'jsconfig.json',
    '.gitignore', '.env.example'
  ],
  high: [
    'index.js', 'index.ts', 'main.js', 'main.ts', 'app.js', 'app.ts',
    'server.js', 'server.ts', 'api.js', 'api.ts',
    'routes.js', 'routes.ts', 'controllers.js', 'controllers.ts',
    'models.js', 'models.ts', 'schemas.js', 'schemas.ts',
    'config.js', 'config.ts', 'settings.js', 'settings.ts'
  ],
  medium: [
    'utils.js', 'utils.ts', 'helpers.js', 'helpers.ts',
    'services.js', 'services.ts', 'handlers.js', 'handlers.ts',
    'middleware.js', 'middleware.ts',
    'components', 'views', 'templates', 'pages'
  ],
  low: [
    'node_modules', 'dist', 'build', '.git', 'coverage',
    '.cache', 'tmp', 'temp', 'logs'
  ]
};

/**
 * Exclude patterns
 */
const EXCLUDE_PATTERNS = [
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
  'obj',
  'out',
  '*.min.js',
  '*.min.css',
  '*.map',
  '*.lock'
];

/**
 * Codebase Index - Main index manager
 */
export class CodebaseIndex {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.fileIndex = new Map();
    this.symbolIndex = new Map();
    this.dependencyIndex = new Map();
    this.testIndex = new Map();
    this.indexTimestamp = 0;
    this.indexDirty = true;
  }
  
  /**
   * Build complete index
   */
  async buildIndex() {
    console.log('Building codebase index...');
    
    // Clear existing index
    this.fileIndex.clear();
    this.symbolIndex.clear();
    this.dependencyIndex.clear();
    this.testIndex.clear();
    
    // Index files
    await this._indexFiles();
    
    // Index dependencies
    await this._indexDependencies();
    
    // Index tests
    await this._indexTests();
    
    this.indexTimestamp = Date.now();
    this.indexDirty = false;
    
    console.log('Codebase index built successfully');
    return this.getStats();
  }
  
  /**
   * Index files
   */
  async _indexFiles() {
    const files = this._walkDirectory(this.projectPath);
    
    for (const filePath of files) {
      const relativePath = path.relative(this.projectPath, filePath);
      const stats = fs.statSync(filePath);
      const language = this._detectLanguage(filePath);
      const importance = this._detectImportance(relativePath);
      const isTest = this._isTestFile(filePath);
      const isConfig = this._isConfigFile(filePath);
      const isGenerated = this._isGeneratedFile(filePath);
      
      const fileEntry = {
        filePath: relativePath,
        absolutePath: filePath,
        fileName: path.basename(filePath),
        extension: path.extname(filePath),
        language,
        size: stats.size,
        lastModified: stats.mtimeMs,
        lines: this._countLines(filePath),
        directory: path.dirname(relativePath),
        isTest,
        isConfig,
        isGenerated,
        importance
      };
      
      this.fileIndex.set(relativePath, fileEntry);
      
      // Index symbols for code files
      if (!isGenerated && this._isCodeFile(filePath)) {
        await this._indexSymbols(filePath, fileEntry);
      }
    }
  }
  
  /**
   * Index symbols in a file
   */
  async _indexSymbols(filePath, fileEntry) {
    const content = fs.readFileSync(filePath, 'utf8');
    const symbols = this._extractSymbols(content, fileEntry.language);
    
    for (const symbol of symbols) {
      const symbolId = `${fileEntry.filePath}:${symbol.name}:${symbol.line}`;
      this.symbolIndex.set(symbolId, {
        symbolId,
        ...symbol,
        filePath: fileEntry.filePath,
        absolutePath: filePath,
        language: fileEntry.language
      });
    }
  }
  
  /**
   * Extract symbols from code
   */
  _extractSymbols(content, language) {
    const symbols = [];
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNumber = i + 1;
      
      if (language === 'javascript' || language === 'typescript') {
        this._extractJSSymbols(line, lineNumber, symbols);
      } else if (language === 'python') {
        this._extractPythonSymbols(line, lineNumber, symbols);
      }
      // Add more language parsers as needed
    }
    
    return symbols;
  }
  
  /**
   * Extract JavaScript/TypeScript symbols
   */
  _extractJSSymbols(line, lineNumber, symbols) {
    // Function declarations
    const functionMatch = line.match(/function\s+(\w+)/);
    if (functionMatch) {
      symbols.push({
        name: functionMatch[1],
        type: 'function',
        line: lineNumber,
        column: line.indexOf(functionMatch[1]),
        signature: line.trim(),
        isExported: line.includes('export'),
        isAsync: line.includes('async')
      });
    }
    
    // Arrow functions
    const arrowMatch = line.match(/const\s+(\w+)\s*=\s*(?:async\s+)?\(/);
    if (arrowMatch) {
      symbols.push({
        name: arrowMatch[1],
        type: 'function',
        line: lineNumber,
        column: line.indexOf(arrowMatch[1]),
        signature: line.trim(),
        isExported: line.includes('export'),
        isAsync: line.includes('async')
      });
    }
    
    // Class declarations
    const classMatch = line.match(/class\s+(\w+)/);
    if (classMatch) {
      symbols.push({
        name: classMatch[1],
        type: 'class',
        line: lineNumber,
        column: line.indexOf(classMatch[1]),
        signature: line.trim(),
        isExported: line.includes('export')
      });
    }
    
    // Variable declarations
    const varMatch = line.match(/(?:const|let|var)\s+(\w+)/);
    if (varMatch) {
      symbols.push({
        name: varMatch[1],
        type: 'variable',
        line: lineNumber,
        column: line.indexOf(varMatch[1]),
        signature: line.trim(),
        isExported: line.includes('export')
      });
    }
  }
  
  /**
   * Extract Python symbols
   */
  _extractPythonSymbols(line, lineNumber, symbols) {
    // Function definitions
    const functionMatch = line.match(/def\s+(\w+)/);
    if (functionMatch) {
      symbols.push({
        name: functionMatch[1],
        type: 'function',
        line: lineNumber,
        column: line.indexOf(functionMatch[1]),
        signature: line.trim(),
        isExported: true,
        isAsync: line.includes('async')
      });
    }
    
    // Class definitions
    const classMatch = line.match(/class\s+(\w+)/);
    if (classMatch) {
      symbols.push({
        name: classMatch[1],
        type: 'class',
        line: lineNumber,
        column: line.indexOf(classMatch[1]),
        signature: line.trim(),
        isExported: true
      });
    }
  }
  
  /**
   * Index dependencies
   */
  async _indexDependencies() {
    // Check for package.json
    const packageJsonPath = path.join(this.projectPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        this._indexNpmDependencies(packageJson);
      } catch (error) {
        console.error('Failed to parse package.json:', error.message);
      }
    }
    
    // Check for requirements.txt
    const requirementsPath = path.join(this.projectPath, 'requirements.txt');
    if (fs.existsSync(requirementsPath)) {
      this._indexPythonDependencies(requirementsPath);
    }
    
    // Check for Cargo.toml
    const cargoPath = path.join(this.projectPath, 'Cargo.toml');
    if (fs.existsSync(cargoPath)) {
      this._indexRustDependencies(cargoPath);
    }
  }
  
  /**
   * Index npm dependencies
   */
  _indexNpmDependencies(packageJson) {
    const dependencies = packageJson.dependencies || {};
    const devDependencies = packageJson.devDependencies || {};
    
    for (const [name, version] of Object.entries(dependencies)) {
      this.dependencyIndex.set(name, {
        name,
        version,
        type: 'production',
        source: 'npm',
        isDevDependency: false
      });
    }
    
    for (const [name, version] of Object.entries(devDependencies)) {
      this.dependencyIndex.set(name, {
        name,
        version,
        type: 'development',
        source: 'npm',
        isDevDependency: true
      });
    }
  }
  
  /**
   * Index Python dependencies
   */
  _indexPythonDependencies(requirementsPath) {
    const content = fs.readFileSync(requirementsPath, 'utf8');
    const lines = content.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const parts = trimmed.split(/[>=<~=!]/);
        if (parts.length > 0) {
          const name = parts[0].trim();
          this.dependencyIndex.set(name, {
            name,
            version: trimmed.substring(name.length).trim(),
            type: 'production',
            source: 'pip',
            isDevDependency: false
          });
        }
      }
    }
  }
  
  /**
   * Index Rust dependencies
   */
  _indexRustDependencies(cargoPath) {
    const content = fs.readFileSync(cargoPath, 'utf8');
    // Simple parsing - would need proper TOML parser in production
    const dependencyMatches = content.matchAll(/^\s*(\w+)\s*=\s*["']([^"']+)["']/gm);
    
    for (const match of dependencyMatches) {
      const name = match[1];
      const version = match[2];
      this.dependencyIndex.set(name, {
        name,
        version,
        type: 'production',
        source: 'cargo',
        isDevDependency: false
      });
    }
  }
  
  /**
   * Index tests
   */
  async _indexTests() {
    for (const [filePath, fileEntry] of this.fileIndex) {
      if (fileEntry.isTest) {
        // fileIndex keys are project-relative for portable retrieval. Filesystem
        // reads must use the canonical absolute path stored on the entry.
        const testFramework = this._detectTestFramework(fileEntry.absolutePath);
        const testNames = this._extractTestNames(fileEntry.absolutePath, fileEntry.language);
        const testedFiles = this._inferTestedFiles(filePath, fileEntry);
        
        this.testIndex.set(filePath, {
          testId: filePath,
          filePath,
          testFramework,
          testNames,
          testedFiles,
          testedSymbols: [],
          lastRun: null,
          lastStatus: 'unknown'
        });
      }
    }
  }
  
  /**
   * Detect test framework
   */
  _detectTestFramework(filePath) {
    const content = fs.readFileSync(filePath, 'utf8').toLowerCase();
    
    if (content.includes('describe(') || content.includes('it(')) {
      return 'jest';
    }
    if (content.includes('def test_')) {
      return 'pytest';
    }
    if (content.includes('#[test]')) {
      return 'rust';
    }
    if (content.includes('func Test')) {
      return 'go';
    }
    
    return 'unknown';
  }
  
  /**
   * Extract test names
   */
  _extractTestNames(filePath, language) {
    const content = fs.readFileSync(filePath, 'utf8');
    const testNames = [];
    
    if (language === 'javascript' || language === 'typescript') {
      const testMatches = content.matchAll(/(?:describe|it)\s*\(\s*['"]([^'"]+)['"]/g);
      for (const match of testMatches) {
        testNames.push(match[1]);
      }
    } else if (language === 'python') {
      const testMatches = content.matchAll(/def\s+(test_\w+)/g);
      for (const match of testMatches) {
        testNames.push(match[1]);
      }
    }
    
    return testNames;
  }
  
  /**
   * Infer tested files from test file path
   */
  _inferTestedFiles(testFilePath, fileEntry) {
    const testedFiles = [];
    const relativePath = fileEntry.filePath;
    
    // Common test file patterns
    if (relativePath.includes('.test.') || relativePath.includes('.spec.')) {
      const sourcePath = relativePath
        .replace('.test.', '.')
        .replace('.spec.', '.')
        .replace('__tests__', 'src');
      testedFiles.push(sourcePath);
    }
    
    if (relativePath.includes('__tests__')) {
      const sourcePath = relativePath.replace('__tests__', 'src');
      testedFiles.push(sourcePath);
    }
    
    return testedFiles;
  }
  
  /**
   * Walk directory recursively
   */
  _walkDirectory(dir, excludePatterns = EXCLUDE_PATTERNS) {
    const files = [];
    
    const items = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      
      // Skip excluded patterns
      if (this._shouldExclude(fullPath, excludePatterns)) {
        continue;
      }
      
      if (item.isDirectory()) {
        files.push(...this._walkDirectory(fullPath, excludePatterns));
      } else if (item.isFile()) {
        files.push(fullPath);
      }
    }
    
    return files;
  }
  
  /**
   * Check if path should be excluded
   */
  _shouldExclude(filePath, excludePatterns) {
    const relativePath = path.relative(this.projectPath, filePath);
    
    for (const pattern of excludePatterns) {
      if (pattern.includes('*')) {
        const regex = new RegExp(pattern.replace('*', '.*'));
        if (regex.test(relativePath) || regex.test(path.basename(filePath))) {
          return true;
        }
      } else if (relativePath.includes(pattern) || relativePath === pattern) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Detect language from file extension
   */
  _detectLanguage(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    
    for (const [language, extensions] of Object.entries(LANGUAGE_PATTERNS)) {
      if (extensions.includes(ext)) {
        return language;
      }
    }
    
    // Check for specific filenames
    const fileName = path.basename(filePath);
    if (fileName === 'Dockerfile') return 'dockerfile';
    if (fileName === 'Makefile') return 'makefile';
    
    return 'unknown';
  }
  
  /**
   * Detect file importance
   */
  _detectImportance(filePath) {
    const fileName = path.basename(filePath);
    
    for (const [importance, patterns] of Object.entries(IMPORTANCE_PATTERNS)) {
      for (const pattern of patterns) {
        if (fileName === pattern || filePath.includes(pattern)) {
          return importance;
        }
      }
    }
    
    return 'medium';
  }
  
  /**
   * Check if file is a test file
   */
  _isTestFile(filePath) {
    const fileName = path.basename(filePath);
    const relativePath = path.relative(this.projectPath, filePath);
    
    return fileName.includes('.test.') ||
           fileName.includes('.spec.') ||
           relativePath.includes('__tests__') ||
           relativePath.includes('test/') ||
           relativePath.includes('tests/');
  }
  
  /**
   * Check if file is a config file
   */
  _isConfigFile(filePath) {
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();
    
    return ['.json', '.yaml', '.yml', '.toml', '.xml', '.ini', '.conf'].includes(ext) ||
           fileName.includes('config') ||
           fileName.includes('settings');
  }
  
  /**
   * Check if file is generated
   */
  _isGeneratedFile(filePath) {
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();
    
    return fileName.includes('.min.') ||
           ext === '.map' ||
           ext === '.lock' ||
           filePath.includes('node_modules') ||
           filePath.includes('dist') ||
           filePath.includes('build');
  }
  
  /**
   * Check if file is a code file
   */
  _isCodeFile(filePath) {
    const language = this._detectLanguage(filePath);
    return !['unknown', 'markdown', 'json', 'yaml', 'xml'].includes(language);
  }
  
  /**
   * Count lines in file
   */
  _countLines(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return content.split('\n').length;
    } catch {
      return 0;
    }
  }
  
  /**
   * Search files by keyword
   */
  searchFiles(keyword) {
    const results = [];
    const lowerKeyword = keyword.toLowerCase();
    
    for (const [filePath, fileEntry] of this.fileIndex) {
      if (filePath.toLowerCase().includes(lowerKeyword) ||
          fileEntry.fileName.toLowerCase().includes(lowerKeyword)) {
        results.push(fileEntry);
      }
    }
    
    return results;
  }
  
  /**
   * Search symbols by name
   */
  searchSymbols(symbolName) {
    const results = [];
    const lowerSymbolName = symbolName.toLowerCase();
    
    for (const [symbolId, symbol] of this.symbolIndex) {
      if (symbol.name.toLowerCase().includes(lowerSymbolName)) {
        results.push(symbol);
      }
    }
    
    return results;
  }
  
  /**
   * Get files by importance
   */
  getFilesByImportance(importance) {
    const results = [];
    
    for (const [filePath, fileEntry] of this.fileIndex) {
      if (fileEntry.importance === importance) {
        results.push(fileEntry);
      }
    }
    
    return results;
  }
  
  /**
   * Get test files
   */
  getTestFiles() {
    const results = [];
    
    for (const [filePath, fileEntry] of this.fileIndex) {
      if (fileEntry.isTest) {
        results.push(fileEntry);
      }
    }
    
    return results;
  }
  
  /**
   * Get index statistics
   */
  getStats() {
    return {
      projectPath: this.projectPath,
      fileCount: this.fileIndex.size,
      symbolCount: this.symbolIndex.size,
      dependencyCount: this.dependencyIndex.size,
      testCount: this.testIndex.size,
      indexTimestamp: this.indexTimestamp,
      indexDirty: this.indexDirty,
      languages: this._getLanguageStats(),
      importance: this._getImportanceStats()
    };
  }
  
  /**
   * Get language statistics
   */
  _getLanguageStats() {
    const stats = {};
    
    for (const [filePath, fileEntry] of this.fileIndex) {
      const lang = fileEntry.language;
      stats[lang] = (stats[lang] || 0) + 1;
    }
    
    return stats;
  }
  
  /**
   * Get importance statistics
   */
  _getImportanceStats() {
    const stats = {};
    
    for (const [filePath, fileEntry] of this.fileIndex) {
      const importance = fileEntry.importance;
      stats[importance] = (stats[importance] || 0) + 1;
    }
    
    return stats;
  }
  
  /**
   * Save index to disk
   */
  saveIndex() {
    const indexData = {
      projectPath: this.projectPath,
      fileIndex: Array.from(this.fileIndex.entries()),
      symbolIndex: Array.from(this.symbolIndex.entries()),
      dependencyIndex: Array.from(this.dependencyIndex.entries()),
      testIndex: Array.from(this.testIndex.entries()),
      indexTimestamp: this.indexTimestamp
    };
    
    const cachePath = path.join(INDEX_CACHE_DIR, this._getCacheFileName());
    fs.writeFileSync(cachePath, JSON.stringify(indexData, null, 2));
  }
  
  /**
   * Load index from disk
   */
  loadIndex() {
    const cachePath = path.join(INDEX_CACHE_DIR, this._getCacheFileName());
    
    if (fs.existsSync(cachePath)) {
      try {
        const indexData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        
        this.fileIndex = new Map(indexData.fileIndex);
        this.symbolIndex = new Map(indexData.symbolIndex);
        this.dependencyIndex = new Map(indexData.dependencyIndex);
        this.testIndex = new Map(indexData.testIndex);
        this.indexTimestamp = indexData.indexTimestamp;
        this.indexDirty = false;
        
        return true;
      } catch (error) {
        console.error('Failed to load index:', error.message);
        return false;
      }
    }
    
    return false;
  }
  
  /**
   * Get cache file name
   */
  _getCacheFileName() {
    const hash = this._hashPath(this.projectPath);
    return `index_${hash}.json`;
  }
  
  /**
   * Hash path for cache file name
   */
  _hashPath(filePath) {
    // Simple hash for cache file name
    return filePath.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
  }
}

/**
 * Create codebase index for a project
 */
export function createCodebaseIndex(projectPath) {
  return new CodebaseIndex(projectPath);
}
