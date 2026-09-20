// Developer / Owner — Skill Forge, Tool Builder & Continuous Engine (§40)
// Clean high-precision interface for inspecting skills, experiments, benchmarks, audit logs, and maintenance.

import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  X,
  Cpu,
  ShieldCheck,
  RotateCcw,
  Play,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Flame,
  Layers,
  History,
  Activity,
  Terminal,
} from 'lucide-react';
import { SkillRegistry } from '../../lib/skills/registry';
import { CapabilityGapEngine } from '../../lib/skills/gapEngine';
import { IdleMaintenanceEngine } from '../../lib/skills/maintenance';
import { SkillForge } from '../../lib/skills/forge';
import type { Skill, SkillAuditLog, CapabilityGap, SelfImprovementReport } from '../../lib/skills/types';
import { cn } from '../../lib/cn';

interface SkillForgePanelProps {
  open: boolean;
  onClose: () => void;
}

export function SkillForgePanel({ open, onClose }: SkillForgePanelProps) {
  const [activeTab, setActiveTab] = useState<'skills' | 'gaps' | 'audit' | 'maintenance'>('skills');
  const [skills, setSkills] = useState<Skill[]>([]);
  const [gaps, setGaps] = useState<CapabilityGap[]>([]);
  const [auditLogs, setAuditLogs] = useState<SkillAuditLog[]>([]);
  const [isMaintaining, setIsMaintaining] = useState(false);
  const [maintenanceReport, setMaintenanceReport] = useState<SelfImprovementReport | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [testingSkillId, setTestingSkillId] = useState<string | null>(null);
  const [testOutput, setTestOutput] = useState<string | null>(null);

  const refresh = () => {
    setSkills(SkillRegistry.getAllSkills());
    setGaps(CapabilityGapEngine.getIdentifiedGaps());
    setAuditLogs(SkillRegistry.getAuditLogs());
    setMaintenanceReport(IdleMaintenanceEngine.getLastReport());
  };

  useEffect(() => {
    if (open) {
      refresh();
    }
  }, [open]);

  const runMaintenance = async () => {
    setIsMaintaining(true);
    setStatusMessage('Running autonomous idle maintenance & regression checks…');
    try {
      const rep = await IdleMaintenanceEngine.runMaintenanceCycle();
      setMaintenanceReport(rep);
      refresh();
      setStatusMessage('Maintenance cycle completed successfully.');
    } catch (e) {
      setStatusMessage(`Maintenance error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsMaintaining(false);
    }
  };

  const forgeGap = async (gap: CapabilityGap) => {
    setStatusMessage(`Synthesizing and evaluating skill: ${gap.proposedSkillName}…`);
    try {
      const res = await SkillForge.forgeFromGap(gap);
      if (res.success) {
        setStatusMessage(`Success: ${res.reason}`);
      } else {
        setStatusMessage(`Forge failed: ${res.reason}`);
      }
      refresh();
    } catch (e) {
      setStatusMessage(`Error forging skill: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const rollbackSkill = (skillId: string) => {
    const rolled = SkillRegistry.rollback(skillId, 'Manual developer rollback');
    if (rolled) {
      setStatusMessage(`Skill "${skillId}" rolled back to previous stable version.`);
      refresh();
    } else {
      setStatusMessage(`No stable fallback version found for "${skillId}".`);
    }
  };

  const testSkillInSandbox = async (skill: Skill) => {
    setTestingSkillId(skill.skillId);
    setTestOutput('Executing in isolated sandbox...');
    try {
      let inputs: Record<string, unknown> = {};
      if (skill.skillId === 'pdf_compare') {
        inputs = { docA: 'Header A\\nParagraph 1', docB: 'Header A\\nParagraph 1\\nParagraph 2' };
      } else if (skill.skillId === 'resilient_dom_selector') {
        inputs = { candidates: [{ id: 'b1', text: 'Confirm' }], targetQuery: 'Confirm' };
      } else {
        inputs = { query: 'MetaIoid OS architecture' };
      }

      const res = await SkillRegistry.executeSkill(skill.skillId, inputs);
      setTestOutput(JSON.stringify(res, null, 2));
      refresh();
    } catch (e) {
      setTestOutput(`Sandbox error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[85] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ duration: 0.18 }}
          className="relative w-full max-w-4xl h-[85vh] flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] shadow-2xl overflow-hidden text-[var(--fg)]"
          role="dialog"
          aria-label="Developer Skill Forge"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--surface)]">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[var(--accent-subtle)] border border-[var(--accent)] flex items-center justify-center text-[var(--accent)]">
                <Flame size={17} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-[15px] font-bold tracking-tight">Developer / Owner &middot; Skill Forge</h2>
                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                    Sandboxed Engine
                  </span>
                </div>
                <p className="text-[11.5px] text-[var(--fg-muted)]">
                  Autonomous skill synthesis, benchmark verification, canary versions & rollback
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={runMaintenance}
                disabled={isMaintaining}
                className={cn(
                  'h-8 px-3 rounded-lg text-[12px] font-medium border border-[var(--border)] bg-[var(--surface-sunken)] hover:bg-[var(--surface)] inline-flex items-center gap-1.5 transition-colors',
                  isMaintaining && 'opacity-60 cursor-not-allowed'
                )}
              >
                <Sparkles size={13} className={isMaintaining ? 'animate-spin text-[var(--accent)]' : ''} />
                {isMaintaining ? 'Maintaining…' : 'Run Cycle'}
              </button>
              <button onClick={onClose} className="icon-btn w-8 h-8" aria-label="Close">
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-1 px-6 border-b border-[var(--border)] bg-[var(--surface)] text-[12.5px]">
            <button
              onClick={() => setActiveTab('skills')}
              className={cn(
                'px-3 py-2.5 font-medium border-b-2 transition-colors inline-flex items-center gap-1.5',
                activeTab === 'skills'
                  ? 'border-[var(--accent)] text-[var(--fg)]'
                  : 'border-transparent text-[var(--fg-muted)] hover:text-[var(--fg)]'
              )}
            >
              <Layers size={13} />
              Skill Registry ({skills.length})
            </button>
            <button
              onClick={() => setActiveTab('gaps')}
              className={cn(
                'px-3 py-2.5 font-medium border-b-2 transition-colors inline-flex items-center gap-1.5',
                activeTab === 'gaps'
                  ? 'border-[var(--accent)] text-[var(--fg)]'
                  : 'border-transparent text-[var(--fg-muted)] hover:text-[var(--fg)]'
              )}
            >
              <Activity size={13} />
              Capability Gaps ({gaps.length})
            </button>
            <button
              onClick={() => setActiveTab('audit')}
              className={cn(
                'px-3 py-2.5 font-medium border-b-2 transition-colors inline-flex items-center gap-1.5',
                activeTab === 'audit'
                  ? 'border-[var(--accent)] text-[var(--fg)]'
                  : 'border-transparent text-[var(--fg-muted)] hover:text-[var(--fg)]'
              )}
            >
              <History size={13} />
              Audit Log ({auditLogs.length})
            </button>
            <button
              onClick={() => setActiveTab('maintenance')}
              className={cn(
                'px-3 py-2.5 font-medium border-b-2 transition-colors inline-flex items-center gap-1.5',
                activeTab === 'maintenance'
                  ? 'border-[var(--accent)] text-[var(--fg)]'
                  : 'border-transparent text-[var(--fg-muted)] hover:text-[var(--fg)]'
              )}
            >
              <Cpu size={13} />
              Improvement Report
            </button>
          </div>

          {statusMessage && (
            <div className="px-6 py-2 bg-[var(--accent-subtle)] border-b border-[var(--accent)]/30 text-[12px] text-[var(--fg)] flex items-center justify-between">
              <span>{statusMessage}</span>
              <button onClick={() => setStatusMessage('')} className="text-[11px] underline opacity-70">
                Dismiss
              </button>
            </div>
          )}

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {/* TAB: SKILLS REGISTRY */}
            {activeTab === 'skills' && (
              <div className="space-y-3">
                {skills.map((skill) => {
                  const currentVer = skill.versions[skill.currentVersion];
                  const status = currentVer?.status || 'EXPERIMENTAL';
                  return (
                    <div
                      key={skill.skillId}
                      className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)] transition-all"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-[14px] text-[var(--fg)]">{skill.name}</span>
                            <span className="text-[11px] font-mono text-[var(--fg-muted)]">v{skill.currentVersion}</span>
                            <span
                              className={cn(
                                'text-[10px] font-mono uppercase px-2 py-0.5 rounded border font-semibold',
                                status === 'STABLE' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
                                status === 'CANARY' && 'border-amber-500/30 bg-amber-500/10 text-amber-300',
                                status === 'EXPERIMENTAL' && 'border-sky-500/30 bg-sky-500/10 text-sky-400',
                                status === 'DISABLED' && 'border-red-500/30 bg-red-500/10 text-red-400'
                              )}
                            >
                              {status}
                            </span>
                          </div>
                          <p className="text-[12.5px] text-[var(--fg-muted)] mt-1">{skill.purpose}</p>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => testSkillInSandbox(skill)}
                            className="h-7 px-2.5 rounded text-[11.5px] font-medium border border-[var(--border)] bg-[var(--surface-sunken)] hover:bg-[var(--surface-elevated)] inline-flex items-center gap-1"
                          >
                            <Play size={11} /> Test Sandbox
                          </button>
                          {currentVer?.rollbackVersion && (
                            <button
                              onClick={() => rollbackSkill(skill.skillId)}
                              className="h-7 px-2.5 rounded text-[11.5px] font-medium border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 inline-flex items-center gap-1"
                              title={`Rollback to ${currentVer.rollbackVersion}`}
                            >
                              <RotateCcw size={11} /> Rollback
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Benchmark & Telemetry */}
                      {currentVer?.benchmark && (
                        <div className="mt-3 grid grid-cols-4 gap-2 pt-3 border-t border-[var(--border)] text-[11.5px]">
                          <div>
                            <span className="text-[var(--fg-subtle)] block">Accuracy</span>
                            <span className="font-mono font-medium">
                              {(currentVer.benchmark.accuracy * 100).toFixed(0)}%
                            </span>
                          </div>
                          <div>
                            <span className="text-[var(--fg-subtle)] block">Latency</span>
                            <span className="font-mono font-medium">{currentVer.benchmark.latencyMs}ms</span>
                          </div>
                          <div>
                            <span className="text-[var(--fg-subtle)] block">Success / Fail</span>
                            <span className="font-mono font-medium">
                              {skill.successCount} / {skill.failureCount}
                            </span>
                          </div>
                          <div>
                            <span className="text-[var(--fg-subtle)] block">Sandbox Security</span>
                            <span className="font-mono text-emerald-400 inline-flex items-center gap-1">
                              <ShieldCheck size={11} /> Isolated
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Sandbox test output preview */}
                      {testingSkillId === skill.skillId && testOutput && (
                        <div className="mt-3 p-3 rounded-lg bg-[var(--surface-sunken)] border border-[var(--border)] font-mono text-[11px] text-zinc-300 overflow-x-auto max-h-36">
                          <div className="flex items-center justify-between text-zinc-500 mb-1">
                            <span className="inline-flex items-center gap-1">
                              <Terminal size={11} /> Sandbox Output
                            </span>
                            <button onClick={() => setTestOutput(null)} className="hover:text-zinc-300">
                              Clear
                            </button>
                          </div>
                          <pre>{testOutput}</pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* TAB: CAPABILITY GAPS */}
            {activeTab === 'gaps' && (
              <div className="space-y-3">
                {gaps.length === 0 ? (
                  <div className="p-8 text-center text-[var(--fg-muted)]">
                    <CheckCircle2 size={24} className="mx-auto text-emerald-400 mb-2" />
                    <p className="text-[13.5px] font-medium">No open capability gaps detected.</p>
                    <p className="text-[12px] mt-1">All agent workflows and tasks are executing within known tools.</p>
                  </div>
                ) : (
                  gaps.map((gap) => (
                    <div
                      key={gap.id}
                      className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] flex items-center justify-between"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-[13.5px] text-[var(--fg)]">{gap.proposedSkillName}</span>
                          <span className="text-[10.5px] font-mono px-2 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300">
                            {gap.classification}
                          </span>
                        </div>
                        <p className="text-[12.5px] text-[var(--fg-muted)] mt-1">{gap.proposedPurpose}</p>
                        <p className="text-[11px] text-[var(--fg-subtle)] mt-0.5">
                          Source: {gap.source} &middot; Recurring: {gap.recurringCount}x
                        </p>
                      </div>

                      <button
                        onClick={() => forgeGap(gap)}
                        className="h-8 px-3.5 rounded-lg text-[12px] font-medium bg-[var(--accent)] text-white hover:opacity-90 transition-opacity inline-flex items-center gap-1.5"
                      >
                        <Sparkles size={12} /> Forge Skill
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* TAB: AUDIT LOG */}
            {activeTab === 'audit' && (
              <div className="space-y-2">
                {auditLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[12.5px]"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-[var(--fg)]">{log.skillId}</span>
                        <span
                          className={cn(
                            'text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border',
                            log.action === 'CREATED' && 'border-emerald-500/30 text-emerald-400',
                            log.action === 'IMPROVED' && 'border-sky-500/30 text-sky-400',
                            log.action === 'PROMOTED_STABLE' && 'border-emerald-500/30 text-emerald-400',
                            log.action === 'ROLLED_BACK' && 'border-amber-500/30 text-amber-300'
                          )}
                        >
                          {log.action}
                        </span>
                      </div>
                      <span className="text-[11px] text-[var(--fg-subtle)]">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-[12px] text-[var(--fg-muted)] mt-1">{log.reason}</p>
                    <p className="text-[11px] text-[var(--fg-subtle)] mt-0.5 font-mono">{log.testResultsSummary}</p>
                  </div>
                ))}
              </div>
            )}

            {/* TAB: MAINTENANCE REPORT */}
            {activeTab === 'maintenance' && (
              <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[13px] leading-relaxed space-y-3 font-mono">
                {maintenanceReport ? (
                  <pre className="whitespace-pre-wrap text-[12px] text-zinc-300">
                    {IdleMaintenanceEngine.formatImprovementSummary(maintenanceReport)}
                  </pre>
                ) : (
                  <p className="text-[var(--fg-muted)]">No maintenance cycle run yet. Click "Run Cycle" above.</p>
                )}
              </div>
            )}
          </div>

          {/* Footer Safety Notice */}
          <div className="px-6 py-2.5 border-t border-[var(--border)] bg-[var(--surface)] flex items-center justify-between text-[11px] text-[var(--fg-subtle)]">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck size={12} className="text-emerald-400" />
              Core Boundary: Auth, permissions, security, and secrets cannot be modified by autonomous experiments.
            </span>
            <span className="font-mono">MetaIoid v2.4</span>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
