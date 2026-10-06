import React, { useState } from 'react';
import { FileText, Download, Copy, Check, Maximize2, Minimize2 } from 'lucide-react';
import type { DocumentData } from '../../lib/artifacts/artifactGenerator';
import { Markdown } from '../chat/Markdown';

export interface DocumentWorkspaceProps {
  doc: DocumentData;
  onClose: () => void;
}

export function DocumentWorkspace({ doc, onClose }: DocumentWorkspaceProps) {
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState(doc.sections[0]?.id || '');

  const handleCopy = () => {
    navigator.clipboard.writeText(doc.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([doc.markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.title.toLowerCase().replace(/[^a-z0-9]/g, '_')}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <div className={`flex flex-col h-full bg-[var(--surface)] text-[var(--fg)] border-l border-[var(--border)] ${isFullscreen ? 'fixed inset-0 z-50' : 'relative'}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-elevated)_60%,transparent)] backdrop-blur-md">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-7 h-7 rounded-lg bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent)] flex items-center justify-center shrink-0">
            <FileText size={15} />
          </span>
          <div className="min-w-0">
            <h3 className="text-ui font-semibold text-[var(--fg)] truncate">{doc.title}</h3>
            <p className="text-micro text-[var(--fg-muted)]">Verified Document &middot; Executive Report</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={handleCopy}
            className="btn-ghost h-8 px-2.5 text-micro rounded-lg inline-flex items-center gap-1.5 text-[var(--fg-muted)] hover:text-[var(--fg)]"
          >
            {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            onClick={handleDownload}
            className="btn-primary h-8 px-3 text-micro rounded-lg inline-flex items-center gap-1.5"
          >
            <Download size={13} /> Export .md
          </button>
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

      {/* Body: TOC + Reading Pane */}
      <div className="flex-1 flex overflow-hidden">
        {/* Table of Contents Column */}
        <div className="hidden md:block w-48 sm:w-56 border-r border-[var(--border)] overflow-y-auto p-3 space-y-1 bg-[color-mix(in_srgb,var(--surface-sunken)_40%,transparent)] shrink-0">
          <div className="text-micro font-semibold uppercase tracking-wider text-[var(--fg-muted)] px-2 mb-2">
            Contents
          </div>
          {doc.sections.map((sec) => (
            <button
              key={sec.id}
              onClick={() => setActiveSectionId(sec.id)}
              className={`w-full text-left px-2.5 py-1.5 rounded-lg text-micro transition-colors block truncate ${
                sec.id === activeSectionId
                  ? 'bg-[var(--accent-subtle)] text-[var(--accent)] font-medium'
                  : 'text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)]'
              }`}
            >
              {sec.title}
            </button>
          ))}
        </div>

        {/* Document Reading Pane */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-6 md:p-10 bg-[var(--bg)]">
          <div className="max-w-[680px] mx-auto bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] p-5 sm:p-8 md:p-12">
            <Markdown text={doc.markdown} />
          </div>
        </div>
      </div>
    </div>
  );
}
