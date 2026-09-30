// Semantic Search - Provider-agnostic semantic retrieval using embeddings
// METAIOID AGENT 1: ContextFabric Hardening & Real Integration
// Uses ProviderRegistry for embedding models, graceful fallback to keyword search

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = process.env.METALOID_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const EMBEDDING_CACHE_DIR = path.join(DIR, 'embedding_cache');

// Ensure cache directory exists
try {
  fs.mkdirSync(EMBEDDING_CACHE_DIR, { recursive: true });
} catch { /* ignore */ }

/**
 * Semantic Search Engine
 */
export class SemanticSearchEngine {
  constructor(options = {}) {
    this.providerRegistry = options.providerRegistry || null;
    this.userId = options.userId || null;
    this.chunkSize = options.chunkSize || 500; // characters per chunk
    this.chunkOverlap = options.chunkOverlap || 50; // characters overlap
    this.embeddingCache = new Map();
    this.cacheTTL = options.cacheTTL || 86400000; // 24 hours
    this.embeddingProvider = null;
  }
  
  /**
   * Initialize embedding provider
   */
  async initialize() {
    if (!this.providerRegistry) {
      console.log('No provider registry available, semantic search disabled');
      return false;
    }
    
    try {
      // Try to resolve an embedding provider
      const { resolveProvider } = await import('./providerRouter.js');
      const provider = await resolveProvider({
        capability: 'EMBEDDING',
        userId: this.userId
      });
      
      if (provider) {
        this.embeddingProvider = provider;
        console.log('Semantic search initialized with provider:', provider.providerId);
        return true;
      }
    } catch (error) {
      console.log('Failed to initialize embedding provider:', error.message);
    }
    
    console.log('No embedding provider available, will use keyword fallback');
    return false;
  }
  
  /**
   * Search semantically
   */
  async search(query, codebaseIndex, options = {}) {
    const {
      maxResults = 10,
      minSimilarity = 0.5,
      useCache = true
    } = options;
    
    // If no embedding provider, fall back to keyword search
    if (!this.embeddingProvider) {
      console.log('No embedding provider, using keyword fallback');
      return this._keywordFallback(query, codebaseIndex, maxResults);
    }
    
    try {
      // 1. Generate embedding for query
      const queryEmbedding = await this._getEmbedding(query);
      
      // 2. Retrieve cached document embeddings
      const documentEmbeddings = await this._getDocumentEmbeddings(codebaseIndex, useCache);
      
      // 3. Calculate similarities
      const similarities = this._calculateSimilarities(queryEmbedding, documentEmbeddings);
      
      // 4. Filter and rank
      const filtered = similarities
        .filter(s => s.similarity >= minSimilarity)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, maxResults);
      
      // 5. Load file contents for results
      const results = await this._loadFileContents(filtered, codebaseIndex);
      
      return results;
    } catch (error) {
      console.error('Semantic search failed, falling back to keyword:', error.message);
      return this._keywordFallback(query, codebaseIndex, maxResults);
    }
  }
  
  /**
   * Get embedding for text
   */
  async _getEmbedding(text) {
    const cacheKey = this._hashText(text);
    
    // Check cache
    if (this.embeddingCache.has(cacheKey)) {
      const cached = this.embeddingCache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTTL) {
        return cached.embedding;
      }
    }
    
    // Generate embedding using provider
    try {
      const { executeProvider } = await import('./providerRouter.js');
      const result = await executeProvider({
        providerId: this.embeddingProvider.providerId,
        capability: 'EMBEDDING',
        input: { text }
      });
      
      if (result.ok && result.data?.embedding) {
        const embedding = result.data.embedding;
        
        // Cache embedding
        this.embeddingCache.set(cacheKey, {
          embedding,
          timestamp: Date.now()
        });
        
        return embedding;
      }
    } catch (error) {
      console.error('Failed to generate embedding:', error.message);
    }
    
    throw new Error('Failed to generate embedding');
  }
  
  /**
   * Get document embeddings for codebase
   */
  async _getDocumentEmbeddings(codebaseIndex, useCache = true) {
    const embeddings = [];
    const cacheFile = path.join(EMBEDDING_CACHE_DIR, this._getCacheFileName(codebaseIndex.projectPath));
    
    // Try to load from cache
    if (useCache && fs.existsSync(cacheFile)) {
      try {
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        const cacheAge = Date.now() - cached.timestamp;
        
        // Cache is valid for 24 hours
        if (cacheAge < this.cacheTTL) {
          console.log('Using cached document embeddings');
          return cached.embeddings;
        }
      } catch (error) {
        console.error('Failed to load embedding cache:', error.message);
      }
    }
    
    // Generate embeddings for indexed files
    console.log('Generating document embeddings...');
    
    for (const [filePath, fileEntry] of codebaseIndex.fileIndex) {
      // Skip large files and non-code files
      if (fileEntry.size > 100000 || fileEntry.isGenerated) {
        continue;
      }
      
      try {
        const content = fs.readFileSync(fileEntry.absolutePath, 'utf8');
        const chunks = this._chunkText(content);
        
        for (const chunk of chunks) {
          try {
            const embedding = await this._getEmbedding(chunk);
            embeddings.push({
              filePath,
              chunk,
              embedding,
              offset: chunk.offset
            });
          } catch (error) {
            // Skip chunk if embedding fails
            continue;
          }
        }
      } catch (error) {
        // Skip file if reading fails
        continue;
      }
    }
    
    // Save to cache
    if (useCache) {
      try {
        fs.writeFileSync(cacheFile, JSON.stringify({
          embeddings,
          timestamp: Date.now()
        }));
      } catch (error) {
        console.error('Failed to save embedding cache:', error.message);
      }
    }
    
    return embeddings;
  }
  
  /**
   * Calculate cosine similarity between query and documents
   */
  _calculateSimilarities(queryEmbedding, documentEmbeddings) {
    const similarities = [];
    
    for (const doc of documentEmbeddings) {
      const similarity = this._cosineSimilarity(queryEmbedding, doc.embedding);
      similarities.push({
        filePath: doc.filePath,
        chunk: doc.chunk,
        similarity,
        offset: doc.offset
      });
    }
    
    return similarities;
  }
  
  /**
   * Calculate cosine similarity
   */
  _cosineSimilarity(a, b) {
    if (a.length !== b.length) {
      throw new Error('Embedding dimensions must match');
    }
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;
    
    return dotProduct / denominator;
  }
  
  /**
   * Chunk text into smaller pieces
   */
  _chunkText(text) {
    const chunks = [];
    let offset = 0;
    
    while (offset < text.length) {
      const end = Math.min(offset + this.chunkSize, text.length);
      const chunk = text.substring(offset, end);
      
      chunks.push({
        text: chunk,
        offset
      });
      
      offset += this.chunkSize - this.chunkOverlap;
    }
    
    return chunks;
  }
  
  /**
   * Load file contents for results
   */
  async _loadFileContents(similarities, codebaseIndex) {
    const results = [];
    const seenFiles = new Set();
    
    for (const sim of similarities) {
      if (seenFiles.has(sim.filePath)) continue;
      seenFiles.add(sim.filePath);
      
      const fileEntry = codebaseIndex.fileIndex.get(sim.filePath);
      if (fileEntry) {
        try {
          const content = fs.readFileSync(fileEntry.absolutePath, 'utf8');
          results.push({
            type: 'file',
            filePath: sim.filePath,
            content,
            similarity: sim.similarity,
            strategy: 'semantic'
          });
        } catch (error) {
          // Skip file if reading fails
        }
      }
    }
    
    return results;
  }
  
  /**
   * Keyword fallback when semantic search is unavailable
   */
  _keywordFallback(query, codebaseIndex, maxResults) {
    const keywords = this._extractKeywords(query);
    const results = [];
    const seenFiles = new Set();
    
    for (const keyword of keywords) {
      const files = codebaseIndex.searchFiles(keyword);
      for (const file of files) {
        if (seenFiles.has(file.filePath)) continue;
        seenFiles.add(file.filePath);
        
        try {
          const content = fs.readFileSync(file.absolutePath, 'utf8');
          results.push({
            type: 'file',
            filePath: file.filePath,
            content,
            similarity: this._calculateKeywordScore(keyword, file),
            strategy: 'keyword'
          });
        } catch (error) {
          // Skip file if reading fails
        }
      }
    }
    
    // Sort by keyword score and limit results
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, maxResults);
  }
  
  /**
   * Extract keywords from query
   */
  _extractKeywords(query) {
    const words = query.toLowerCase().split(/[\s,.;:!?(){}\[\]<>"'`\/\\|]+/);
    const stopWords = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been', 'will', 'with', 'this', 'that', 'from', 'they', 'would', 'there', 'their', 'what', 'about', 'which', 'when', 'make', 'like', 'into', 'just', 'over', 'such', 'your', 'does', 'more', 'also', 'than', 'some', 'only', 'could', 'after', 'very', 'other', 'should', 'into']);
    
    return words
      .filter(word => word.length > 2)
      .filter(word => !stopWords.has(word));
  }
  
  /**
   * Calculate keyword score
   */
  _calculateKeywordScore(keyword, file) {
    let score = 0.5;
    
    if (file.fileName.toLowerCase() === keyword.toLowerCase()) {
      score += 0.3;
    }
    
    if (file.importance === 'critical') {
      score += 0.2;
    } else if (file.importance === 'high') {
      score += 0.1;
    }
    
    return Math.min(1.0, score);
  }
  
  /**
   * Hash text for cache key
   */
  _hashText(text) {
    // Simple hash for cache key
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
  }
  
  /**
   * Get cache file name
   */
  _getCacheFileName(projectPath) {
    const hash = projectPath.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
    return `embeddings_${hash}.json`;
  }
  
  /**
   * Clear cache
   */
  clearCache() {
    this.embeddingCache.clear();
    
    // Clear disk cache
    try {
      const files = fs.readdirSync(EMBEDDING_CACHE_DIR);
      for (const file of files) {
        if (file.startsWith('embeddings_')) {
          fs.unlinkSync(path.join(EMBEDDING_CACHE_DIR, file));
        }
      }
    } catch (error) {
      console.error('Failed to clear embedding cache:', error.message);
    }
  }
  
  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      memoryCacheSize: this.embeddingCache.size,
      cacheTTL: this.cacheTTL,
      embeddingProvider: this.embeddingProvider?.providerId || null
    };
  }
}

/**
 * Create semantic search engine
 */
export function createSemanticSearchEngine(options = {}) {
  return new SemanticSearchEngine(options);
}
