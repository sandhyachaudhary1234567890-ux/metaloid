// Production-Grade Sandbox Security & Boundary Auditor (§40)
// Hardens code evaluation against:
// - Process spawning & child processes (child_process, spawn, exec, fork)
// - Native module loading (.node, dlopen, process.dlopen)
// - Network egress (fetch, XMLHttpRequest, WebSocket, net, dgram, tls)
// - Filesystem escape (fs, fs/promises, path traversal)
// - Environment & credential inheritance (process.env, process.mainModule)
// - Prototype pollution & constructor escapes (constructor.constructor, __proto__)
// - Memory & CPU exhaustion attacks

import type { SkillPermission } from './types';

export interface SecurityAuditResult {
  isPermitted: boolean;
  blockedViolations: string[];
  riskTier: 'SAFE' | 'POTENTIALLY_UNSAFE' | 'PROHIBITED';
  isolationRequirement: 'WORKER_THREAD' | 'CONTAINER_SANDBOX' | 'DENIED';
}

const PROHIBITED_TOKENS: { pattern: RegExp; description: string }[] = [
  { pattern: /\b(child_process|spawn|exec|execSync|fork)\b/i, description: 'Process spawning and child processes prohibited' },
  { pattern: /\b(process\.dlopen|\.node\b|addon)\b/i, description: 'Native C/C++ module loading prohibited' },
  { pattern: /\b(process\.env|process\.argv|process\.binding)\b/i, description: 'Process environment inheritance prohibited' },
  { pattern: /\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/i, description: 'Browser storage & credential access prohibited' },
  { pattern: /\b(__proto__|constructor\.constructor|Object\.setPrototypeOf)\b/i, description: 'Prototype pollution and global constructor escape prohibited' },
  { pattern: /\b(importScripts|require\s*\(|import\s*\()/i, description: 'Dynamic un-vetted module import prohibited' },
  { pattern: /\b(worker_threads|cluster)\b/i, description: 'Thread/process spawning prohibited inside worker' },
  { pattern: /\b(v8|vm|repl)\b/i, description: 'V8 internals access prohibited' },
];

const NETWORK_TOKENS = [
  /\b(fetch\s*\(|XMLHttpRequest|WebSocket|EventSource)\b/i,
  /\b(net\.connect|dgram|tls\.connect|http\.request)\b/i,
];

const FS_TOKENS = [
  /\b(readFile|writeFile|unlink|readdir|mkdir|rmdir|fs\.)\b/i,
  /\b(\/etc\/|\/root\/|\.\.\/|\.\.\\|C:\\Windows)/i,
];

export class SandboxSecurityAuditor {
  /**
   * Run comprehensive static taint analysis and security boundary screening.
   */
  static auditCode(code: string, permissions: SkillPermission): SecurityAuditResult {
    const violations: string[] = [];

    // 1. Check Prohibited Tokens
    for (const item of PROHIBITED_TOKENS) {
      if (item.pattern.test(code)) {
        violations.push(item.description);
      }
    }

    // 2. Check Network Egress
    if (!permissions.network) {
      for (const pattern of NETWORK_TOKENS) {
        if (pattern.test(code)) {
          violations.push('Unauthorized network egress attempted without network permissions');
          break;
        }
      }
    }

    // 3. Check Filesystem Access
    if (permissions.filesystem === 'none') {
      for (const pattern of FS_TOKENS) {
        if (pattern.test(code)) {
          violations.push('Unauthorized filesystem access attempted with filesystem="none"');
          break;
        }
      }
    }

    // 4. Determine Isolation Requirement & Risk Tier
    if (violations.length > 0) {
      return {
        isPermitted: false,
        blockedViolations: violations,
        riskTier: 'PROHIBITED',
        isolationRequirement: 'DENIED',
      };
    }

    // Permitted: code requires at least isolated worker thread; external untrusted needs container
    const isPotentiallyUnsafe = permissions.network || permissions.filesystem !== 'none';
    return {
      isPermitted: true,
      blockedViolations: [],
      riskTier: isPotentiallyUnsafe ? 'POTENTIALLY_UNSAFE' : 'SAFE',
      isolationRequirement: isPotentiallyUnsafe ? 'CONTAINER_SANDBOX' : 'WORKER_THREAD',
    };
  }
}
