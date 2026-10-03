// Code Graph - Relationship tracking for codebase understanding
// METAIOID AGENT 1: ContextFabric + MetaCode Repository Intelligence
// Tracks imports, calls, implements, extends, uses, depends-on, tests, routes-to

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = process.env.METALOID_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const GRAPH_CACHE_DIR = path.join(DIR, 'code_graph');

// Ensure cache directory exists
try {
  fs.mkdirSync(GRAPH_CACHE_DIR, { recursive: true });
} catch { /* ignore */ }

/**
 * Relationship Types
 */
export const RelationshipTypes = {
  IMPORTS: 'IMPORTS',
  CALLS: 'CALLS',
  IMPLEMENTS: 'IMPLEMENTS',
  EXTENDS: 'EXTENDS',
  USES: 'USES',
  DEPENDS_ON: 'DEPENDS_ON',
  TESTS: 'TESTS',
  ROUTES_TO: 'ROUTES_TO'
};

/**
 * Code Graph - Main graph manager
 */
export class CodeGraph {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.nodes = new Map(); // filePath -> node data
    this.edges = new Map(); // edgeId -> edge data
    this.graphTimestamp = 0;
    this.graphDirty = true;
  }
  
  /**
   * Build complete code graph
   */
  async buildGraph(codebaseIndex) {
    console.log('Building code graph...');
    this.codebaseIndex = codebaseIndex;
    
    // Clear existing graph
    this.nodes.clear();
    this.edges.clear();
    
    // Build nodes from file index
    for (const [filePath, fileEntry] of codebaseIndex.fileIndex) {
      this.addNode(filePath, fileEntry);
    }
    
    // Build edges
    await this._buildImportEdges(codebaseIndex);
    await this._buildCallEdges(codebaseIndex);
    await this._buildTestEdges(codebaseIndex);
    
    this.graphTimestamp = Date.now();
    this.graphDirty = false;
    
    console.log('Code graph built successfully');
    return this.getStats();
  }
  
  /**
   * Add node to graph
   */
  addNode(filePath, metadata = {}) {
    this.nodes.set(filePath, {
      filePath,
      type: metadata.language || 'unknown',
      importance: metadata.importance || 'medium',
      isTest: metadata.isTest || false,
      isConfig: metadata.isConfig || false,
      symbols: metadata.symbols || [],
      dependencies: [],
      dependents: [],
      lastModified: metadata.lastModified || Date.now()
    });
  }
  
  /**
   * Add edge to graph
   */
  addEdge(from, to, relationshipType, metadata = {}) {
    const edgeId = `${from}:${to}:${relationshipType}`;
    
    this.edges.set(edgeId, {
      id: edgeId,
      from,
      to,
      relationshipType,
      weight: metadata.weight || 1,
      timestamp: Date.now(),
      ...metadata
    });
    
    // Update node dependencies/dependents
    const fromNode = this.nodes.get(from);
    const toNode = this.nodes.get(to);
    
    if (fromNode && !fromNode.dependencies.includes(to)) {
      fromNode.dependencies.push(to);
    }
    
    if (toNode && !toNode.dependents.includes(from)) {
      toNode.dependents.push(from);
    }
  }
  
  /**
   * Build import edges
   */
  async _buildImportEdges(codebaseIndex) {
    for (const [filePath, fileEntry] of this.codebaseIndex.fileIndex) {
      if (fileEntry.language === 'javascript' || fileEntry.language === 'typescript') {
        await this._buildJSImportEdges(filePath, fileEntry);
      } else if (fileEntry.language === 'python') {
        await this._buildPythonImportEdges(filePath, fileEntry);
      }
    }
  }
  
  /**
   * Build JavaScript/TypeScript import edges
   */
  async _buildJSImportEdges(filePath, fileEntry) {
    try {
      const content = fs.readFileSync(fileEntry.absolutePath || path.join(this.projectPath, filePath), 'utf8');
      const lines = content.split('\n');
      
      for (const line of lines) {
        // ES6 imports
        const es6ImportMatch = line.match(/import\s+(?:.*\s+from\s+)?['"]([^'"]+)['"]/);
        if (es6ImportMatch) {
          const importPath = es6ImportMatch[1];
          const resolvedPath = this._resolveImportPath(fileEntry.absolutePath || path.join(this.projectPath, filePath), importPath);
          if (resolvedPath && this.nodes.has(resolvedPath)) {
            this.addEdge(filePath, resolvedPath, RelationshipTypes.IMPORTS);
          }
        }
        
        // CommonJS requires
        const requireMatch = line.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
        if (requireMatch) {
          const requirePath = requireMatch[1];
          const resolvedPath = this._resolveImportPath(fileEntry.absolutePath || path.join(this.projectPath, filePath), requirePath);
          if (resolvedPath && this.nodes.has(resolvedPath)) {
            this.addEdge(filePath, resolvedPath, RelationshipTypes.IMPORTS);
          }
        }
      }
    } catch (error) {
      console.error(`Failed to build import edges for ${filePath}:`, error.message);
    }
  }
  
  /**
   * Build Python import edges
   */
  async _buildPythonImportEdges(filePath, fileEntry) {
    try {
      const content = fs.readFileSync(fileEntry.absolutePath || path.join(this.projectPath, filePath), 'utf8');
      const lines = content.split('\n');
      
      for (const line of lines) {
        // Python imports
        const importMatch = line.match(/^(?:from\s+(\S+)\s+)?import\s+(\S+)/);
        if (importMatch) {
          const modulePath = importMatch[1] || importMatch[2];
          const resolvedPath = this._resolvePythonImportPath(fileEntry.absolutePath || path.join(this.projectPath, filePath), modulePath);
          if (resolvedPath && this.nodes.has(resolvedPath)) {
            this.addEdge(filePath, resolvedPath, RelationshipTypes.IMPORTS);
          }
        }
      }
    } catch (error) {
      console.error(`Failed to build import edges for ${filePath}:`, error.message);
    }
  }
  
  /**
   * Build call edges
   */
  async _buildCallEdges(codebaseIndex) {
    for (const [filePath, fileEntry] of codebaseIndex.fileIndex) {
      if (fileEntry.language === 'javascript' || fileEntry.language === 'typescript') {
        await this._buildJSCallEdges(filePath, fileEntry);
      } else if (fileEntry.language === 'python') {
        await this._buildPythonCallEdges(filePath, fileEntry);
      }
    }
  }
  
  /**
   * Build JavaScript/TypeScript call edges
   */
  async _buildJSCallEdges(filePath, fileEntry) {
    try {
      const content = fs.readFileSync(fileEntry.absolutePath || path.join(this.projectPath, filePath), 'utf8');
      const lines = content.split('\n');
      
      for (const line of lines) {
        // Function calls
        const callMatches = line.matchAll(/(\w+)\s*\(/g);
        for (const match of callMatches) {
          const functionName = match[1];
          // Find where this function is defined
          const targetFiles = this._findSymbolDefinition(functionName, this.codebaseIndex);
          for (const targetFile of targetFiles) {
            if (targetFile !== filePath) {
              this.addEdge(filePath, targetFile, RelationshipTypes.CALLS, {
                symbol: functionName
              });
            }
          }
        }
      }
    } catch (error) {
      console.error(`Failed to build call edges for ${filePath}:`, error.message);
    }
  }
  
  /**
   * Build Python call edges
   */
  async _buildPythonCallEdges(filePath, fileEntry) {
    try {
      const content = fs.readFileSync(fileEntry.absolutePath || path.join(this.projectPath, filePath), 'utf8');
      const lines = content.split('\n');
      
      for (const line of lines) {
        // Function calls
        const callMatches = line.matchAll(/(\w+)\s*\(/g);
        for (const match of callMatches) {
          const functionName = match[1];
          const targetFiles = this._findSymbolDefinition(functionName, this.codebaseIndex);
          for (const targetFile of targetFiles) {
            if (targetFile !== filePath) {
              this.addEdge(filePath, targetFile, RelationshipTypes.CALLS, {
                symbol: functionName
              });
            }
          }
        }
      }
    } catch (error) {
      console.error(`Failed to build call edges for ${filePath}:`, error.message);
    }
  }
  
  /**
   * Build test edges
   */
  async _buildTestEdges(codebaseIndex) {
    for (const [testId, testEntry] of codebaseIndex.testIndex) {
      for (const testedFile of testEntry.testedFiles) {
        if (this.nodes.has(testedFile)) {
          this.addEdge(testId, testedFile, RelationshipTypes.TESTS);
        }
      }
    }
  }
  
  /**
   * Resolve import path to file path
   */
  _resolveImportPath(currentFile, importPath) {
    // Handle relative imports
    if (importPath.startsWith('.')) {
      const currentDir = path.dirname(currentFile);
      const resolvedPath = path.resolve(currentDir, importPath);
      
      // Try common extensions
      const extensions = ['.js', '.jsx', '.ts', '.tsx', '.json'];
      for (const ext of extensions) {
        const withExt = resolvedPath + ext;
        const withIndex = path.join(resolvedPath, 'index' + ext);
        
        if (this.nodes.has(path.relative(this.projectPath, withExt))) {
          return path.relative(this.projectPath, withExt);
        }
        if (this.nodes.has(path.relative(this.projectPath, withIndex))) {
          return path.relative(this.projectPath, withIndex);
        }
      }
      
      return path.relative(this.projectPath, resolvedPath);
    }
    
    // Handle node_modules imports (skip for now)
    if (importPath.startsWith('@') || !importPath.startsWith('.')) {
      return null;
    }
    
    return null;
  }
  
  /**
   * Resolve Python import path
   */
  _resolvePythonImportPath(currentFile, importPath) {
    // Handle relative imports
    if (importPath.startsWith('.')) {
      const currentDir = path.dirname(currentFile);
      const resolvedPath = path.resolve(currentDir, importPath.replace(/\./g, path.sep));
      
      const withPy = resolvedPath + '.py';
      if (this.nodes.has(path.relative(this.projectPath, withPy))) {
        return path.relative(this.projectPath, withPy);
      }
      
      return path.relative(this.projectPath, resolvedPath);
    }
    
    return null;
  }
  
  /**
   * Find symbol definition
   */
  _findSymbolDefinition(symbolName, codebaseIndex) {
    const targetFiles = [];
    
    for (const [symbolId, symbol] of codebaseIndex.symbolIndex) {
      if (symbol.name === symbolName && symbol.isExported) {
        targetFiles.push(symbol.filePath);
      }
    }
    
    return targetFiles;
  }
  
  /**
   * Query: Which files affect this file?
   */
  getDependents(filePath) {
    const node = this.nodes.get(filePath);
    if (!node) return [];
    
    return node.dependents.map(depPath => this.nodes.get(depPath)).filter(Boolean);
  }
  
  /**
   * Query: What does this file depend on?
   */
  getDependencies(filePath) {
    const node = this.nodes.get(filePath);
    if (!node) return [];
    
    return node.dependencies.map(depPath => this.nodes.get(depPath)).filter(Boolean);
  }
  
  /**
   * Query: What tests cover this file?
   */
  getTestsForFile(filePath) {
    const tests = [];
    
    for (const [edgeId, edge] of this.edges) {
      if (edge.relationshipType === RelationshipTypes.TESTS && edge.to === filePath) {
        tests.push(edge.from);
      }
    }
    
    return tests;
  }
  
  /**
   * Query: What files are affected by this file?
   */
  getAffectedFiles(filePath, maxDepth = 3) {
    const affected = new Set();
    const queue = [{ path: filePath, depth: 0 }];
    
    while (queue.length > 0) {
      const { path: currentPath, depth } = queue.shift();
      
      if (depth >= maxDepth) continue;
      
      const dependents = this.getDependents(currentPath);
      for (const dependent of dependents) {
        if (!affected.has(dependent.filePath)) {
          affected.add(dependent.filePath);
          queue.push({ path: dependent.filePath, depth: depth + 1 });
        }
      }
    }
    
    return Array.from(affected);
  }
  
  /**
   * Query: What is the call chain for this function?
   */
  getCallChain(filePath, symbolName, maxDepth = 5) {
    const chain = [];
    const visited = new Set();
    const queue = [{ path: filePath, symbol: symbolName, depth: 0 }];
    
    while (queue.length > 0) {
      const { path: currentPath, symbol: currentSymbol, depth } = queue.shift();
      
      if (depth >= maxDepth || visited.has(`${currentPath}:${currentSymbol}`)) continue;
      
      visited.add(`${currentPath}:${currentSymbol}`);
      chain.push({ path: currentPath, symbol: currentSymbol, depth });
      
      // Find calls made by this symbol
      for (const [edgeId, edge] of this.edges) {
        if (edge.from === currentPath && edge.relationshipType === RelationshipTypes.CALLS) {
          const targetNode = this.nodes.get(edge.to);
          if (targetNode) {
            queue.push({ path: edge.to, symbol: edge.metadata?.symbol, depth: depth + 1 });
          }
        }
      }
    }
    
    return chain;
  }
  
  /**
   * Query: Find files by relationship type
   */
  getFilesByRelationship(relationshipType) {
    const files = new Set();
    
    for (const [edgeId, edge] of this.edges) {
      if (edge.relationshipType === relationshipType) {
        files.add(edge.from);
        files.add(edge.to);
      }
    }
    
    return Array.from(files).map(filePath => this.nodes.get(filePath)).filter(Boolean);
  }
  
  /**
   * Get graph statistics
   */
  getStats() {
    const relationshipCounts = {};
    
    for (const [edgeId, edge] of this.edges) {
      relationshipCounts[edge.relationshipType] = (relationshipCounts[edge.relationshipType] || 0) + 1;
    }
    
    return {
      projectPath: this.projectPath,
      nodeCount: this.nodes.size,
      edgeCount: this.edges.size,
      relationshipCounts,
      graphTimestamp: this.graphTimestamp,
      graphDirty: this.graphDirty
    };
  }
  
  /**
   * Save graph to disk
   */
  saveGraph() {
    const graphData = {
      projectPath: this.projectPath,
      nodes: Array.from(this.nodes.entries()),
      edges: Array.from(this.edges.entries()),
      graphTimestamp: this.graphTimestamp
    };
    
    const cachePath = path.join(GRAPH_CACHE_DIR, this._getCacheFileName());
    fs.writeFileSync(cachePath, JSON.stringify(graphData, null, 2));
  }
  
  /**
   * Load graph from disk
   */
  loadGraph() {
    const cachePath = path.join(GRAPH_CACHE_DIR, this._getCacheFileName());
    
    if (fs.existsSync(cachePath)) {
      try {
        const graphData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        
        this.nodes = new Map(graphData.nodes);
        this.edges = new Map(graphData.edges);
        this.graphTimestamp = graphData.graphTimestamp;
        this.graphDirty = false;
        
        return true;
      } catch (error) {
        console.error('Failed to load graph:', error.message);
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
    return `graph_${hash}.json`;
  }
  
  /**
   * Hash path for cache file name
   */
  _hashPath(filePath) {
    return filePath.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
  }
}

/**
 * Create code graph for a project
 */
export function createCodeGraph(projectPath) {
  return new CodeGraph(projectPath);
}
