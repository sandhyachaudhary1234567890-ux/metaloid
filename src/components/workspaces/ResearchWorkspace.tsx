import React, { useState } from 'react';
import { Telescope, ExternalLink, CheckCircle2, Maximize2, Minimize2 } from 'lucide-react';
import type { ResearchData } from '../../lib/artifacts/artifactGenerator';

export interface ResearchWorkspaceProps {
  research: ResearchData;
  onClose: () => void;
}

export function ResearchWorkspace({ research, onClose }: ResearchWorkspaceProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  return (
    <div className={`flex flex-col h-full bg-[var(--surface)] text-[var(--fg)] border-l border-[var(--border)] ${isFullscreen ? 'fixed inset-0 z-50' : 'relative'}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-elevated)_60%,transparent)] backdrop-blur-md">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-7 h-7 rounded-lg bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent)] flex items-center justify-center shrink-0">
            <Telescope size={15} />
          </span>
          <div className="min-w-0">
            <h3 className="text-ui font-semibold text-[var(--fg)] truncate">{research.title}</h3>
            <p className="text-micro text-[var(--fg-muted)]">Verified Investigation &middot; Cited Research Workspace</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="icon-btn w-8 h-8 rounded-lg text-[var(--fg-muted)] hover:text-[var(--fg)]"
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            onClick={onClose}
            className="icon-btn w-8 h-8 rounded-lg text-[var(--fg-muted)] hover:text-[var(--fg)] ml-1"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Body: Synthesis + Evidence Cards + Sources */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[var(--bg)]">
        {/* Executive Synthesis */}
        <div className="p-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
          <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--accent)] mb-2">
            Executive Synthesis
          </h4>
          <p className="text-sm leading-relaxed text-[var(--fg)]">{research.synthesis}</p>
        </div>

        {/* Key Verified Findings */}
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--fg-muted)] mb-3 px-1">
            Key Verified Findings ({research.findings.length})
          </h4>
          <div className="grid gap-3">
            {research.findings.map((f, i) => (
              <div key={i} className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                <p className="text-xs leading-relaxed text-[var(--fg)] font-medium mb-2">{f.point}</p>
                <div className="flex items-center justify-between text-micro text-[var(--fg-muted)]">
                  <span className="inline-flex items-center gap-1 text-success font-semibold">
                    <CheckCircle2 size={12} /> {f.confidence}
                  </span>
                  <span className="truncate max-w-[200px]">{f.source}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Source Bibliography */}
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--fg-muted)] mb-3 px-1">
            Verified Sources & Citations
          </h4>
          <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border)] rounded-xl bg-[var(--surface)] overflow-hidden">
            {research.sources.map((s, i) => (
              <a
                key={i}
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="p-3 flex items-center justify-between text-xs hover:bg-[var(--surface-hover)] transition-colors group"
              >
                <div className="min-w-0 pr-4">
                  <p className="font-medium text-[var(--fg)] group-hover:text-[var(--accent)] transition-colors truncate">
                    {s.title}
                  </p>
                  <p className="text-micro text-[var(--fg-muted)] truncate">{s.url}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="px-2 py-0.5 rounded-full text-micro font-semibold bg-success/10 text-success">
                    {s.reliability}
                  </span>
                  <ExternalLink size={12} className="text-[var(--fg-muted)] group-hover:text-[var(--accent)]" />
                </div>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
