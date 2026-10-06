import React, { useState } from 'react';
import { Presentation, Download, ChevronLeft, ChevronRight, Maximize2, Minimize2, Check, FileText } from 'lucide-react';
import type { PresentationData } from '../../lib/artifacts/artifactGenerator';

export interface PresentationWorkspaceProps {
  deck: PresentationData;
  onClose: () => void;
}

export function PresentationWorkspace({ deck, onClose }: PresentationWorkspaceProps) {
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const currentSlide = deck.slides[currentSlideIndex] || deck.slides[0];

  const handleDownloadPptx = () => {
    if (deck.pptxBlobUrl) {
      const a = document.createElement('a');
      a.href = deck.pptxBlobUrl;
      a.download = `${deck.title.toLowerCase().replace(/[^a-z0-9]/g, '_')}.pptx`;
      a.click();
    }
  };

  const handleDownloadMarkdown = () => {
    const md = `# ${deck.title}\n\n` + deck.slides.map((s) => `## Slide ${s.slideNumber}: ${s.title}\n${s.subtitle ? `*${s.subtitle}*\n\n` : ''}${s.bullets.map((b) => `- ${b}`).join('\n')}\n\n> Speaker Notes: ${s.speakerNotes || ''}`).join('\n\n---\n\n');
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${deck.title.toLowerCase().replace(/[^a-z0-9]/g, '_')}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <div className={`flex flex-col h-full bg-[var(--surface)] text-[var(--fg)] border-l border-[var(--border)] ${isFullscreen ? 'fixed inset-0 z-50' : 'relative'}`}>
      {/* Workspace Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-elevated)_60%,transparent)] backdrop-blur-md">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-7 h-7 rounded-lg bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent)] flex items-center justify-center shrink-0">
            <Presentation size={15} />
          </span>
          <div className="min-w-0">
            <h3 className="text-ui font-semibold text-[var(--fg)] truncate">{deck.title}</h3>
            <p className="text-micro text-[var(--fg-muted)]">
              {deck.slides.length} slides &middot; Verified PowerPoint &middot; Presentation Workspace
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={handleDownloadPptx}
            className="btn-primary h-8 px-2.5 sm:px-3 text-small rounded-lg inline-flex items-center gap-1.5"
            title="Download verified .pptx file"
          >
            <Download size={13} /> <span className="hidden sm:inline">Download</span> PPTX
          </button>
          <button
            onClick={handleDownloadMarkdown}
            className="btn-ghost h-8 px-2.5 text-small rounded-lg inline-flex items-center gap-1 text-[var(--fg-muted)] hover:text-[var(--fg)]"
            title="Export slide text as Markdown"
          >
            <FileText size={13} />
          </button>
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="icon-btn w-8 h-8 rounded-lg text-[var(--fg-muted)] hover:text-[var(--fg)] hidden sm:flex"
            title={isFullscreen ? 'Exit full screen' : 'Expand full screen'}
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            onClick={onClose}
            className="icon-btn w-8 h-8 rounded-lg text-[var(--fg-muted)] hover:text-[var(--fg)] ml-1"
            title="Close workspace"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Workspace Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Slide Thumbnails Column */}
        <div className="hidden md:block w-48 sm:w-56 border-r border-[var(--border)] overflow-y-auto p-3 space-y-2.5 bg-[color-mix(in_srgb,var(--surface-sunken)_40%,transparent)] shrink-0">
          <div className="text-micro font-semibold uppercase tracking-wider text-[var(--fg-muted)] px-1 mb-1">
            Slides ({deck.slides.length})
          </div>
          {deck.slides.map((s, idx) => (
            <button
              key={s.id}
              onClick={() => setCurrentSlideIndex(idx)}
              className={`w-full text-left p-2.5 rounded-xl border transition-all text-micro ${
                idx === currentSlideIndex
                  ? 'border-[var(--accent)] bg-[var(--surface-elevated)] font-medium text-[var(--fg)]'
                  : 'border-[var(--border)] bg-[var(--surface)] text-[var(--fg-muted)] hover:bg-[var(--surface-hover)]'
              }`}
            >
              <div className="flex items-center justify-between text-micro text-[var(--fg-muted)] mb-1">
                <span>Slide {s.slideNumber}</span>
                {idx === currentSlideIndex && <Check size={10} className="text-[var(--accent)]" />}
              </div>
              <p className="line-clamp-2 leading-snug">{s.title}</p>
            </button>
          ))}
        </div>

        {/* Slide Stage Canvas */}
        <div className="flex-1 flex flex-col p-3 sm:p-6 overflow-y-auto items-center justify-between bg-[var(--bg)]">
          {/* Main Slide Canvas */}
          <div className="w-full max-w-[720px] aspect-[16/9] rounded-[var(--radius-lg)] border border-[var(--border-strong)] bg-[var(--surface)] p-5 sm:p-8 md:p-12 shadow-pop flex flex-col justify-between select-text transition-all relative overflow-hidden">
            {/* Subtle background glow */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-[color-mix(in_srgb,var(--accent)_5%,transparent)] rounded-full blur-3xl pointer-events-none" />

            <div>
              <div className="flex items-center justify-between text-micro font-mono text-[var(--fg-muted)] uppercase tracking-wider mb-4">
                <span>{deck.title}</span>
                <span>{currentSlide.slideNumber} / {deck.slides.length}</span>
              </div>
              <h2 className="t-heading sm:t-display text-[var(--fg)] leading-snug">
                {currentSlide.title}
              </h2>
              {currentSlide.subtitle && (
                <p className="text-sm text-[var(--fg-muted)] mt-1.5 leading-relaxed">
                  {currentSlide.subtitle}
                </p>
              )}
            </div>

            <div className="my-auto py-4">
              <ul className="space-y-3">
                {currentSlide.bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-ui leading-relaxed text-[var(--fg)]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] mt-2 shrink-0" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-3 text-micro text-[var(--fg-muted)]">
              <span>MetaIoid Verified Deliverable</span>
              <span className="font-mono">Slide {currentSlide.slideNumber}</span>
            </div>
          </div>

          {/* Slide Navigation Controls */}
          <div className="flex items-center gap-3 mt-6">
            <button
              onClick={() => setCurrentSlideIndex((i) => Math.max(0, i - 1))}
              disabled={currentSlideIndex === 0}
              className="btn-ghost h-9 px-3 rounded-xl border border-[var(--border)] text-micro inline-flex items-center gap-1 disabled:opacity-40"
            >
              <ChevronLeft size={14} /> Previous
            </button>
            <span className="text-micro font-medium text-[var(--fg-muted)]">
              Slide {currentSlideIndex + 1} of {deck.slides.length}
            </span>
            <button
              onClick={() => setCurrentSlideIndex((i) => Math.min(deck.slides.length - 1, i + 1))}
              disabled={currentSlideIndex === deck.slides.length - 1}
              className="btn-ghost h-9 px-3 rounded-xl border border-[var(--border)] text-micro inline-flex items-center gap-1 disabled:opacity-40"
            >
              Next <ChevronRight size={14} />
            </button>
          </div>

          {/* Speaker Notes */}
          {currentSlide.speakerNotes && (
            <div className="w-full max-w-[720px] mt-4 p-3.5 rounded-xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-elevated)_60%,transparent)] text-micro text-[var(--fg-secondary)] leading-relaxed">
              <span className="font-semibold text-[var(--fg)] block mb-0.5">Speaker Notes:</span>
              {currentSlide.speakerNotes}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
