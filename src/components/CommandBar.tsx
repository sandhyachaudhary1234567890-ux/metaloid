import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Mic, ArrowUp, Square, Camera, Paperclip, Telescope, MessageSquarePlus, X, FileText, Image as ImageIcon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useApp } from '../lib/store';
import type { Attachment } from '../lib/types';
import { uid } from '../lib/storage';
import { cn } from '../lib/cn';
import { ModelSelector } from './ModelSelector';
import { duration, ease } from '../design/motion';

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

// THE COMPOSER
//
// The signature component: the one surface a user touches on every single
// session, so it gets the tightest proportions in the product.
//
//   [ + ]  Message MetaIoid…                          [ 🎙 ]  [ ↑ ]
//
// Everything optional stays folded away until asked for. The composer's job is
// to look like it is waiting for a thought — quiet at rest, decisive when it
// has something to send.

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
  const { sendMessage, isGenerating, stopGenerating, setVoiceOpen, setView, newConversation, toast, connection, composerDraft, setComposerDraft } = useApp();
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const offline = connection !== 'online';

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  // A draft handed over from elsewhere — home, pulse, command palette — lands
  // here and takes focus, so "continue" really continues.
  useEffect(() => {
    if (!composerDraft) return;
    setValue(composerDraft);
    setComposerDraft('');
    const el = taRef.current;
    if (el) {
      el.style.height = '0px';
      el.style.height = `${Math.min(el.scrollHeight, 182)}px`;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerDraft]);

  // Grow with the thought, up to seven comfortable lines, then scroll.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 182)}px`;
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
    if (isGenerating) {
      stopGenerating();
      return;
    }
    if (!canSend) return;

    // A single, precise beat: the button settles once as the message leaves.
    setSent(true);
    window.setTimeout(() => setSent(false), 220);

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
        'relative w-full rounded-[var(--radius-xl)] border bg-[var(--surface-elevated)]',
        'transition-[border-color,box-shadow,background-color] duration-small ease-out',
        dragging
          ? 'border-[var(--accent)] bg-[var(--accent-subtle)] shadow-[0_0_0_4px_var(--accent-subtle)]'
          : focused
            ? 'border-[var(--border-strong)] shadow-[0_0_0_3px_var(--accent-subtle),var(--shadow-pop)]'
            : 'border-[var(--border)] shadow-raised',
      )}
    >
      {/* Intent label — only present when the message carries one. */}
      <AnimatePresence initial={false}>
        {mode.id !== 'ask' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: duration.small, ease: ease.out }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-2 px-3.5 pt-3">
              <span className="inline-flex items-center rounded-full border border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[var(--accent-subtle)] px-2 py-0.5 text-micro tracking-[0.06em] text-[var(--accent)]">
                {mode.label}
              </span>
              <button
                onClick={() => onModeChange?.(COMPOSER_MODES.ask)}
                className="text-small text-[var(--fg-muted)] transition-colors duration-micro ease-out hover:text-[var(--fg)]"
              >
                Clear
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Attachments */}
      <AnimatePresence initial={false}>
        {atts.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: duration.small, ease: ease.out }}
            className="overflow-hidden"
          >
            <div className="no-scrollbar flex gap-2 overflow-x-auto px-3.5 pt-3">
              {atts.map((a) => (
                <div key={a.id} className="relative flex max-w-[210px] shrink-0 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-sunken)] py-1.5 pl-1.5 pr-7">
                  {a.kind === 'image' && a.dataUrl ? (
                    <img src={a.dataUrl} alt="" className="h-8 w-8 shrink-0 rounded-[var(--radius-xs)] object-cover" />
                  ) : (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-xs)] bg-[var(--surface-elevated)]">
                      {a.type.startsWith('image/') ? <ImageIcon size={14} className="text-[var(--fg-muted)]" /> : <FileText size={14} className="text-[var(--fg-muted)]" />}
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-small font-medium text-[var(--fg)]">{a.name}</span>
                    <span className="block text-micro font-normal tracking-normal text-[var(--fg-muted)]">{formatSize(a.size)}</span>
                  </span>
                  <button
                    onClick={() => setAtts((p) => p.filter((x) => x.id !== a.id))}
                    className="icon-btn absolute right-1 top-1/2 h-5 w-5 -translate-y-1/2"
                    aria-label={`Remove ${a.name}`}
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/*,.pdf,.txt,.md,.csv,.json,.ts,.tsx,.js,.jsx,.py"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ''; }}
      />

      {/* Main row */}
      <div className="flex items-end gap-1 px-2.5 pb-0.5 pt-1">
        <button
          onClick={() => setMenuOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="More ways to send"
          className={cn(
            'icon-btn h-10 w-10 shrink-0 rounded-[var(--radius-md)] transition-colors duration-micro ease-out',
            menuOpen && 'bg-[var(--surface-hover)] text-[var(--accent)]',
          )}
        >
          <Plus size={19} strokeWidth={1.7} className={cn('transition-transform duration-medium ease-out', menuOpen && 'rotate-45')} />
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
          className="flex-1 resize-none overflow-y-auto bg-transparent px-1 py-2.5 text-read text-[var(--fg)] outline-none placeholder:text-[var(--fg-subtle)]"
          style={{ minHeight: 42 }}
        />

        <button
          onClick={() => setVoiceOpen(true)}
          className="icon-btn h-10 w-10 shrink-0 rounded-[var(--radius-md)]"
          aria-label="Talk to MetaIoid"
          title="Voice"
        >
          <Mic size={18} strokeWidth={1.7} />
        </button>

        {/* Send. The one control in the product allowed to be decisive. */}
        <motion.button
          onClick={submit}
          disabled={!canSend && !isGenerating}
          aria-label={isGenerating ? 'Stop' : 'Send'}
          title={isGenerating ? 'Stop' : 'Send'}
          animate={sent ? { scale: [1, 0.9, 1] } : { scale: 1 }}
          transition={{ duration: 0.2, ease: ease.precise }}
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
            'transition-[background-color,color,opacity] duration-small ease-out',
            isGenerating
              ? 'border border-[var(--border)] bg-[var(--surface-hover)] text-[var(--fg)]'
              : canSend
                ? 'bg-[var(--accent-solid)] text-[var(--accent-on-solid)] hover:brightness-110'
                : 'cursor-not-allowed bg-[var(--surface-hover)] text-[var(--fg-faint)]',
          )}
        >
          {isGenerating ? <Square size={13} fill="currentColor" /> : <ArrowUp size={18} strokeWidth={2.1} />}
        </motion.button>
      </div>

      {/* Meta row — the model, and nothing that needs reading. */}
      <div className="flex min-h-[32px] items-center gap-2 px-3 pb-2 pt-0.5">
        {showModel && <ModelSelector compact />}
        <span className="flex-1" />
        <AnimatePresence mode="wait" initial={false}>
          {focused && value.length > 0 ? (
            <motion.span
              key="hint"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: duration.micro }}
              className="hidden text-micro font-normal tracking-normal text-[var(--fg-subtle)] sm:inline"
            >
              Enter sends · Shift+Enter for a new line
            </motion.span>
          ) : !focused && offline ? (
            <motion.span
              key="offline"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: duration.micro }}
              className="truncate text-micro font-normal tracking-normal text-[var(--fg-subtle)]"
            >
              Local demo ·{' '}
              <button onClick={() => setView('settings')} className="underline underline-offset-2 transition-colors hover:text-[var(--fg-muted)]">
                connect AI
              </button>
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>

      {/* `+` sheet */}
      <AnimatePresence>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden />
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.99 }}
              transition={{ duration: duration.small, ease: ease.out }}
              role="menu"
              aria-label="Ways to send"
              className="absolute bottom-full left-3 z-50 mb-2 w-[min(310px,calc(100vw-2.5rem))] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-elevated)] p-1.5 text-[var(--fg)] shadow-pop"
            >
              {menu.map((m) => (
                <button
                  key={m.label}
                  role="menuitem"
                  onClick={m.run}
                  className="flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2.5 text-left transition-colors duration-micro ease-out hover:bg-[var(--surface-hover)]"
                >
                  <m.icon size={16} strokeWidth={1.7} className="shrink-0 text-[var(--fg-muted)]" />
                  <span className="min-w-0">
                    <span className="block truncate text-ui font-medium">{m.label}</span>
                    <span className="block truncate text-small text-[var(--fg-muted)]">{m.hint}</span>
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
