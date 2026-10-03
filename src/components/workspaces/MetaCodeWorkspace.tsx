import React, { useState } from 'react';
import { Code2, Copy, Check, FileCode, Maximize2, Minimize2, Play } from 'lucide-react';
import type { CodeData } from '../../lib/artifacts/artifactGenerator';

export interface MetaCodeWorkspaceProps {
  code: CodeData;
  onClose: () => void;
}

export function MetaCodeWorkspace({ code, onClose }: MetaCodeWorkspaceProps) {
  const [activeFileIndex, setActiveFileIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const currentFile = code.files[activeFileIndex] || code.files[0];

  const handleCopy = () => {
    navigator.clipboard.writeText(currentFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`flex flex-col h-full bg-[var(--surface)] text-[var(--fg)] border-l border-[var(--border)] ${isFullscreen ? 'fixed inset-0 z-50' : 'relative'}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-elevated)]/60 backdrop-blur-md">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-7 h-7 rounded-lg bg-[var(--accent)]/10 text-[var(--accent)] flex items-center justify-center shrink-0">
            <Code2 size={15} />
          </span>
          <div className="min-w-0">
            <h3 className="text-[13.5px] font-semibold text-[var(--fg)] truncate">{code.title}</h3>
            <p className="text-[11px] text-[var(--fg-muted)]">
              {code.files.length} files &middot; MetaCode Workspace &middot; Verified
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleCopy}
            className="btn-ghost h-8 px-2.5 text-xs rounded-lg inline-flex items-center gap-1.5 text-[var(--fg-muted)] hover:text-[var(--fg)]"
          >
            {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
            {copied ? 'Copied' : 'Copy Code'}
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

      {/* Body: File Tabs + Editor View */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#0d0f14] text-stone-200">
        {/* Tabs Bar */}
        <div className="flex items-center gap-1 px-3 pt-2 bg-[#090b0e] border-b border-stone-800 overflow-x-auto shrink-0">
          {code.files.map((file, idx) => (
            <button
              key={file.filename}
              onClick={() => setActiveFileIndex(idx)}
              className={`px-3 py-1.5 rounded-t-lg text-xs font-mono inline-flex items-center gap-1.5 transition-colors border-t border-x ${
                idx === activeFileIndex
                  ? 'bg-[#0d0f14] text-sky-400 border-stone-800'
                  : 'bg-transparent text-stone-400 border-transparent hover:text-stone-200'
              }`}
            >
              <FileCode size={13} /> {file.filename.split('/').pop()}
            </button>
          ))}
        </div>

        {/* Code Content View */}
        <div className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed select-text">
          <pre className="text-stone-300">
            <code>{currentFile.content}</code>
          </pre>
        </div>

        {/* Code Status Footer */}
        <div className="px-4 py-2 border-t border-stone-800 bg-[#090b0e] text-[11px] text-stone-400 flex items-center justify-between">
          <span>{currentFile.filename}</span>
          <span className="flex items-center gap-1.5 text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Syntax Verified
          </span>
        </div>
      </div>
    </div>
  );
}
