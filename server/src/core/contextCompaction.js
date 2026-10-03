// Context Compaction - Intelligent context compression
// METAIOID AGENT 1: ContextFabric + MetaCode Repository Intelligence
// Compresses large context while preserving important information

/**
 * Context Compactor - Context compression engine
 */
export class ContextCompactor {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 10000; // Max characters per item
    this.preservePatterns = options.preservePatterns || [];
  }
  
  /**
   * Compact context items
   */
  compactContext(context) {
    const compacted = {
      items: [],
      totalTokens: 0,
      tierBreakdown: context.tierBreakdown,
      compactionRatio: 0
    };
    
    for (const item of context.items) {
      const compactedItem = this.compactItem(item);
      compacted.items.push(compactedItem);
      compacted.totalTokens += compactedItem.tokenEstimate;
    }
    
    // Calculate compaction ratio
    const originalTotal = context.items.reduce((sum, item) => sum + item.tokenEstimate, 0);
    compacted.compactionRatio = originalTotal > 0 ? compacted.totalTokens / originalTotal : 1;
    
    return compacted;
  }
  
  /**
   * Compact a single context item
   */
  compactItem(item) {
    const content = item.content || '';
    const originalLength = content.length;
    
    if (originalLength <= this.maxSize) {
      return item;
    }
    
    // Determine compaction strategy based on item type
    let compactedContent;
    
    if (item.metadata?.source === 'file') {
      compactedContent = this.compactFileContent(content, item.metadata?.filePath);
    } else if (item.metadata?.source === 'test') {
      compactedContent = this.compactTestContent(content);
    } else if (item.metadata?.source === 'error') {
      compactedContent = this.compactErrorContent(content);
    } else if (item.metadata?.source === 'plan') {
      compactedContent = this.compactPlanContent(content);
    } else {
      compactedContent = this.compactGenericContent(content);
    }
    
    return {
      ...item,
      content: compactedContent,
      originalLength,
      compactedLength: compactedContent.length,
      tokenEstimate: Math.ceil(compactedContent.length / 4),
      compacted: true
    };
  }
  
  /**
   * Compact file content
   */
  compactFileContent(content, filePath) {
    const ext = filePath ? filePath.split('.').pop().toLowerCase() : '';
    
    // For code files, extract key functions/signatures
    if (['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'go', 'rs'].includes(ext)) {
      return this.extractCodeSignatures(content);
    }
    
    // For config files, keep structure
    if (['json', 'yaml', 'yml', 'toml', 'xml'].includes(ext)) {
      return this.compactConfigContent(content);
    }
    
    // For markdown, extract headers and key sections
    if (['md', 'markdown'].includes(ext)) {
      return this.extractMarkdownStructure(content);
    }
    
    // Generic compaction
    return this.compactGenericContent(content);
  }
  
  /**
   * Extract code signatures
   */
  extractCodeSignatures(content) {
    const lines = content.split('\n');
    const signatures = [];
    
    for (const line of lines) {
      // Function/class declarations
      if (line.match(/^(function|class|def|export|const|let|var)/)) {
        signatures.push(line);
      }
      // Import statements
      if (line.match(/^(import|require|from)/)) {
        signatures.push(line);
      }
      // Export statements
      if (line.match(/^export/)) {
        signatures.push(line);
      }
    }
    
    // If too few signatures, take first 100 lines
    if (signatures.length < 10) {
      return lines.slice(0, 100).join('\n');
    }
    
    return signatures.join('\n');
  }
  
  /**
   * Compact config content
   */
  compactConfigContent(content) {
    try {
      const parsed = JSON.parse(content);
      // Keep structure but remove long arrays/objects
      return JSON.stringify(parsed, null, 2);
    } catch {
      // Not valid JSON, take first 100 lines
      return content.split('\n').slice(0, 100).join('\n');
    }
  }
  
  /**
   * Extract markdown structure
   */
  extractMarkdownStructure(content) {
    const lines = content.split('\n');
    const structure = [];
    
    for (const line of lines) {
      // Headers
      if (line.match(/^#{1,6}\s/)) {
        structure.push(line);
      }
      // Code blocks
      if (line.match(/^```/)) {
        structure.push(line);
      }
      // Lists
      if (line.match(/^[\s]*[-*+]\s/)) {
        structure.push(line);
      }
    }
    
    // If too little structure, take first 100 lines
    if (structure.length < 10) {
      return lines.slice(0, 100).join('\n');
    }
    
    return structure.join('\n');
  }
  
  /**
   * Compact test content
   */
  compactTestContent(content) {
    const lines = content.split('\n');
    const compacted = [];
    
    for (const line of lines) {
      // Test definitions
      if (line.match(/^(describe|it|test|def test)/)) {
        compacted.push(line);
      }
      // Assert statements
      if (line.match(/assert|expect/)) {
        compacted.push(line);
      }
    }
    
    // If too few test lines, take first 50 lines
    if (compacted.length < 5) {
      return lines.slice(0, 50).join('\n');
    }
    
    return compacted.join('\n');
  }
  
  /**
   * Compact error content
   */
  compactErrorContent(content) {
    // Keep error message and stack trace, truncate if too long
    const lines = content.split('\n');
    
    // Keep first 20 lines (usually enough for error details)
    if (lines.length > 20) {
      return lines.slice(0, 20).join('\n') + '\n... (truncated)';
    }
    
    return content;
  }
  
  /**
   * Compact plan content
   */
  compactPlanContent(content) {
    // Plans are usually concise, just truncate if too long
    if (content.length > this.maxSize) {
      return content.substring(0, this.maxSize) + '... (truncated)';
    }
    
    return content;
  }
  
  /**
   * Generic content compaction
   */
  compactGenericContent(content) {
    if (content.length <= this.maxSize) {
      return content;
    }
    
    // Take first and last parts with ellipsis
    const firstPart = content.substring(0, this.maxSize / 2);
    const lastPart = content.substring(content.length - this.maxSize / 2);
    
    return firstPart + '\n... (truncated)\n' + lastPart;
  }
  
  /**
   * Summarize multiple errors
   */
  summarizeErrors(errors) {
    if (!Array.isArray(errors) || errors.length === 0) {
      return '';
    }
    
    if (errors.length === 1) {
      return errors[0];
    }
    
    const summary = `Multiple errors (${errors.length}):\n`;
    const errorDetails = errors.map((error, i) => 
      `${i + 1}. ${error.substring(0, 100)}${error.length > 100 ? '...' : ''}`
    ).join('\n');
    
    return summary + errorDetails;
  }
  
  /**
   * Summarize test results
   */
  summarizeTestResults(testResults) {
    if (!testResults) {
      return '';
    }
    
    const passed = testResults.passed || 0;
    const failed = testResults.failed || 0;
    const skipped = testResults.skipped || 0;
    const total = passed + failed + skipped;
    
    return `Test Results: ${passed}/${total} passed, ${failed} failed, ${skipped} skipped`;
  }
  
  /**
   * Remove duplicate context
   */
  removeDuplicates(items) {
    const seen = new Set();
    const unique = [];
    
    for (const item of items) {
      const key = `${item.tier}:${item.filePath || item.type}:${item.content?.substring(0, 100)}`;
      
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(item);
      }
    }
    
    return unique;
  }
  
  /**
   * Remove obsolete intermediate output
   */
  removeObsoleteOutput(items) {
    return items.filter(item => {
      // Remove items that are clearly intermediate/debug output
      const content = item.content || '';
      const source = item.metadata?.source || '';
      
      // Remove debug logs
      if (source === 'debug' || source === 'log') {
        return false;
      }
      
      // Remove intermediate tool results that are superseded
      if (source === 'tool_result' && item.metadata?.superseded) {
        return false;
      }
      
      return true;
    });
  }
  
  /**
   * Preserve critical information
   */
  preserveCriticalInfo(items) {
    const criticalItems = [];
    const otherItems = [];
    
    for (const item of items) {
      const importance = item.metadata?.importance || 'medium';
      const source = item.metadata?.source || '';
      
      // Always preserve critical items
      if (importance === 'critical' || 
          source === 'error' || 
          source === 'plan' ||
          source === 'current_file') {
        criticalItems.push(item);
      } else {
        otherItems.push(item);
      }
    }
    
    return [...criticalItems, ...otherItems];
  }
}

/**
 * Create context compactor
 */
export function createContextCompactor(options = {}) {
  return new ContextCompactor(options);
}
