import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Mic, Camera, SlidersHorizontal, X, FileText, Image as ImageIcon, Telescope, BarChart3, Terminal, Lightbulb, MessageSquare, Command, Check } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useApp } from '../lib/store';
import type { Attachment } from '../lib/types';
import type { ModelId } from '../lib/types';
import { MODELS } from '../lib/i18n';
import { uid } from '../lib/storage';
import { cn } from '../lib/cn';
import { LiquidMetalButton } from './animations/LiquidMetalButton';

export type ComposerMode =
  | { id: 'ask'; label: string; prefix: ''; hint: string; desc?: string }
  | { id: string; label: string; prefix: string; hint: string; desc?: string };

// Default capability menu (used verbatim on Home via props; in Chat the
// same entries insert their prefix into the draft instead of setting mode).
const DEFAULT_MODES: ComposerMode[] = [
  { id: 'ask', label: 'Ask anything', prefix: '', hint: 'Ask anything…', desc: 'Balanced responses for everyday tasks' },
  { id: 'research', label: 'Deep Research', prefix: 'Research deeply: ', hint: 'What should I research?', desc: 'Thorough investigation with sources' },
  { id: 'image', label: 'Create Image', prefix: '/imagine ', hint: 'Describe the image…', desc: 'Free AI images via Puter — no key needed' },
  { id: 'analyze', label: 'Analyze', prefix: 'Analyze: ', hint: 'What should I analyze?', desc: 'Break down data, text or ideas' },
  { id: 'code', label: 'Code', prefix: 'Write code for: ', hint: 'Describe what to build…', desc: 'Write and debug code' },
  { id: 'brainstorm', label: 'Brainstorm', prefix: 'Brainstorm ideas for: ', hint: 'What should we brainstorm?', desc: 'Divergent ideas, then converge' },
];

const MODE_MENU_ICONS: Record<string, LucideIcon> = {
  ask: MessageSquare,
  research: Telescope,
  image: ImageIcon,
  analyze: BarChart3,
  code: Terminal,
  brainstorm: Lightbulb,
};

const MAX_FILES = 4;
const MAX_BYTES = 2.5 * 1024 * 1024;

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Engineered composer: clean elevated shell, autogrowing textarea (1–6 rows),
// drag-and-drop file attachments, mode badges, send/stop accelerator.

export function CommandBar({
  onCamera,
  large = false,
  autoFocus = false,
  mode,
  onModeClear,
  onModeSelect,
  availableModes,
  injected,
}: {
  onCamera?: () => void;
  large?: boolean;
  autoFocus?: boolean;
  mode?: ComposerMode;
  onModeClear?: () => void;
  onModeSelect?: (m: ComposerMode) => void;
  availableModes?: ComposerMode[];
  injected?: { text: string; n: number } | null;
}) {
  const { sendMessage, isGenerating, stopGenerating, setVoiceOpen, setView, setPaletteOpen, toast, connection, model, setModel } = useApp();
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const offline = connection !== 'online';
  const menuModes = availableModes ?? DEFAULT_MODES;
  const activeModel = MODELS.find((m) => m.id === model) ?? MODELS[0];

  const closeMenus = () => {
    setToolsOpen(false);
    setModeOpen(false);
  };

  // Escape closes popups (mirrors the reference behavior)
  useEffect(() => {
    if (!toolsOpen && !modeOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toolsOpen, modeOpen]);

  const selectMode = (m: ComposerMode) => {
    if (onModeSelect) onModeSelect(m.id === 'ask' ? menuModes[0] : m);
    else if (m.prefix) {
      setValue((v) => (v.startsWith(m.prefix) ? v : m.prefix + v));
      taRef.current?.focus();
    }
    closeMenus();
  };

  const selectModel = (id: ModelId) => {
    setModel(id);
    closeMenus();
  };

  // auto-grow 1..6 rows
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [value]);

  // suggestion injection
  const lastInject = useRef(0);
  useEffect(() => {
    if (injected && injected.n !== lastInject.current) {
      lastInject.current = injected.n;
      setValue(injected.text);
      taRef.current?.focus();
    }
  }, [injected]);

  const addFiles = (files: FileList | File[]) => {
    const room = MAX_FILES - atts.length;
    if (room <= 0) {
      toast({ title: 'Attachment limit', desc: `Maximum ${MAX_FILES} files per turn` });
      return;
    }
    [...files].slice(0, room).forEach((f) => {
      if (f.size > MAX_BYTES) {
        toast({ title: 'File too large', desc: `${f.name} exceeds 2.5 MB` });
        return;
      }
      const kind = f.type.startsWith('image/') ? 'image' : 'file';
      const base = { id: uid('att'), name: f.name, size: f.size, type: f.type, kind } as Attachment;
      if (kind === 'image') {
        const r = new FileReader();
        r.onload = () => setAtts((p) => [...p, { ...base, dataUrl: r.result as string }]);
        r.onerror = () => toast({ title: 'Could not read file', desc: f.name });
        r.readAsDataURL(f);
      } else {
        setAtts((p) => [...p, base]);
      }
    });
  };

  const submit = () => {
    if (isGenerating) {
      stopGenerating();
      return;
    }
    if (!value.trim() && !atts.length) return;
    const v = mode?.prefix ? `${mode.prefix}${value}` : value;
    const files = atts;
    setValue('');
    setAtts([]);
    if (taRef.current) taRef.current.style.height = 'auto';
    sendMessage(v, { attachments: files });
    setView('chat');
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
      }}
      className={cn(
        'w-full rounded-2xl border bg-[var(--surface-elevated)] transition-all duration-200',
        dragging && 'border-[var(--accent)] bg-[var(--accent-subtle)]',
        focused && !dragging
          ? 'border-[var(--accent)] ring-2 ring-[var(--accent-subtle)] shadow-md'
          : 'border-[var(--border)] shadow-sm'
      )}
    >
      {/* Mode pill banner */}
      {mode && mode.id !== 'ask' && (
        <div className="flex items-center gap-2 px-4 pt-2.5">
          <span className="chip !py-0.5 !text-[12px] !border-[var(--accent)] !text-[var(--accent)] !bg-[var(--accent-subtle)]">
            {mode.label}
          </span>
          <button onClick={onModeClear} className="text-[12px] text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors" aria-label="Clear mode">
            Clear
          </button>
        </div>
      )}

      {/* attachment previews */}
      {atts.length > 0 && (
        <div className="flex gap-2 px-4 pt-3 overflow-x-auto">
          {atts.map((a) => (
            <motion.div
              key={a.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="relative shrink-0 flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-1.5 pr-7 min-w-[130px] max-w-[200px]"
            >
              {a.kind === 'image' && a.dataUrl ? (
                <img src={a.dataUrl} alt={a.name} className="w-9 h-9 rounded-lg object-cover shrink-0" />
              ) : (
                <span className="w-9 h-9 rounded-lg bg-[var(--surface-elevated)] flex items-center justify-center shrink-0">
                  {a.type.startsWith('image/') ? <ImageIcon size={15} className="text-[var(--fg-muted)]" /> : <FileText size={15} className="text-[var(--fg-muted)]" />}
                </span>
              )}
              <span className="min-w-0">
                <span className="block text-[12px] font-medium text-[var(--fg)] truncate">{a.name}</span>
                <span className="block text-[10.5px] text-[var(--fg-muted)]">{formatSize(a.size)}</span>
              </span>
              <button
                onClick={() => setAtts((p) => p.filter((x) => x.id !== a.id))}
                className="absolute top-1 right-1 icon-btn w-7 h-7"
                aria-label={`Remove ${a.name}`}
              >
                <X size={11} />
              </button>
            </motion.div>
          ))}
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/*,.pdf,.txt,.md,.csv,.json,.ts,.tsx,.js,.jsx,.py"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          if (e.target.files?.length) addFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Primary Textarea Area */}
      <div className={cn('w-full px-4 pt-3.5 pb-1', large && 'px-5 pt-4 pb-2')}>
        <textarea
          ref={taRef}
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onPaste={(e) => {
            const files = e.clipboardData?.files;
            if (files?.length) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={mode && mode.id !== 'ask' ? mode.hint : 'Ask MetaIoid anything…'}
          aria-label="Prompt input"
          className={cn(
            'w-full bg-transparent resize-none outline-none placeholder:text-[var(--fg-subtle)] text-[var(--fg)] overflow-y-auto font-sans leading-relaxed',
            large ? 'text-[15.5px]' : 'text-[14.5px]'
          )}
          style={{ minHeight: large ? 36 : 28 }}
        />
      </div>

      {/* Minimal Ergonomic Controls: ＋ ... 🎙 ↑ */}
      <div className="relative flex items-center justify-between px-3 pb-2.5 pt-1">
        <div className="relative">
          <button
            onClick={() => setToolsOpen((o) => !o)}
            aria-expanded={toolsOpen}
            aria-haspopup="menu"
            className={cn(
              'inline-flex items-center justify-center w-8 h-8 rounded-full border transition-all active:scale-95',
              toolsOpen
                ? 'border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--fg)]'
                : 'border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--fg-secondary)] hover:text-[var(--fg)] hover:border-[var(--fg-muted)]'
            )}
            title="Attach files or capabilities"
            aria-label="Attach or select capabilities"
          >
            <Plus size={16} strokeWidth={2.2} />
          </button>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setVoiceOpen(true)}
            className="inline-flex items-center justify-center w-8 h-8 rounded-full text-[var(--fg-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-subtle)] transition-colors"
            aria-label="Voice input"
            title="Voice mode"
          >
            <Mic size={17} strokeWidth={2} />
          </button>
          <LiquidMetalButton
            onClick={submit}
            isGenerating={isGenerating}
            disabled={!isGenerating && !value.trim() && !atts.length}
            size={34}
            title={isGenerating ? 'Stop generating' : 'Send message'}
          />
        </div>

        {/* Universal Attachments & Capabilities Popover */}
        <AnimatePresence>
          {toolsOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={closeMenus} aria-hidden />
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.98 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="absolute z-50 left-0 bottom-full mb-2 w-[min(300px,calc(100vw-3rem))] rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] backdrop-blur-xl shadow-pop p-1.5 overflow-y-auto"
                role="menu"
                aria-label="Composer capabilities"
              >
                <button
                  role="menuitem"
                  onClick={() => {
                    closeMenus();
                    fileRef.current?.click();
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left hover:bg-[var(--surface-hover)] transition-colors text-[var(--fg)]"
                >
                  <span className="w-6 text-center text-[var(--fg-muted)] shrink-0">
                    <FileText size={15} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-medium text-[var(--fg)]">Upload file or document</span>
                    <span className="block text-[11px] text-[var(--fg-muted)]">PDF, DOCX, CSV, TXT, images</span>
                  </span>
                </button>

                {onCamera && (
                  <button
                    role="menuitem"
                    onClick={() => {
                      closeMenus();
                      onCamera();
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left hover:bg-[var(--surface-hover)] transition-colors text-[var(--fg)]"
                  >
                    <span className="w-6 text-center text-[var(--fg-muted)] shrink-0">
                      <Camera size={15} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] font-medium text-[var(--fg)]">Take photo / Camera</span>
                      <span className="block text-[11px] text-[var(--fg-muted)]">Visual context capture</span>
                    </span>
                  </button>
                )}

                <div className="h-px bg-[var(--border-subtle)] my-1" />

                <div className="px-3 pt-1.5 pb-1 text-[10.5px] font-bold tracking-[0.14em] uppercase text-[var(--fg-muted)]">
                  Workspaces & Capabilities
                </div>

                {menuModes.map((m) => {
                  const Icon = MODE_MENU_ICONS[m.id] ?? MessageSquare;
                  return (
                    <button
                      key={m.id}
                      role="menuitem"
                      onClick={() => {
                        closeMenus();
                        selectMode(m);
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left hover:bg-[var(--surface-hover)] transition-colors text-[var(--fg)]"
                    >
                      <span className="w-6 text-center text-[var(--fg-muted)] shrink-0">
                        <Icon size={15} />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[13px] font-medium text-[var(--fg)]">{m.label}</span>
                        {m.desc && <span className="block text-[11px] text-[var(--fg-muted)] truncate">{m.desc}</span>}
                      </span>
                    </button>
                  );
                })}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      {focused && large && (
        <div className="px-4 pb-2.5 flex items-center gap-2 text-[11.5px] text-[var(--fg-muted)] border-t border-[var(--border-subtle)] pt-1.5">
          <kbd className="font-mono bg-[var(--surface-sunken)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[11px]">Enter</kbd> send
          <kbd className="font-mono bg-[var(--surface-sunken)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[11px]">Shift+Enter</kbd> newline
          <span className="ml-auto hidden sm:inline">{offline ? 'Local prototype' : 'Connected'}</span>
        </div>
      )}
    </div>
  );
}
