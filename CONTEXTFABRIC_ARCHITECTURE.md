# METAIOID CONTEXTFABRIC ARCHITECTURE

## Canonical Context Orchestration Layer

**Purpose:** Enable MetaIoid to work with large codebases intelligently by retrieving, ranking, and assembling relevant context rather than dumping entire repositories.

**Core Philosophy:** The model's context window may be 128K/256K/400K/1M+ tokens, but project knowledge can be much larger. ContextFabric makes the project feel larger through intelligent retrieval.

## Architecture Overview

```
User Request
↓
Task Analysis
↓
ContextFabric
├── Context Budget Calculator
├── Retrieval Engine
│   ├── Keyword Search
│   ├── Semantic Search
│   ├── Symbol Search
│   ├── Dependency Search
│   ├── Git History
│   └── Test Relationship
├── Context Scoring
│   ├── Task Relevance
│   ├── Project Relevance
│   ├── Dependency Importance
│   ├── Recency
│   ├── Confidence
│   ├── User Priority
│   └── Verification Value
├── Context Assembler
│   ├── LIVE Context
│   ├── ACTIVE_TASK Context
│   ├── PROJECT Context
│   ├── LONG_TERM Context
│   └── ARCHIVE Context
├── Context Compaction
└── Cache Manager
↓
Assembled Context
↓
Model Execution
↓
Verification
```

## Context Tiers

### 1. LIVE Context
**Definition:** Current interaction state
**Contents:**
- Current prompt
- Current tool result
- Current file being edited
- Current error/message
- Active cursor position
**Priority:** Highest (always included)
**Budget:** ~10% of context window

### 2. ACTIVE_TASK Context
**Definition:** Current task state
**Contents:**
- Current plan
- Recent edits (last 5-10 files)
- Related tests
- Current failures/errors
- In-progress changes
- Unfinished work
**Priority:** High (task-specific)
**Budget:** ~20% of context window

### 3. PROJECT Context
**Definition:** Project architecture and important code
**Contents:**
- Architecture summary
- Key files (entry points, main components)
- Dependencies
- Configuration files
- Important decisions
- Project conventions
**Priority:** Medium (relevance-based)
**Budget:** ~40% of context window

### 4. LONG_TERM Context
**Definition:** Historical project knowledge
**Contents:**
- Historical decisions
- Important fixes
- Milestones
- Architecture evolution
- Known issues
**Priority:** Low (retrieval-based)
**Budget:** ~20% of context window

### 5. ARCHIVE Context
**Definition:** Searchable but not auto-injected
**Contents:**
- All project files (indexed)
- Historical code
- Deprecated code
- Documentation
**Priority:** Very Low (on-demand only)
**Budget:** ~10% of context window (retrieved on demand)

## Codebase Index

### File Index
**Purpose:** Track all project files with metadata
**Structure:**
```javascript
{
  filePath: string,
  fileName: string,
  extension: string,
  language: string,
  size: number,
  lastModified: number,
  lines: number,
  directory: string,
  isTest: boolean,
  isConfig: boolean,
  isGenerated: boolean,
  importance: 'critical' | 'high' | 'medium' | 'low'
}
```

### Symbol Index
**Purpose:** Track all code symbols (functions, classes, types, etc.)
**Structure:**
```javascript
{
  symbolId: string,
  name: string,
  type: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'constant',
  filePath: string,
  line: number,
  column: number,
  signature: string,
  isExported: boolean,
  isAsync: boolean,
  parameters: string[],
  returnType: string,
  docstring?: string
}
```

### Dependency Index
**Purpose:** Track all project dependencies
**Structure:**
```javascript
{
  name: string,
  version: string,
  type: 'production' | 'development' | 'peer',
  source: 'npm' | 'yarn' | 'pip' | 'cargo' | 'go' | 'maven',
  filePath: string,
  isDevDependency: boolean
}
```

### Test Index
**Purpose:** Track all test files and their relationships
**Structure:**
```javascript
{
  testId: string,
  filePath: string,
  testFramework: string,
  testNames: string[],
  testedFiles: string[],
  testedSymbols: string[],
  lastRun: number,
  lastStatus: 'pass' | 'fail' | 'skip'
}
```

## Code Graph

### Relationship Types
- **IMPORTS:** File A imports from File B
- **CALLS:** Function A calls Function B
- **IMPLEMENTS:** Class A implements Interface B
- **EXTENDS:** Class A extends Class B
- **USES:** Component A uses Component B
- **DEPENDS_ON:** Module A depends on Module B
- **TESTS:** Test A tests Code B
- **ROUTES_TO:** Route A maps to Handler B

### Graph Queries
- "Which files affect authentication?"
- "What tests cover this function?"
- "What depends on this component?"
- "What would break if I change this file?"
- "What is the call chain for this function?"

## Retrieval System

### Retrieval Strategies

#### 1. Keyword Search
**Method:** Exact and fuzzy string matching
**Use Case:** Finding specific function names, variable names, API endpoints
**Signals:** Name match, comment match, string literal match

#### 2. Semantic Search
**Method:** Embedding-based similarity
**Use Case:** Finding conceptually related code
**Signals:** Embedding similarity, semantic distance
**Note:** Not the only signal - combine with other strategies

#### 3. Symbol Search
**Method:** Symbol index lookup
**Use Case:** Finding function/class definitions and usages
**Signals:** Symbol type, export status, file importance

#### 4. Dependency Search
**Method:** Dependency graph traversal
**Use Case:** Finding related code through dependencies
**Signals:** Dependency depth, import frequency

#### 5. Git History
**Method:** Git commit analysis
**Use Case:** Finding recent changes, related commits
**Signals:** Commit recency, file change frequency, author

#### 6. Test Relationship
**Method:** Test-to-code mapping
**Use Case:** Finding tests for specific code
**Signals:** Test coverage, test status, test framework

### Retrieval Combination
Never depend exclusively on one strategy. Combine signals:
- 40% semantic similarity
- 30% symbol/graph relevance
- 20% keyword match
- 10% recency/frequency

## Context Scoring

### Scoring Factors

#### 1. Task Relevance (Weight: 0.35)
- Direct mention in task description
- Conceptual similarity to task
- Required for task completion

#### 2. Project Relevance (Weight: 0.25)
- File importance (critical/high/medium/low)
- Architecture centrality
- Dependency depth

#### 3. Dependency Importance (Weight: 0.15)
- Number of dependents
- Import frequency
- Call frequency

#### 4. Recency (Weight: 0.10)
- Last modified time
- Recent commits
- Recent edits

#### 5. Confidence (Weight: 0.10)
- Index confidence
- Symbol confidence
- Test coverage

#### 6. User Priority (Weight: 0.05)
- User explicitly marked important
- User explicitly included/excluded

#### 7. Verification Value (Weight: 0.05)
- Test coverage
- Verification history
- Bug fix history

### Final Score
```javascript
score = (taskRelevance * 0.35) +
        (projectRelevance * 0.25) +
        (dependencyImportance * 0.15) +
        (recency * 0.10) +
        (confidence * 0.10) +
        (userPriority * 0.05) +
        (verificationValue * 0.05)
```

## Context Budget

### Budget Calculation
```javascript
availableContext = maxContextWindow - 
                   reservedForNewResults - 
                   reservedForModelOutput - 
                   reservedForRecovery
```

### Reservations
- **New Tool Results:** 20% of context
- **Model Output:** 30% of context
- **Recovery/Retry:** 10% of context
- **Available for Retrieval:** 40% of context

### Budget Allocation by Tier
- **LIVE:** 10% (fixed)
- **ACTIVE_TASK:** 20% (fixed)
- **PROJECT:** 40% (variable, based on scoring)
- **LONG_TERM:** 20% (variable, based on scoring)
- **ARCHIVE:** 10% (on-demand only)

## Context Compaction

### Compaction Strategy
When context exceeds budget:

#### Preserve
- Goal and constraints
- Key decisions
- Important discoveries
- Changed files
- Errors and solutions
- Failed approaches
- Tests
- Unfinished work

#### Discard
- Duplicate logs
- Repeated explanations
- Obsolete intermediate output
- Low-relevance file contents
- Redundant context

#### Summarize
- Large file contents → key functions/signatures
- Long conversations → key points
- Multiple errors → error summary
- Test results → pass/fail summary

## Project Memory

### Memory Structure
Integrate with existing ContextEngine (not a new system).

#### Architecture Summary
```javascript
{
  type: 'architecture',
  summary: string,
  components: string[],
  patterns: string[],
  lastUpdated: number
}
```

#### Decision Log
```javascript
{
  type: 'decision',
  decision: string,
  rationale: string,
  timestamp: number,
  relatedFiles: string[]
}
```

#### Failure Log
```javascript
{
  type: 'failure',
  description: string,
  attempted: string[],
  solution: string,
  timestamp: number,
  relatedFiles: string[]
}
```

#### Test Log
```javascript
{
  type: 'test',
  testName: string,
  status: 'pass' | 'fail',
  duration: number,
  timestamp: number,
  relatedFiles: string[]
}
```

#### Change Log
```javascript
{
  type: 'change',
  description: string,
  files: string[],
  timestamp: number,
  impact: string
}
```

#### Task Summary
```javascript
{
  type: 'task',
  objective: string,
  status: 'in_progress' | 'completed' | 'failed',
  files: string[],
  decisions: string[],
  timestamp: number
}
```

## Checkpoint Integration

### Checkpoint Structure
Integrate with existing checkpoint system.

```javascript
{
  taskId: string,
  timestamp: number,
  state: {
    plan: string,
    changedFiles: string[],
    contextReferences: string[],
    verification: string,
    unfinishedWork: string[]
  },
  contextSnapshot: {
    liveContext: any,
    activeTaskContext: any,
    projectContextReferences: string[],
    longTermContextReferences: string[]
  }
}
```

### Resume Process
1. Load checkpoint
2. Reconstruct context from references
3. Validate file states (detect drift)
4. Rebuild project index if needed
5. Resume task with restored context

## Repository Onboarding

### Auto-Detection
Detect and store:
- **Framework:** React, Vue, Express, Django, etc.
- **Language:** JavaScript, TypeScript, Python, etc.
- **Package Manager:** npm, yarn, pip, cargo, etc.
- **Test Command:** npm test, pytest, cargo test, etc.
- **Build Command:** npm build, make, cargo build, etc.
- **Lint Command:** npm lint, flake8, cargo clippy, etc.
- **Entry Points:** main.js, index.ts, app.py, etc.
- **Environment Requirements:** Node version, Python version, etc.

### Engineering Summary
```javascript
{
  projectId: string,
  detectedFramework: string,
  detectedLanguage: string,
  packageManager: string,
  commands: {
    test: string,
    build: string,
    lint: string,
    dev: string
  },
  entryPoints: string[],
  environment: {
    nodeVersion?: string,
    pythonVersion?: string,
    other?: any
  },
  estimatedSize: number,
  indexingComplete: boolean,
  lastIndexed: number
}
```

## Engineering Memory

### Memory Types

#### Architecture
```javascript
{
  type: 'architecture',
  content: string,
  tags: ['architecture', 'overview'],
  timestamp: number
}
```

#### Conventions
```javascript
{
  type: 'convention',
  content: string,
  tags: ['convention', 'style'],
  timestamp: number
}
```

#### Commands
```javascript
{
  type: 'command',
  command: string,
  description: string,
  tags: ['command', 'workflow'],
  timestamp: number
}
```

#### Known Issues
```javascript
{
  type: 'issue',
  description: string,
  workaround: string,
  tags: ['issue', 'known'],
  timestamp: number
}
```

#### Important Decisions
```javascript
{
  type: 'decision',
  decision: string,
  rationale: string,
  tags: ['decision', 'important'],
  timestamp: number
}
```

#### Constraints
```javascript
{
  type: 'constraint',
  constraint: string,
  rationale: string,
  tags: ['constraint', 'requirement'],
  timestamp: number
}
```

## Context Completeness

### Completeness Check
Before major changes:
1. Calculate retrieved context coverage
2. Check for missing dependencies
3. Verify test coverage
4. Validate architecture understanding

### Thresholds
- **Critical files:** 100% coverage required
- **High importance:** 80% coverage required
- **Medium importance:** 60% coverage required
- **Low importance:** 40% coverage required

### Fallback
If context is incomplete:
1. Retrieve additional context
2. Warn user about potential gaps
3. Proceed with caution
4. Add verification step

## Stale Context

### Cache Invalidation
Invalidate cached context when:
- Relevant files change (detected via file watching)
- Git commits change files
- Time-based expiry (configurable TTL)
- Manual invalidation

### File Watching
- Watch critical files for changes
- Invalidate dependent contexts
- Re-index changed files
- Update graph relationships

### Version Tracking
- Track file versions (hash/timestamp)
- Compare before serving cached context
- Rebuild if version mismatch

## Multi-Agent Context

### Context Isolation
Each specialist agent receives:
- Relevant code only
- Relevant task only
- Relevant project rules only
- Minimal parent context

### Parent Agent Context
Parent agent receives:
- Structured findings from specialists
- Key decisions
- Verification results
- Summary of work done

### Context Sharing
- Use context references instead of full context
- Lazy loading of detailed context
- Agent-specific context budgets

## Tool Search Integration

### Tool Discovery
```
Task
↓
Analyze task requirements
↓
Search ToolRegistry for relevant tools
↓
Load only required tool schemas
↓
Execute tools
↓
Return results
```

### Tool Relevance Scoring
- Task match
- Capability match
- Permission match
- Historical success rate

## Testing Strategy

### Test Scenarios
1. **Small Repo** (< 100 files)
2. **Medium Repo** (100-500 files)
3. **Large Repo** (500-2000 files)
4. **Monorepo** (multiple projects)
5. **Multi-Module** (complex dependencies)

### Test Coverage
- Context compaction
- Stale cache detection
- Retrieval relevance
- Restart/resume
- Cross-project isolation
- Multi-agent context
- Tool search integration

### Benchmark Workloads
- 10K token class
- 100K token class
- 250K token class
- 400K token class
- 1M token class (where supported)

## Performance Metrics

### Key Metrics
- **Retrieval Latency:** Time to retrieve context
- **Indexing Latency:** Time to build/rebuild index
- **Cache Hit Rate:** Percentage of context served from cache
- **Context Assembly Latency:** Time to assemble final context
- **Token Efficiency:** Tokens used vs. tokens retrieved
- **Task Success:** Percentage of tasks completed successfully
- **Stale Context Rate:** Percentage of stale context served

### Targets
- Retrieval Latency: < 500ms
- Indexing Latency: < 30s (incremental), < 5min (full)
- Cache Hit Rate: > 80%
- Context Assembly Latency: < 1s
- Token Efficiency: > 70%
- Task Success: > 90%
- Stale Context Rate: < 5%

## Implementation Order

1. **ContextFabric Core** - Basic context orchestration
2. **Context Tiers** - Implement tier structure
3. **Codebase Index** - File and symbol indexing
4. **Code Graph** - Relationship tracking
5. **Retrieval System** - Basic retrieval strategies
6. **Context Scoring** - Relevance ranking
7. **Context Budget** - Budget calculation
8. **Context Compaction** - Basic compaction
9. **Project Memory** - Integration with ContextEngine
10. **Repository Onboarding** - Auto-detection
11. **Engineering Memory** - Structured memory
12. **Stale Context** - Cache invalidation
13. **Testing** - Comprehensive test suite

## File Structure

```
server/src/core/
├── contextFabric.js          # Main ContextFabric orchestration
├── contextTiers.js           # Context tier implementations
├── codebaseIndex.js          # File and symbol indexing
├── codeGraph.js              # Relationship tracking
├── retrievalEngine.js        # Retrieval strategies
├── contextScoring.js        # Relevance ranking
├── contextBudget.js          # Budget calculation
├── contextCompaction.js      # Context compression
├── projectMemory.js          # Integration with ContextEngine
├── repositoryOnboarding.js   # Auto-detection
└── staleContext.js           # Cache invalidation

server/test/
├── contextFabric.test.js     # ContextFabric tests
├── retrieval.test.js         # Retrieval tests
├── compaction.test.js        # Compaction tests
└── benchmarks/               # Performance benchmarks
```

## Integration Points

### With Existing Systems
- **ContextEngine:** Use existing memory system, don't duplicate
- **Checkpoint System:** Extend existing checkpoint structure
- **ToolRegistry:** Use existing tool discovery
- **Provider Registry:** Use existing provider selection
- **Skill System:** Consume, don't modify

### With Future Systems
- **MetaCode UI:** Provide context intelligence backend
- **Multi-Agent System:** Provide context isolation
- **Browser/Computer Use:** Provide context for web operations
- **Vision Integration:** Provide context for visual tasks

## Conclusion

ContextFabric provides the intelligent context layer that enables MetaIoid to work with large codebases effectively. By retrieving, ranking, and assembling relevant context rather than dumping entire repositories, ContextFabric makes large projects feel manageable while maintaining accuracy and efficiency.

The architecture is designed to:
- Scale to 1M+ token contexts
- Support multiple retrieval strategies
- Adapt to different project sizes
- Integrate with existing systems
- Enable multi-agent workflows
- Provide performance monitoring

This foundation will enable MetaCode to understand and work with complex codebases intelligently, supporting the vision of "Get this done" without requiring users to constantly re-explain their projects.
