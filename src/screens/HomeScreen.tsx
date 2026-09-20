import { Suspense, lazy, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Image as ImageIcon, FileText, Code2, MessageSquare, ArrowUpRight,
  ChevronDown,
  Command, Mic, StopCircle, ArrowRight, Activity, CheckCircle2,
} from 'lucide-react';
import { useApp } from '../lib/store';
import { CommandBar, type ComposerMode } from '../components/CommandBar';
import { TopBar, type HomeTab } from '../components/TopBar';
import { greetingFor, getStrings } from '../lib/i18n';
import { timeAgo, cn } from '../lib/cn';
import { SystemReadyEngine } from '../lib/ready/readyCheck';
import { MetaIoidNoticedEngine } from '../lib/ready/metaIoidNoticed';
import { GlobalStopController } from '../lib/ready/globalStop';
import { MetaIoidLockup, MetaIoidMark, MetaIoidWordmark } from '../components/brand';

const BlackHoleStage = lazy(() =>
  import('../components/BlackHoleCanvas').then((m) => ({ default: m.BlackHoleCanvas }))
);

// HOME — intentional command center.
// Architectural instrument core, clean composer, contextual modes,
// honest system status, and recent activity.

const MODES: ComposerMode[] = [
  { id: 'ask', label: 'Ask', prefix: '', hint: 'Ask anything…', desc: 'Balanced responses for everyday tasks' },
  { id: 'research', label: 'Deep Research', prefix: 'Research deeply: ', hint: 'What should I research?', desc: 'Thorough investigation with sources' },
  { id: 'image', label: 'Create Image', prefix: 'Create an image of: ', hint: 'Describe the image…', desc: 'Generate visuals from a description' },
  { id: 'analyze', label: 'Analyze', prefix: 'Analyze: ', hint: 'What should I analyze?', desc: 'Break down data, text or ideas' },
  { id: 'code', label: 'Code', prefix: 'Write code for: ', hint: 'Describe what to build…', desc: 'Write and debug code' },
  { id: 'brainstorm', label: 'Brainstorm', prefix: 'Brainstorm ideas for: ', hint: 'What should we brainstorm?', desc: 'Divergent ideas, then converge' },
];

const RECENT_ICONS = [MessageSquare, ImageIcon, FileText, ImageIcon, Code2];

export function HomeScreen() {
  const {
    status, statusText, language, setView, setVoiceOpen, conversations,
    selectConversation, connection, status: agentStatus, setToolsOpen, settings,
    toast,
  } = useApp();
  const s = getStrings(language === 'hi' ? 'hi' : 'en');
  const greet = greetingFor(new Date(), language);
  const recent = conversations.slice(0, 5);
  const [tab, setTab] = useState<HomeTab>('chat');
  const [mode, setMode] = useState<ComposerMode>(MODES[0]);

  // Proactive and Ready State hooks
  const [notices] = useState(() => MetaIoidNoticedEngine.getNotices());
  const [pickUp] = useState(() => MetaIoidNoticedEngine.getPickUpContext());
  const [readyReport] = useState(() => SystemReadyEngine.getInstantStatus());

  const onTab = (t: HomeTab) => {
    setTab(t);
    if (t === 'vision') setView('live');
    else if (t === 'agents') setToolsOpen(true);
  };

  const handleGlobalStop = () => {
    const res = GlobalStopController.stopAll();
    toast({ title: 'MetaIoid Stopped', desc: res.message });
  };

  return (
    <div className="max-w-[1360px] mx-auto px-4 sm:px-6 pt-5 sm:pt-7 pb-32 md:pb-12">
      <div className="xl:grid xl:grid-cols-[1fr_320px] xl:gap-8 items-start">
        {/* ============ CENTER STAGE ============ */}
        <div className="min-w-0">
          <TopBar tab={tab} onTab={onTab} />

          {/* METAIOID LIVE status header */}
          <div className="flex flex-col items-center justify-center text-center mt-4 mb-2">
            <MetaIoidLockup variant="live" size="md" />
            <div className="mt-1.5 text-[12px] text-[var(--fg-muted)]">
              {readyReport.headline} &middot; {readyReport.summary}
            </div>
          </div>

          {/* "Pick up where we left off" banner if previous work is active */}
          {pickUp && pickUp.hasOpenWork && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-3 max-w-[720px] mx-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5 flex items-center justify-between gap-3 shadow-sm"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                </div>
                <div className="min-w-0">
                  <span className="text-[10.5px] font-bold tracking-wider text-[var(--fg-muted)] uppercase block">Pick up where we left off</span>
                  <p className="text-[13.5px] font-medium text-[var(--fg)] truncate">{pickUp.subtitle}</p>
                  <p className="text-[11.5px] text-[var(--fg-muted)] truncate">{pickUp.lastActiveStep} ({pickUp.progressPercent}%)</p>
                </div>
              </div>
              <button
                onClick={() => setView('chat')}
                className="btn-primary text-[12px] px-3.5 py-1.5 rounded-xl shrink-0 inline-flex items-center gap-1.5"
              >
                Continue <ArrowRight size={13} />
              </button>
            </motion.div>
          )}

          {/* "MetaIoid noticed…" signature proactive card */}
          {notices.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-3 max-w-[720px] mx-auto rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)]/60 backdrop-blur-md p-3.5 flex items-center justify-between gap-3 text-left"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-[12px] font-semibold text-amber-400 shrink-0">MetaIoid noticed:</span>
                <span className="text-[12.5px] text-[var(--fg)] truncate">{notices[0].message}</span>
              </div>
              {notices[0].actionLabel && (
                <button
                  onClick={() => {
                    if (notices[0].type === 'open_loop') setView('chat');
                    else setToolsOpen(true);
                  }}
                  className="text-[11.5px] text-[var(--accent)] hover:underline shrink-0 font-medium ml-2"
                >
                  {notices[0].actionLabel}
                </button>
              )}
            </motion.div>
          )}

          {/* Black hole hero — interactive WebGL stage (drag on desktop). */}
          <motion.div
            initial={{ opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6 }}
            className="mt-4"
          >
            <div
              id="home-orb-anchor"
              className="relative overflow-hidden rounded-[28px] border border-white/[0.08] bg-[#07080d] h-[340px] sm:h-[420px] lg:h-[460px] shadow-card"
            >
              <Suspense
                fallback={
                  <div
                    className="absolute inset-0"
                    style={{ background: 'radial-gradient(60% 55% at 50% 46%, rgba(150,170,220,0.14), transparent 70%), #07080d' }}
                    aria-hidden="true"
                  />
                }
              >
                <BlackHoleStage className="absolute inset-0" />
              </Suspense>

              {/* cinematic edge blend + vignette (non-interactive) */}
              <div
                className="pointer-events-none absolute inset-0"
                style={{ background: 'radial-gradient(120% 90% at 50% 45%, transparent 55%, rgba(4,5,9,0.55) 100%)' }}
                aria-hidden="true"
              />

              {/* overlay chrome */}
              <div className="pointer-events-none absolute inset-0 flex">
                <div className="hidden lg:flex flex-col justify-center gap-2.5 pl-8 text-[10.5px] font-semibold tracking-[0.42em] text-zinc-500" aria-hidden="true">
                  {['THINK', 'CREATE', 'EXPLORE', 'SOLVE', 'TOGETHER'].map((w) => <span key={w}>{w}</span>)}
                  <span className="mt-2 h-px w-16 bg-white/15" />
                </div>
                <div className="flex-1" />
                <div className="hidden md:flex flex-col justify-center pr-8 text-right items-end" aria-hidden="true">
                  <MetaIoidWordmark height={16} className="invert" />
                  <p className="mt-3 text-[10.5px] leading-relaxed tracking-[0.30em] text-zinc-500">
                    HIGHER INTELLIGENCE<br />FOR A BRIGHTER<br />TOMORROW.
                  </p>
                </div>
              </div>
              <div className="pointer-events-none absolute inset-x-0 bottom-4 flex flex-col items-center gap-2">
                <span
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[11px] font-semibold tracking-[0.14em] backdrop-blur-md',
                    connection === 'online'
                      ? 'border-emerald-400/25 bg-black/40 text-emerald-300'
                      : 'border-white/10 bg-black/40 text-zinc-300'
                  )}
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full', connection === 'online' ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-400')} />
                  {connection === 'online' ? 'METALOID AI ONLINE' : 'LOCAL DEMO'}
                </span>
                <span className="hidden md:block text-[11px] tracking-[0.2em] text-zinc-600">DRAG TO ROTATE</span>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-center gap-2 h-5 text-[12.5px] text-[var(--fg-muted)]" aria-live="polite">
              <span className={cn('w-1.5 h-1.5 rounded-full', status === 'error' ? 'bg-red-400' : 'bg-[var(--accent)]')} />
              <span>{status !== 'idle' ? statusText : language === 'hi' ? 'मैं तैयार हूँ' : 'What are we working on?'}</span>
            </div>
          </motion.div>

          {/* composer */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.15 }}
            className="mt-4 max-w-[720px] mx-auto"
          >
            <CommandBar
              large
              onCamera={() => setView('live')}
              mode={mode}
              onModeClear={() => setMode(MODES[0])}
              onModeSelect={(m) => setMode(m)}
              availableModes={MODES}
            />
          </motion.div>

          {/* Quick modes: Research, Build, Analyze */}
          <div className="mt-3 flex items-center justify-center gap-2">
            <button
              onClick={() => setMode(MODES[1])}
              className={cn(
                "px-3.5 py-1 rounded-full text-[12px] font-medium transition-all border",
                mode.id === 'research'
                  ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                  : "bg-[var(--surface)] text-[var(--fg-muted)] border-[var(--border)] hover:border-[var(--border-strong)]"
              )}
            >
              Research
            </button>
            <button
              onClick={() => setMode(MODES[4])}
              className={cn(
                "px-3.5 py-1 rounded-full text-[12px] font-medium transition-all border",
                mode.id === 'code'
                  ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                  : "bg-[var(--surface)] text-[var(--fg-muted)] border-[var(--border)] hover:border-[var(--border-strong)]"
              )}
            >
              Build
            </button>
            <button
              onClick={() => setMode(MODES[3])}
              className={cn(
                "px-3.5 py-1 rounded-full text-[12px] font-medium transition-all border",
                mode.id === 'analyze'
                  ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                  : "bg-[var(--surface)] text-[var(--fg-muted)] border-[var(--border)] hover:border-[var(--border-strong)]"
              )}
            >
              Analyze
            </button>
          </div>

          {/* Primary Action: Talk to MetaIoid & Global Stop */}
          <div className="mt-4 flex justify-center items-center gap-3">
            <button
              onClick={() => setVoiceOpen(true)}
              className="btn-primary text-[13px] px-5 py-2 rounded-full inline-flex items-center gap-2 shadow-md hover:scale-[1.02] active:scale-[0.98] transition-all"
            >
              <Mic size={15} /> Talk to MetaIoid
            </button>
            <button
              onClick={handleGlobalStop}
              className="px-3.5 py-2 rounded-full border border-[var(--border)] bg-[var(--surface)] hover:bg-red-500/10 hover:border-red-500/30 text-[12px] text-[var(--fg-muted)] hover:text-red-400 transition-colors inline-flex items-center gap-1.5"
              title="Emergency Halt: Stop all speech, pause background tasks, keep completed work"
            >
              <StopCircle size={13} /> Stop all
            </button>
          </div>

          {/* LIVE ACTIVITY Quiet HUD */}
          <div className="mt-6 max-w-[720px] mx-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-bold tracking-[0.16em] text-[var(--fg-muted)] uppercase">Live Activity</span>
              <span className="text-[11px] text-emerald-400 flex items-center gap-1.5 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> All systems nominal
              </span>
            </div>
            <div className="space-y-2.5 text-[12.5px]">
              <div className="flex items-center justify-between text-[var(--fg)]">
                <span className="flex items-center gap-2 text-[var(--fg-muted)]">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Voice system
                </span>
                <span className="font-medium">Ready</span>
              </div>
              <div className="flex items-center justify-between text-[var(--fg)]">
                <span className="flex items-center gap-2 text-[var(--fg-muted)]">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Research engine
                </span>
                <span className="font-medium">Standing by</span>
              </div>
              <div className="flex items-center justify-between text-[var(--fg)]">
                <span className="flex items-center gap-2 text-[var(--fg-muted)]">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> MetaIoid UI & Runtime
                </span>
                <span className="font-medium">Autonomous Verified</span>
              </div>
            </div>
          </div>

          {/* recent (below xl) */}
          <div className="mt-10 max-w-[720px] mx-auto xl:hidden">
            <RecentList compact />
          </div>

        </div>

        {/* ============ RIGHT RAIL (xl) ============ */}
        <aside className="hidden xl:flex flex-col gap-4 w-[320px] shrink-0" aria-label="Context">
          {/* user chip */}
          <button
            onClick={() => setView('settings')}
            className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 hover:bg-[var(--surface-hover)] transition-colors text-left"
          >
            <span className="w-10 h-10 rounded-xl bg-[var(--surface-elevated)] border border-[var(--border-strong)] text-[var(--accent)] font-semibold flex items-center justify-center text-[15px]">
              A
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[12px] text-[var(--fg-muted)]">{greet}</span>
              <span className="block text-[14px] font-medium text-[var(--fg)] truncate">Aryan</span>
            </span>
            <ChevronDown size={15} className="text-[var(--fg-muted)]" />
          </button>

          {/* recent conversations */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex items-center mb-2">
              <span className="text-[13px] font-semibold text-[var(--fg)]">Recent Conversations</span>
              <button
                onClick={() => setView('history')}
                className="ml-auto text-[12px] text-[var(--fg-muted)] hover:text-[var(--fg)] flex items-center gap-1 transition-colors"
              >
                All <ArrowUpRight size={13} />
              </button>
            </div>
            {recent.length === 0 ? (
              <p className="text-[12.5px] text-[var(--fg-muted)] py-4 text-center">No recent conversations.</p>
            ) : (
              <div className="divide-y divide-[var(--border-subtle)]">
                {recent.map((c, i) => {
                  const Icon = RECENT_ICONS[i % RECENT_ICONS.length];
                  return (
                    <button
                      key={c.id}
                      onClick={() => selectConversation(c.id)}
                      className="w-full flex items-center gap-3 py-2.5 text-left group hover:bg-[var(--surface-hover)] px-2 -mx-2 rounded-xl transition-colors"
                    >
                      <span className="w-8 h-8 rounded-lg bg-[var(--surface-elevated)] border border-[var(--border)] flex items-center justify-center shrink-0">
                        <Icon size={14} className="text-[var(--fg-muted)] group-hover:text-[var(--fg)]" />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[13px] font-medium text-[var(--fg)] truncate">{c.title}</span>
                        <span className="block text-[11.5px] text-[var(--fg-muted)] truncate">{c.preview || `${c.messages.length} messages`}</span>
                      </span>
                      <span className="text-[11px] text-[var(--fg-subtle)] shrink-0">{timeAgo(c.updatedAt)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* honest status card */}
          <div
            className={cn(
              'rounded-2xl border p-4 flex items-center gap-3',
              connection === 'online'
                ? 'border-emerald-500/25 bg-emerald-500/[0.05]'
                : 'border-[var(--border)] bg-[var(--surface)]'
            )}
          >
            <span
              className={cn(
                'w-2 h-2 rounded-full shrink-0',
                connection === 'online'
                  ? 'bg-emerald-400'
                  : connection === 'checking'
                  ? 'bg-amber-300 animate-pulse'
                  : 'bg-[var(--fg-muted)]'
              )}
            />
            <span className="flex-1 min-w-0">
              <span className="block text-[13px] font-medium text-[var(--fg)] truncate">
                {connection === 'online' ? 'Gateway Online' : connection === 'checking' ? 'Probing gateway…' : 'Local Prototype'}
              </span>
              <span className="block text-[11.5px] text-[var(--fg-muted)] truncate">
                {connection === 'online' ? 'Live model connected' : 'Local mock provider'}
              </span>
            </span>
            <Equalizer live={agentStatus === 'speaking'} />
          </div>

          {/* Quick shortcuts guide */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5 text-[12px] space-y-2 text-[var(--fg-muted)]">
            <div className="flex items-center justify-between">
              <span>Command Palette</span>
              <kbd className="font-mono text-[11px] bg-[var(--surface-elevated)] border border-[var(--border)] px-1.5 py-0.5 rounded">⌘K</kbd>
            </div>
            <div className="flex items-center justify-between">
              <span>New Conversation</span>
              <kbd className="font-mono text-[11px] bg-[var(--surface-elevated)] border border-[var(--border)] px-1.5 py-0.5 rounded">⌘N</kbd>
            </div>
            <div className="flex items-center justify-between">
              <span>Voice Mode</span>
              <kbd className="font-mono text-[11px] bg-[var(--surface-elevated)] border border-[var(--border)] px-1.5 py-0.5 rounded">Space</kbd>
            </div>
          </div>
        </aside>
      </div>

      {/* Subtle footer */}
      <div className="hidden lg:flex items-center justify-between mt-12 pt-4 border-t border-[var(--border-subtle)] text-[11.5px] text-[var(--fg-muted)]">
        <span>MetaIoid &middot; Private Intelligent Agent</span>
        <span>Local-first architecture</span>
      </div>
    </div>
  );
}

function Equalizer({ live }: { live: boolean }) {
  return (
    <span className="flex items-end gap-[3px] h-5" aria-hidden>
      {[8, 15, 7, 18, 10].map((h, i) => (
        <span
          key={i}
          className={cn('w-[2.5px] rounded-full', live ? 'bg-[var(--accent)] wave-bar' : 'bg-[var(--fg-muted)]')}
          style={{ height: h, animationDelay: live ? `${i * 0.12}s` : '0s', animationPlayState: live ? 'running' : 'paused' }}
        />
      ))}
    </span>
  );
}

function RecentList({ compact = false }: { compact?: boolean }) {
  const { conversations, selectConversation, setView } = useApp();
  const recent = conversations.slice(0, 3);
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[12px] font-semibold tracking-wider uppercase text-[var(--fg-muted)]">Recent</span>
        <button onClick={() => setView('history')} className="ml-auto text-[12px] text-[var(--fg-muted)] hover:text-[var(--fg)] flex items-center gap-1 transition-colors">
          View all <ArrowUpRight size={13} />
        </button>
      </div>
      {recent.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
          <p className="text-[13px] text-[var(--fg-muted)]">No recent conversations.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-3 gap-2.5">
          {recent.map((c, i) => (
            <motion.button
              key={c.id}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.05 }}
              onClick={() => selectConversation(c.id)}
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5 text-left hover:bg-[var(--surface-hover)] transition-colors"
            >
              <div className="text-[13.5px] font-medium text-[var(--fg)] truncate">{c.title}</div>
              <div className="text-[12px] text-[var(--fg-muted)] mt-1 truncate">{c.preview || `${c.messages.length} messages`}</div>
              <div className="text-[11px] text-[var(--fg-subtle)] mt-1">{timeAgo(c.updatedAt)}</div>
            </motion.button>
          ))}
        </div>
      )}
      {void compact}
    </div>
  );
}
