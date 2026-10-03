import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Mic, ArrowUp, Square, Camera, Paperclip, Telescope, MessageSquarePlus, X, FileText, Image as ImageIcon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useApp } from '../lib/store';
import type { Attachment } from '../lib/types';
import { uid } from '../lib/storage';
import { cn } from '../lib/cn';
import { ModelSelector } from './ModelSelector';

export interface ComposerMode {
  id: 'ask' | 'research' | 'build' | 'analyze';
  label: string;
  prefix: string;
  hint: string;
}

/** The four things people actually start with. Each is a label on the message,
 *  not hidden magic: what you send is what you typed, prefixed in the open. */
export const COMPOSER_MODES: Record<ComposerMode['id'], ComposerMode> = {
  ask: { id: 'ask', label: 'Ask', prefix: '', hint: 'Message MetaIoid…' },
  research: { id: 'research', label: 'Research', prefix: 'Research deeply: ', hint: 'What should I look into?' },
  build: { id: 'build', label: 'Build', prefix: 'Build: ', hint: 'What should we build?' },
  analyze: { id: 'analyze', label: 'Analyze', prefix: 'Analyze: ', hint: 'What should I look at?' },
};

const MAX_FILES = 4;
const MAX_BYTES = 2.5 * 1024 * 1024;

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The composer. One job: get a thought out of your head with no friction.
 *
 *   +   Message MetaIoid…                              🎙   ↑
 *
 * Everything optional stays out of the way until asked for: the `+` sheet holds
 * attach, camera, research and new chat; the model chip sits on the quiet meta
 * row and opens the full provider/model detail.
 */
export function CommandBar({
  mode = COMPOSER_MODES.ask,
  onModeChange,
  onCamera,
  autoFocus = false,
  showModel = true,
}: {
  mode?: ComposerMode;
  onModeChange?: (m: ComposerMode) => void;
  onCamera?: () => void;
  autoFocus?: boolean;
  showModel?: boolean;
}) {
  const { sendMessage, isGenerating, stopGenerating, setVoiceOpen, setView, newConversation, toast, connection } = useApp();
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const offline = connection !== 'online';

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  // Grow with the thought, up to six comfortable lines, then scroll.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [value]);

  const addFiles = (files: FileList | File[]) => {
    const room = MAX_FILES - atts.length;
    if (room <= 0) {
      toast({ title: 'Up to 4 files per message', desc: 'Remove one to add another.' });
      return;
    }
    [...files].slice(0, room).forEach((f) => {
      if (f.size > MAX_BYTES) {
        toast({ title: 'That file is too large', desc: `${f.name} is over 2.5 MB.` });
        return;
      }
      const kind = f.type.startsWith('image/') ? 'image' : 'file';
      const base = { id: uid('att'), name: f.name, size: f.size, type: f.type, kind } as Attachment;
      if (kind === 'image') {
        const r = new FileReader();
        r.onload = () => setAtts((p) => [...p, { ...base, dataUrl: r.result as string }]);
        r.onerror = () => toast({ title: 'Could not read that file', desc: f.name });
        r.readAsDataURL(f);
      } else {
        setAtts((p) => [...p, base]);
      }
    });
  };

  const canSend = Boolean(value.trim()) || atts.length > 0;

  const submit = () => {
    if (isGenerating) { stopGenerating(); return; }
    if (!canSend) return;
    const files = atts;
    setValue('');
    setAtts([]);
    if (taRef.current) taRef.current.style.height = 'auto';
    sendMessage(`${mode.prefix}${value}`.trim(), { attachments: files });
    setView('chat');
  };

  const pickMode = (m: ComposerMode) => {
    onModeChange?.(m);
    setMenuOpen(false);
    taRef.current?.focus();
  };

  const menu: { label: string; hint: string; icon: LucideIcon; run: () => void }[] = [
    { label: 'Attach a file', hint: 'Images, PDF, text — up to 2.5 MB', icon: Paperclip, run: () => { fileRef.current?.click(); setMenuOpen(false); } },
    { label: 'Show the camera', hint: 'Talk while MetaIoid looks', icon: Camera, run: () => { onCamera?.(); setMenuOpen(false); } },
    { label: 'Research deeply', hint: 'Sources and citations in this chat', icon: Telescope, run: () => pickMode(COMPOSER_MODES.research) },
    { label: 'Start a new chat', hint: 'Fresh context', icon: MessageSquarePlus, run: () => { newConversation(); setView('chat'); setMenuOpen(false); } },
  ];

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
      className={cn(
        'relative w-full rounded-[22px] border bg-[var(--surface-elevated)] transition-[border-color,box-shadow] duration-150',
        dragging ? 'border-[var(--accent)] bg-[var(--accent-subtle)]'
          : focused ? 'border-[var(--border-strong)] shadow-[0_2px_18px_-8px_rgba(0,0,0,0.35)]'
            : 'border-[var(--border)] shadow-sm',
      )}
    >
      {/* Intent label — only when the message carries one */}
      {mode.id !== 'ask' && (
        <div className="flex items-center gap-2 px-3.5 pt-2.5">
          <span className="chip !py-0.5 !text-[11.5px] !border-[var(--accent)] !text-[var(--accent)] !bg-[var(--accent-subtle)]">{mode.label}</span>
          <button onClick={() => onModeChange?.(COMPOSER_MODES.ask)} className="text-[11.5px] text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors">Clear</button>
        </div>
      )}

      {/* Attachments — filename, size, kind. Nothing more. */}
      {atts.length > 0 && (
        <div className="flex gap-2 px-3.5 pt-2.5 overflow-x-auto">
          {atts.map((a) => (
            <div key={a.id} className="relative shrink-0 flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] py-1.5 pl-1.5 pr-7 max-w-[210px]">
              {a.kind === 'image' && a.dataUrl ? (
                <img src={a.dataUrl} alt="" className="w-8 h-8 rounded-lg object-cover shrink-0" />
              ) : (
                <span className="w-8 h-8 rounded-lg bg-[var(--surface-elevated)] flex items-center justify-center shrink-0">
                  {a.type.startsWith('image/') ? <ImageIcon size={14} className="text-[var(--fg-muted)]" /> : <FileText size={14} className="text-[var(--fg-muted)]" />}
                </span>
              )}
              <span className="min-w-0">
                <span className="block text-[12px] font-medium text-[var(--fg)] truncate">{a.name}</span>
                <span className="block text-[10.5px] text-[var(--fg-muted)]">{formatSize(a.size)}</span>
              </span>
              <button onClick={() => setAtts((p) => p.filter((x) => x.id !== a.id))} className="absolute top-1/2 -translate-y-1/2 right-1.5 icon-btn w-5 h-5" aria-label={`Remove ${a.name}`}>
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      <input
        ref={fileRef} type="file" multiple
        accept="image/*,.pdf,.txt,.md,.csv,.json,.ts,.tsx,.js,.jsx,.py"
        className="hidden" aria-hidden tabIndex={-1}
        onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ''; }}
      />

      {/* Main row: + Message MetaIoid… 🎙 ↑ */}
      <div className="flex items-end gap-1 px-2.5 pt-1">
        <button
          onClick={() => setMenuOpen((o) => !o)}
          aria-haspopup="menu" aria-expanded={menuOpen} aria-label="More ways to send"
          className={cn('icon-btn w-10 h-10 shrink-0 rounded-xl transition-colors', menuOpen && 'text-[var(--accent)] bg-[var(--surface-hover)]')}
        >
          <Plus size={19} />
        </button>

        <textarea
          ref={taRef}
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onPaste={(e) => { const files = e.clipboardData?.files; if (files?.length) { e.preventDefault(); addFiles(files); } }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          rows={1}
          placeholder={mode.hint}
          aria-label="Message MetaIoid"
          className="flex-1 bg-transparent resize-none outline-none placeholder:text-[var(--fg-subtle)] text-[var(--fg)] overflow-y-auto font-sans text-[15px] leading-6 py-2.5 px-1"
          style={{ minHeight: 42 }}
        />

        <button
          onClick={() => setVoiceOpen(true)}
          className="icon-btn w-10 h-10 shrink-0 rounded-xl"
          aria-label="Talk to MetaIoid" title="Voice"
        >
          <Mic size={18} />
        </button>

        <button
          onClick={submit}
          disabled={!canSend && !isGenerating}
          aria-label={isGenerating ? 'Stop' : 'Send'}
          title={isGenerating ? 'Stop' : 'Send'}
          className={cn(
            'w-10 h-10 shrink-0 rounded-full flex items-center justify-center transition-all duration-150',
            isGenerating
              ? 'bg-[var(--surface-hover)] text-[var(--fg)] border border-[var(--border)]'
              : canSend
                ? 'bg-[var(--accent)] text-white hover:opacity-90 active:scale-95'
                : 'bg-[var(--surface-hover)] text-[var(--fg-subtle)] cursor-not-allowed',
          )}
        >
          {isGenerating ? <Square size={14} fill="currentColor" /> : <ArrowUp size={18} />}
        </button>
      </div>

      {/* Quiet meta row: model, and nothing that needs reading */}
      <div className="flex items-center gap-2 px-3.5 pb-2.5 pt-0.5 min-h-[30px]">
        {showModel && <div className="scale-[0.92] origin-left -ml-0.5"><ModelSelector compact /></div>}
        <span className="flex-1" />
        {focused && value.length > 0 && (
          <span className="hidden sm:inline text-[11px] text-[var(--fg-subtle)]">Enter sends · Shift+Enter for a new line</span>
        )}
        {!focused && offline && (
          <span className="text-[11px] text-[var(--fg-subtle)] truncate">Local demo · <button onClick={() => setView('settings')} className="underline hover:text-[var(--fg-muted)]">connect AI</button></span>
        )}
      </div>

      {/* `+` sheet */}
      <AnimatePresence>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden />
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              role="menu"
              aria-label="Ways to send"
              className="absolute z-50 left-3 bottom-full mb-2 w-[min(300px,calc(100vw-2.5rem))] rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--fg)] shadow-pop p-1.5"
            >
              {menu.map((m) => (
                <button
                  key={m.label} role="menuitem" onClick={m.run}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-[var(--surface-hover)] transition-colors"
                >
                  <m.icon size={16} className="text-[var(--fg-muted)] shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-medium truncate">{m.label}</span>
                    <span className="block text-[11.5px] text-[var(--fg-muted)] truncate">{m.hint}</span>
                  </span>
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
