// Repository Onboarding - Auto-detect framework, language, commands
// METAIOID AGENT 1: ContextFabric + MetaCode Repository Intelligence
// Detects project characteristics and creates engineering summary

import fs from 'node:fs';
import path from 'node:path';

/**
 * Framework Detection Patterns
 */
const FRAMEWORK_PATTERNS = {
  react: ['package.json', 'src/components', 'public/index.html'],
  vue: ['package.json', 'src/App.vue', 'vue.config.js'],
  angular: ['package.json', 'angular.json', 'src/app'],
  express: ['package.json', 'server.js', 'app.js', 'routes'],
  django: ['manage.py', 'requirements.txt', 'settings.py'],
  flask: ['app.py', 'requirements.txt', 'templates'],
  rails: ['Gemfile', 'config/application.rb', 'app/controllers'],
  nextjs: ['package.json', 'next.config.js', 'pages/'],
  nuxtjs: ['package.json', 'nuxt.config.js', 'pages/'],
  svelte: ['package.json', 'src/App.svelte', 'rollup.config.js'],
  nestjs: ['package.json', 'nest-cli.json', 'src/main.ts'],
  fastapi: ['main.py', 'requirements.txt', 'app/'],
  spring: ['pom.xml', 'src/main/java', 'application.properties'],
  go: ['go.mod', 'main.go', 'go.sum']
};

/**
 * Language Detection Patterns
 */
const LANGUAGE_PATTERNS = {
  javascript: ['.js', '.jsx', '.mjs', 'package.json'],
  typescript: ['.ts', '.tsx', 'tsconfig.json'],
  python: ['.py', 'requirements.txt', 'setup.py', 'pyproject.toml'],
  java: ['.java', 'pom.xml', 'build.gradle'],
  go: ['.go', 'go.mod'],
  rust: ['.rs', 'Cargo.toml'],
  cpp: ['.cpp', '.cc', '.cxx', '.h', '.hpp', 'CMakeLists.txt'],
  csharp: ['.cs', '.csproj'],
  php: ['.php', 'composer.json'],
  ruby: ['.rb', 'Gemfile'],
  swift: ['.swift', 'Package.swift'],
  kotlin: ['.kt', '.kts', 'build.gradle']
};

/**
 * Repository Onboarding - Auto-detection system
 */
export class RepositoryOnboarding {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.engineeringSummary = null;
  }
  
  /**
   * Perform complete repository onboarding
   */
  async onboard() {
    console.log('Performing repository onboarding...');
    
    this.engineeringSummary = {
      projectId: this._generateProjectId(),
      detectedFramework: this._detectFramework(),
      detectedLanguage: this._detectLanguage(),
      packageManager: this._detectPackageManager(),
      commands: this._detectCommands(),
      entryPoints: this._detectEntryPoints(),
      environment: this._detectEnvironment(),
      estimatedSize: this._estimateSize(),
      indexingComplete: false,
      lastIndexed: null
    };
    
    console.log('Repository onboarding complete');
    return this.engineeringSummary;
  }
  
  /**
   * Generate project ID
   */
  _generateProjectId() {
    const projectName = path.basename(this.projectPath);
    return projectName.toLowerCase().replace(/[^a-z0-9]/g, '-');
  }
  
  /**
   * Detect framework
   */
  _detectFramework() {
    const detected = [];
    
    for (const [framework, patterns] of Object.entries(FRAMEWORK_PATTERNS)) {
      let matchCount = 0;
      
      for (const pattern of patterns) {
        const filePath = path.join(this.projectPath, pattern);
        if (fs.existsSync(filePath)) {
          matchCount++;
        }
      }
      
      if (matchCount >= 2) {
        detected.push(framework);
      }
    }
    
    return detected.length > 0 ? detected[0] : 'unknown';
  }
  
  /**
   * Detect primary language
   */
  _detectLanguage() {
    const languageCounts = {};
    
    const files = this._walkDirectory(this.projectPath);
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      
      for (const [language, patterns] of Object.entries(LANGUAGE_PATTERNS)) {
        if (patterns.includes(ext)) {
          languageCounts[language] = (languageCounts[language] || 0) + 1;
        }
      }
    }
    
    // Return language with highest count
    const sorted = Object.entries(languageCounts).sort((a, b) => b[1] - a[1]);
    return sorted.length > 0 ? sorted[0][0] : 'unknown';
  }
  
  /**
   * Detect package manager
   */
  _detectPackageManager() {
    const packageFiles = [
      'package.json',
      'yarn.lock',
      'package-lock.json',
      'requirements.txt',
      'poetry.lock',
      'Pipfile',
      'Cargo.toml',
      'Cargo.lock',
      'go.mod',
      'go.sum',
      'pom.xml',
      'build.gradle',
      'Gemfile',
      'composer.json'
    ];
    
    for (const file of packageFiles) {
      const filePath = path.join(this.projectPath, file);
      if (fs.existsSync(filePath)) {
        if (file === 'yarn.lock') return 'yarn';
        if (file === 'package-lock.json') return 'npm';
        if (file === 'package.json') return 'npm';
        if (file === 'poetry.lock' || file === 'Pipfile') return 'poetry';
        if (file === 'requirements.txt') return 'pip';
        if (file === 'Cargo.toml') return 'cargo';
        if (file === 'go.mod') return 'go';
        if (file === 'pom.xml') return 'maven';
        if (file === 'build.gradle') return 'gradle';
        if (file === 'Gemfile') return 'bundler';
        if (file === 'composer.json') return 'composer';
      }
    }
    
    return 'unknown';
  }
  
  /**
   * Detect common commands
   */
  _detectCommands() {
    const commands = {
      test: this._detectTestCommand(),
      build: this._detectBuildCommand(),
      lint: this._detectLintCommand(),
      dev: this._detectDevCommand()
    };
    
    return commands;
  }
  
  /**
   * Detect test command
   */
  _detectTestCommand() {
    const packageManager = this._detectPackageManager();
    
    switch (packageManager) {
      case 'npm':
      case 'yarn':
        return 'npm test';
      case 'pip':
      case 'poetry':
        return 'pytest';
      case 'cargo':
        return 'cargo test';
      case 'go':
        return 'go test ./...';
      case 'maven':
        return 'mvn test';
      case 'gradle':
        return 'gradle test';
      case 'bundler':
        return 'bundle exec rspec';
      default:
        return null;
    }
  }
  
  /**
   * Detect build command
   */
  _detectBuildCommand() {
    const packageManager = this._detectPackageManager();
    const framework = this._detectFramework();
    
    switch (packageManager) {
      case 'npm':
      case 'yarn':
        if (framework === 'nextjs') return 'npm run build';
        if (framework === 'nuxtjs') return 'npm run build';
        if (framework === 'react') return 'npm run build';
        return 'npm run build';
      case 'pip':
      case 'poetry':
        return 'python setup.py build';
      case 'cargo':
        return 'cargo build';
      case 'go':
        return 'go build';
      case 'maven':
        return 'mvn package';
      case 'gradle':
        return 'gradle build';
      default:
        return null;
    }
  }
  
  /**
   * Detect lint command
   */
  _detectLintCommand() {
    const packageManager = this._detectPackageManager();
    
    switch (packageManager) {
      case 'npm':
      case 'yarn':
        return 'npm run lint';
      case 'pip':
      case 'poetry':
        return 'flake8' || 'pylint';
      case 'cargo':
        return 'cargo clippy';
      case 'go':
        return 'gofmt -s -w .';
      default:
        return null;
    }
  }
  
  /**
   * Detect dev command
   */
  _detectDevCommand() {
    const packageManager = this._detectPackageManager();
    const framework = this._detectFramework();
    
    switch (packageManager) {
      case 'npm':
      case 'yarn':
        if (framework === 'nextjs') return 'npm run dev';
        if (framework === 'nuxtjs') return 'npm run dev';
        if (framework === 'react') return 'npm start';
        return 'npm run dev';
      case 'pip':
      case 'poetry':
        return 'python main.py' || 'python app.py';
      case 'cargo':
        return 'cargo run';
      case 'go':
        return 'go run main.go';
      default:
        return null;
    }
  }
  
  /**
   * Detect entry points
   */
  _detectEntryPoints() {
    const entryPoints = [];
    const commonEntryFiles = [
      'index.js', 'index.ts', 'main.js', 'main.ts', 'app.js', 'app.ts',
      'server.js', 'server.ts', 'api.js', 'api.ts',
      'main.py', 'app.py', 'manage.py',
      'main.go', 'cmd/main.go',
      'src/index.js', 'src/index.ts', 'src/main.js', 'src/main.ts',
      'src/app.js', 'src/app.ts'
    ];
    
    for (const entryFile of commonEntryFiles) {
      const filePath = path.join(this.projectPath, entryFile);
      if (fs.existsSync(filePath)) {
        entryPoints.push(entryFile);
      }
    }
    
    return entryPoints;
  }
  
  /**
   * Detect environment requirements
   */
  _detectEnvironment() {
    const environment = {};
    
    // Detect Node version
    const packageJsonPath = path.join(this.projectPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        if (packageJson.engines && packageJson.engines.node) {
          environment.nodeVersion = packageJson.engines.node;
        }
      } catch (error) {
        // Ignore parse errors
      }
    }
    
    // Detect Python version
    const requirementsPath = path.join(this.projectPath, 'requirements.txt');
    if (fs.existsSync(requirementsPath)) {
      try {
        const requirements = fs.readFileSync(requirementsPath, 'utf8');
        if (requirements.includes('python')) {
          const pythonMatch = requirements.match(/python.?([\d.]+)/);
          if (pythonMatch) {
            environment.pythonVersion = pythonMatch[1];
          }
        }
      } catch (error) {
        // Ignore read errors
      }
    }
    
    // Detect Go version
    const goModPath = path.join(this.projectPath, 'go.mod');
    if (fs.existsSync(goModPath)) {
      try {
        const goMod = fs.readFileSync(goModPath, 'utf8');
        const goVersionMatch = goMod.match(/go\s+([\d.]+)/);
        if (goVersionMatch) {
          environment.goVersion = goVersionMatch[1];
        }
      } catch (error) {
        // Ignore read errors
      }
    }
    
    return environment;
  }
  
  /**
   * Estimate project size
   */
  _estimateSize() {
    let totalSize = 0;
    let fileCount = 0;
    
    const files = this._walkDirectory(this.projectPath);
    for (const file of files) {
      try {
        const stats = fs.statSync(file);
        totalSize += stats.size;
        fileCount++;
      } catch (error) {
        // Ignore stat errors
      }
    }
    
    return {
      totalBytes: totalSize,
      totalFiles: fileCount,
      totalMB: (totalSize / (1024 * 1024)).toFixed(2)
    };
  }
  
  /**
   * Walk directory recursively
   */
  _walkDirectory(dir) {
    const files = [];
    
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        
        // Skip common exclude patterns
        if (this._shouldExclude(fullPath)) {
          continue;
        }
        
        if (item.isDirectory()) {
          files.push(...this._walkDirectory(fullPath));
        } else if (item.isFile()) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // Ignore directory read errors
    }
    
    return files;
  }
  
  /**
   * Check if path should be excluded
   */
  _shouldExclude(filePath) {
    const excludePatterns = [
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
    
    for (const pattern of excludePatterns) {
      if (filePath.includes(pattern)) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Get engineering summary
   */
  getEngineeringSummary() {
    return this.engineeringSummary;
  }
  
  /**
   * Save engineering summary
   */
  saveSummary() {
    if (!this.engineeringSummary) {
      throw new Error('No engineering summary available. Run onboard() first.');
    }
    
    const summaryPath = path.join(this.projectPath, '.metaloid-summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(this.engineeringSummary, null, 2));
    
    return summaryPath;
  }
}

/**
 * Create repository onboarding
 */
export function createRepositoryOnboarding(projectPath) {
  return new RepositoryOnboarding(projectPath);
}
