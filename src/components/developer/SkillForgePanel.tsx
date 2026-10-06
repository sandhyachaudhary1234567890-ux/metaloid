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
          className="relative w-full max-w-4xl h-[85vh] flex flex-col rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-elevated)] shadow-dialog overflow-hidden text-[var(--fg)]"
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
                  <h2 className="t-read">Developer / Owner &middot; Skill Forge</h2>
                  <span className="text-micro font-mono uppercase px-2 py-0.5 rounded border border-success/30 bg-success/10 text-success">
                    Sandboxed Engine
                  </span>
                </div>
                <p className="text-micro text-[var(--fg-muted)]">
                  Autonomous skill synthesis, benchmark verification, canary versions & rollback
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={runMaintenance}
                disabled={isMaintaining}
                className={cn(
                  'h-8 px-3 rounded-lg text-small font-medium border border-[var(--border)] bg-[var(--surface-sunken)] hover:bg-[var(--surface)] inline-flex items-center gap-1.5 transition-colors',
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
          <div className="flex items-center gap-1 px-6 border-b border-[var(--border)] bg-[var(--surface)] text-small">
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
            <div className="px-6 py-2 bg-[var(--accent-subtle)] border-b border-[color-mix(in_srgb,var(--accent)_30%,transparent)] text-small text-[var(--fg)] flex items-center justify-between">
              <span>{statusMessage}</span>
              <button onClick={() => setStatusMessage('')} className="text-micro underline opacity-70">
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
                            <span className="font-semibold text-body text-[var(--fg)]">{skill.name}</span>
                            <span className="text-micro font-mono text-[var(--fg-muted)]">v{skill.currentVersion}</span>
                            <span
                              className={cn(
                                'text-micro font-mono uppercase px-2 py-0.5 rounded border font-semibold',
                                status === 'STABLE' && 'border-success/30 bg-success/10 text-success',
                                status === 'CANARY' && 'border-warning/30 bg-warning/10 text-warning',
                                status === 'EXPERIMENTAL' && 'border-info/30 bg-info/10 text-info',
                                status === 'DISABLED' && 'border-danger/30 bg-danger/10 text-danger'
                              )}
                            >
                              {status}
                            </span>
                          </div>
                          <p className="text-small text-[var(--fg-muted)] mt-1">{skill.purpose}</p>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => testSkillInSandbox(skill)}
                            className="h-7 px-2.5 rounded text-micro font-medium border border-[var(--border)] bg-[var(--surface-sunken)] hover:bg-[var(--surface-elevated)] inline-flex items-center gap-1"
                          >
                            <Play size={11} /> Test Sandbox
                          </button>
                          {currentVer?.rollbackVersion && (
                            <button
                              onClick={() => rollbackSkill(skill.skillId)}
                              className="h-7 px-2.5 rounded text-micro font-medium border border-warning/30 bg-warning/10 text-warning hover:bg-warning/20 inline-flex items-center gap-1"
                              title={`Rollback to ${currentVer.rollbackVersion}`}
                            >
                              <RotateCcw size={11} /> Rollback
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Benchmark & Telemetry */}
                      {currentVer?.benchmark && (
                        <div className="mt-3 grid grid-cols-4 gap-2 pt-3 border-t border-[var(--border)] text-micro">
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
                            <span className="font-mono text-success inline-flex items-center gap-1">
                              <ShieldCheck size={11} /> Isolated
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Sandbox test output preview */}
                      {testingSkillId === skill.skillId && testOutput && (
                        <div className="mt-3 p-3 rounded-lg bg-[var(--surface-sunken)] border border-[var(--border)] font-mono text-micro text-[var(--fg-secondary)] overflow-x-auto max-h-36">
                          <div className="flex items-center justify-between text-[var(--fg-muted)] mb-1">
                            <span className="inline-flex items-center gap-1">
                              <Terminal size={11} /> Sandbox Output
                            </span>
                            <button onClick={() => setTestOutput(null)} className="hover:text-[var(--fg-secondary)]">
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
                    <CheckCircle2 size={24} className="mx-auto text-success mb-2" />
                    <p className="text-ui font-medium">No open capability gaps detected.</p>
                    <p className="text-small mt-1">All agent workflows and tasks are executing within known tools.</p>
                  </div>
                ) : (
                  gaps.map((gap) => (
                    <div
                      key={gap.id}
                      className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] flex items-center justify-between"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-ui text-[var(--fg)]">{gap.proposedSkillName}</span>
                          <span className="text-micro font-mono px-2 py-0.5 rounded border border-warning/30 bg-warning/10 text-warning">
                            {gap.classification}
                          </span>
                        </div>
                        <p className="text-small text-[var(--fg-muted)] mt-1">{gap.proposedPurpose}</p>
                        <p className="text-micro text-[var(--fg-subtle)] mt-0.5">
                          Source: {gap.source} &middot; Recurring: {gap.recurringCount}x
                        </p>
                      </div>

                      <button
                        onClick={() => forgeGap(gap)}
                        className="h-8 px-3.5 rounded-lg text-small font-medium bg-[var(--accent-solid)] text-[var(--accent-on-solid)] hover:opacity-90 transition-opacity inline-flex items-center gap-1.5"
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
                    className="p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-small"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-[var(--fg)]">{log.skillId}</span>
                        <span
                          className={cn(
                            'text-micro font-mono uppercase px-1.5 py-0.5 rounded border',
                            log.action === 'CREATED' && 'border-success/30 text-success',
                            log.action === 'IMPROVED' && 'border-info/30 text-info',
                            log.action === 'PROMOTED_STABLE' && 'border-success/30 text-success',
                            log.action === 'ROLLED_BACK' && 'border-warning/30 text-warning'
                          )}
                        >
                          {log.action}
                        </span>
                      </div>
                      <span className="text-micro text-[var(--fg-subtle)]">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-small text-[var(--fg-muted)] mt-1">{log.reason}</p>
                    <p className="text-micro text-[var(--fg-subtle)] mt-0.5 font-mono">{log.testResultsSummary}</p>
                  </div>
                ))}
              </div>
            )}

            {/* TAB: MAINTENANCE REPORT */}
            {activeTab === 'maintenance' && (
              <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-ui leading-relaxed space-y-3 font-mono">
                {maintenanceReport ? (
                  <pre className="whitespace-pre-wrap text-small text-[var(--fg-secondary)]">
                    {IdleMaintenanceEngine.formatImprovementSummary(maintenanceReport)}
                  </pre>
                ) : (
                  <p className="text-[var(--fg-muted)]">No maintenance cycle run yet. Click "Run Cycle" above.</p>
                )}
              </div>
            )}
          </div>

          {/* Footer Safety Notice */}
          <div className="px-6 py-2.5 border-t border-[var(--border)] bg-[var(--surface)] flex items-center justify-between text-micro text-[var(--fg-subtle)]">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck size={12} className="text-success" />
              Core Boundary: Auth, permissions, security, and secrets cannot be modified by autonomous experiments.
            </span>
            <span className="font-mono">MetaIoid v2.4</span>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
