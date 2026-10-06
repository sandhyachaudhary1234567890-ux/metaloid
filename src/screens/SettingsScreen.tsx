import { useState } from 'react';
import { Check, Trash2, Flame, Mic2, Palette, Brain, SlidersHorizontal, Sparkles, ShieldCheck, Pause, Play } from 'lucide-react';
import { useApp } from '../lib/store';
import { SettingsSection, SettingsRow, Seg, Toggle, Select } from '../components/SettingsGroup';
import { SystemStatus } from '../components/SystemStatus';
import { AccountSection } from '../components/AccountPanel';
import { ProviderSettings } from '../components/ProviderSettings';
import { LANGUAGES, MODELS } from '../lib/i18n';
import { getVoices } from '../providers/tts';
import { THEME_PRESETS } from '../lib/theme';
import { ACCENTS } from '../design/tokens';
import { AUTONOMY_LEVELS, autonomyOption, type AutonomyLevel } from '../lib/control';
import type { LanguageId, ModelId, RadiusScale } from '../lib/types';
import { cn } from '../lib/cn';

// SETTINGS
//
// Ordered the way a person thinks about the product, not the way it is built:
//
//   Account · Appearance · AI · Voice · Memory & Research · Privacy · Advanced
//
// Everything technical — gateway address, provider diagnostics, the sandboxed
// skill runtime — lives behind Advanced. A user who never opens Advanced
// should never learn that any of it exists.

const SECTIONS = [
  { id: 'account', label: 'Account' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'ai', label: 'AI' },
  { id: 'voice', label: 'Voice' },
  { id: 'memory', label: 'Memory & Research' },
  { id: 'control', label: 'Control' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'advanced', label: 'Advanced' },
];

/**
 * Voice picker that never renders an empty dropdown. When the OS exposes no
 * voice for the language (common for Hindi on desktop browsers without a
 * language pack), it shows a disabled explanatory option instead of a blank
 * box, plus a hint row pointing at the OS language settings.
 */
function VoiceSelect({
  value,
  onChange,
  voices,
  label,
  emptyHint,
}: {
  value: string;
  onChange: (v: string) => void;
  voices: string[];
  label: string;
  emptyHint: string;
}) {
  if (!voices.length) {
    return (
      <Select
        value=""
        onChange={() => {}}
        options={[{ value: '', label: emptyHint }]}
        label={label}
        className="w-[240px]"
        disabled
      />
    );
  }
  const safe = voices.includes(value) ? value : voices[0];
  return (
    <Select
      value={safe}
      onChange={onChange}
      options={voices.map((v) => ({ value: v, label: v }))}
      label={label}
      className="w-[240px]"
    />
  );
}

export function SettingsScreen() {
  const { settings, updateSettings, toast, openModal, setView, setSkillForgeOpen, pauseMetaIoid, resumeMetaIoid } = useApp();
  const saved = (msg: string) => toast({ title: msg });
  const [advanced, setAdvanced] = useState(false);
  const [appearanceMore, setAppearanceMore] = useState(false);

  const presetsList = Object.values(THEME_PRESETS);
  const voices = getVoices();

  return (
    <div className="mx-auto max-w-[760px] px-4 pb-32 pt-8 sm:px-8 md:pb-16">
      <header className="mb-9">
        <h2 className="t-display text-[var(--fg)]">Settings</h2>
        <p className="mt-1.5 max-w-[58ch] text-body text-[var(--fg-muted)] text-pretty">
          Your AI, your voice, your data — kept on this device unless you sign in.
        </p>
      </header>

      {/* Contents — a settings page a person can scan rather than scroll. */}
      <nav aria-label="Settings sections" className="mb-10 flex flex-wrap gap-1.5">
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="rounded-full border border-[var(--border)] px-3 py-1 text-small text-[var(--fg-muted)] transition-colors duration-micro ease-out hover:border-[var(--border-strong)] hover:text-[var(--fg)]"
          >
            {s.label}
          </a>
        ))}
      </nav>

      <div className="space-y-11">
        {/* ── ACCOUNT ──────────────────────────────────────────────────── */}
        <div id="account" className="scroll-mt-6">
          <AccountSection />
        </div>

        {/* ── APPEARANCE ───────────────────────────────────────────────── */}
        <SettingsSection
          id="appearance"
          icon={Palette}
          title="Appearance"
          desc="How MetaIoid looks on this device."
        >
          <SettingsRow
            label="Theme"
            hint="Switch at any time — every screen is designed for both."
            stacked
            control={
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {presetsList.map((preset) => {
                  const active = settings.theme === preset.id;
                  return (
                    <button
                      key={preset.id}
                      onClick={() => {
                        updateSettings({ theme: preset.id });
                        saved(`Theme: ${preset.name}`);
                      }}
                      aria-pressed={active}
                      className={cn(
                        'group relative flex flex-col rounded-[var(--radius-md)] border p-2.5 text-left',
                        'transition-colors duration-small ease-out',
                        active
                          ? 'border-[var(--accent)] bg-[var(--surface-elevated)]'
                          : 'border-[var(--border)] bg-[var(--surface-elevated)] hover:border-[var(--border-strong)]',
                      )}
                    >
                      {/* A faithful miniature of the theme rather than a swatch row. */}
                      <span
                        className="flex h-14 w-full items-end gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] p-1.5"
                        style={{ backgroundColor: preset.colors.bg }}
                        aria-hidden
                      >
                        <span className="h-full w-1/4 rounded-[3px]" style={{ backgroundColor: preset.colors.surface }} />
                        <span className="flex h-full flex-1 flex-col justify-end gap-1">
                          <span className="h-1.5 w-3/4 rounded-full" style={{ backgroundColor: preset.colors.fgSecondary, opacity: 0.5 }} />
                          <span className="h-1.5 w-1/2 rounded-full" style={{ backgroundColor: preset.colors.fgSubtle, opacity: 0.5 }} />
                          <span className="h-2.5 w-2/3 rounded-[3px]" style={{ backgroundColor: preset.colors.fgSecondary, opacity: 0.35 }} />
                        </span>
                      </span>
                      <span className="mt-2 flex items-center gap-1.5">
                        <span className="text-ui font-medium text-[var(--fg)]">{preset.name}</span>
                        {active && <Check size={13} className="text-[var(--accent)]" />}
                      </span>
                      <span className="mt-0.5 truncate text-micro font-normal tracking-normal text-[var(--fg-muted)]">
                        {preset.description}
                      </span>
                    </button>
                  );
                })}

                <button
                  onClick={() => {
                    updateSettings({ theme: 'system' });
                    saved('Theme: Automatic');
                  }}
                  aria-pressed={settings.theme === 'system'}
                  className={cn(
                    'flex flex-col rounded-[var(--radius-md)] border p-2.5 text-left transition-colors duration-small ease-out',
                    settings.theme === 'system'
                      ? 'border-[var(--accent)] bg-[var(--surface-elevated)]'
                      : 'border-[var(--border)] bg-[var(--surface-elevated)] hover:border-[var(--border-strong)]',
                  )}
                >
                  <span
                    className="flex h-14 w-full items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border-subtle)] text-micro font-normal tracking-normal text-[var(--fg-muted)]"
                    style={{ background: 'linear-gradient(135deg, #0E0E0D 0%, #0E0E0D 50%, #FAF8F4 50%, #FAF8F4 100%)' }}
                    aria-hidden
                  >
                    <span className="rounded-full bg-black/50 px-1.5 py-0.5 text-micro text-white/90">Auto</span>
                  </span>
                  <span className="mt-2 flex items-center gap-1.5">
                    <span className="text-ui font-medium text-[var(--fg)]">Automatic</span>
                    {settings.theme === 'system' && <Check size={13} className="text-[var(--accent)]" />}
                  </span>
                  <span className="mt-0.5 truncate text-micro font-normal tracking-normal text-[var(--fg-muted)]">
                    Matches your system
                  </span>
                </button>
              </div>
            }
          />

          <SettingsRow
            label="More options"
            hint="Accent colour, corner softness, density and motion."
            control={
              <button onClick={() => setAppearanceMore((v) => !v)} className="btn-ghost h-9 px-3 text-small" aria-expanded={appearanceMore}>
                {appearanceMore ? 'Hide' : 'Show'}
              </button>
            }
          />

          {appearanceMore && (
            <>
              <SettingsRow
                label="Accent"
                hint="Marks the active thing on a screen, the send button, and focus. Nothing else."
                stacked
                control={
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Accent colour">
                    {ACCENTS.map((acc) => {
                      const active = settings.accent === acc.id || settings.accent === acc.dark.accent;
                      return (
                        <button
                          key={acc.id}
                          onClick={() => {
                            updateSettings({ accent: acc.id });
                            saved(`Accent: ${acc.label}`);
                          }}
                          role="radio"
                          aria-checked={active}
                          title={acc.label}
                          aria-label={acc.label}
                          className={cn(
                            'flex h-8 items-center gap-2 rounded-full border pl-1 pr-3 text-small font-medium',
                            'transition-colors duration-small ease-out',
                            active
                              ? 'border-[var(--border-strong)] bg-[var(--surface-hover)] text-[var(--fg)]'
                              : 'border-transparent text-[var(--fg-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]',
                          )}
                        >
                          <span
                            className="flex h-6 w-6 items-center justify-center rounded-full"
                            style={{ backgroundColor: acc.dark.accent }}
                          >
                            {active && <Check size={12} className="text-black/70" strokeWidth={3} />}
                          </span>
                          {acc.label}
                        </button>
                      );
                    })}
                  </div>
                }
              />

              <SettingsRow
                label="Corner softness"
                control={
                  <Seg
                    options={['sharp', 'refined', 'soft'] as const}
                    value={settings.radius || 'refined'}
                    onPick={(v: RadiusScale) => {
                      updateSettings({ radius: v });
                      saved(`Corners: ${v}`);
                    }}
                    label="Corner softness"
                  />
                }
              />

              <SettingsRow
                label="Density"
                hint="Compact fits more on screen at the cost of breathing room."
                control={
                  <Seg
                    options={['comfortable', 'compact'] as const}
                    value={settings.density}
                    onPick={(v) => updateSettings({ density: v })}
                    label="Density"
                  />
                }
              />

              <SettingsRow
                label="Motion"
                hint="Reduced turns off every non-essential animation."
                control={
                  <Seg
                    options={['full', 'reduced'] as const}
                    value={settings.animations}
                    onPick={(v) => updateSettings({ animations: v })}
                    label="Motion"
                  />
                }
              />

              <SettingsRow
                label="Opening fade"
                hint="A short brand beat before the workspace appears."
                control={
                  <Toggle
                    on={settings.showStartup}
                    onFlip={() => updateSettings({ showStartup: !settings.showStartup })}
                    label="Opening fade"
                  />
                }
              />
            </>
          )}
        </SettingsSection>

        {/* ── AI ───────────────────────────────────────────────────────── */}
        <SettingsSection
          id="ai"
          icon={Sparkles}
          title="AI"
          desc="Connect the model that answers you, then shape how it answers."
        >
          {/* The connection control lives HERE, first — it is the reason most
              people open Settings, and "Connect a key to go live" used to land
              on a page with no way to connect one. */}
          <ProviderSettings />

          <SettingsRow
            label="Name"
            hint="How it introduces itself."
            control={
              <input
                value={settings.agentName}
                onChange={(e) => updateSettings({ agentName: e.target.value.toLowerCase() || 'metaloid' })}
                className="field w-44 lowercase"
                aria-label="Agent name"
              />
            }
          />

          <SettingsRow
            label="Reasoning tier"
            hint="Higher tiers think longer and cost more."
            control={
              <Select
                value={settings.model}
                onChange={(v) => updateSettings({ model: v as ModelId })}
                options={MODELS.map((m) => ({ value: m.id, label: `${m.label} — ${m.desc}` }))}
                label="Reasoning tier"
                className="w-[240px]"
              />
            }
          />

          <SettingsRow
            label="Answer length"
            control={
              <Seg
                options={['Concise', 'Balanced', 'Detailed'] as const}
                value={settings.responseLength}
                onPick={(v) => updateSettings({ responseLength: v })}
                label="Answer length"
              />
            }
          />

          <SettingsRow
            label="Tone"
            control={
              <Seg
                options={['Friendly', 'Professional', 'Minimal', 'Warm'] as const}
                value={settings.voiceBehavior}
                onPick={(v) => updateSettings({ voiceBehavior: v })}
                label="Tone"
              />
            }
          />

          <SettingsRow
            label="Language"
            hint="MetaIoid switches automatically unless you pin one."
            stacked
            control={
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {LANGUAGES.map((l) => {
                  const active = settings.defaultLanguage === l.id;
                  return (
                    <button
                      key={l.id}
                      onClick={() => {
                        updateSettings({ defaultLanguage: l.id as LanguageId });
                        saved(`Language: ${l.label}`);
                      }}
                      aria-pressed={active}
                      className={cn(
                        'rounded-[var(--radius-md)] border px-3 py-2 text-left transition-colors duration-small ease-out',
                        active
                          ? 'border-[var(--accent)] bg-[var(--accent-subtle)]'
                          : 'border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]',
                      )}
                    >
                      <span className={cn('block text-ui font-medium', active ? 'text-[var(--fg)]' : 'text-[var(--fg-secondary)]')}>
                        {l.label}
                      </span>
                      <span className="block truncate text-micro font-normal tracking-normal text-[var(--fg-muted)]">
                        {l.native}
                      </span>
                    </button>
                  );
                })}
              </div>
            }
          />
        </SettingsSection>

        {/* ── VOICE ────────────────────────────────────────────────────── */}
        <SettingsSection
          id="voice"
          icon={Mic2}
          title="Voice"
          desc="How MetaIoid listens, and how it sounds when it speaks."
        >
          <SettingsRow
            label="Voice"
            hint="Turns the microphone and spoken replies on or off."
            control={
              <Toggle
                on={settings.voiceEnabled}
                onFlip={() => {
                  updateSettings({ voiceEnabled: !settings.voiceEnabled });
                  saved(settings.voiceEnabled ? 'Voice off' : 'Voice on');
                }}
                label="Voice"
              />
            }
          />

          <SettingsRow
            label="English voice"
            control={
              <VoiceSelect
                value={settings.englishVoice}
                onChange={(v) => updateSettings({ englishVoice: v })}
                voices={voices.filter((v) => v.lang === 'en').map((v) => v.label)}
                label="English voice"
                emptyHint="No English voices on this device"
              />
            }
          />

          <SettingsRow
            label="Hindi voice"
            hint={voices.some((v) => v.lang === 'hi') ? undefined : 'No Hindi voice is installed on this device — add one in the OS language settings to enable it.'}
            control={
              <VoiceSelect
                value={settings.hindiVoice}
                onChange={(v) => updateSettings({ hindiVoice: v })}
                voices={voices
                  .filter((v) => v.lang === 'hi')
                  .map((v) => v.label.split(' — ')[0])}
                label="Hindi voice"
                emptyHint="No Hindi voice on this device"
              />
            }
          />

          <SettingsRow
            label="Speaking rate"
            hint={`Currently ${settings.speed}×.`}
            control={
              <Seg
                options={['0.75', '1', '1.25', '1.5']}
                value={String(settings.speed)}
                onPick={(v) => updateSettings({ speed: Number(v) })}
                label="Speaking rate"
              />
            }
          />

          <SettingsRow
            label="Turn-taking"
            hint="How quickly MetaIoid decides you have finished speaking."
            control={
              <Seg
                options={['Low', 'Medium', 'High'] as const}
                value={settings.vadSensitivity}
                onPick={(v) => updateSettings({ vadSensitivity: v })}
                label="Turn-taking"
              />
            }
          />

          <SettingsRow
            label="Let me interrupt"
            hint="Speaking while MetaIoid is talking stops it immediately."
            control={
              <Toggle
                on={settings.stopOnTalk}
                onFlip={() => updateSettings({ stopOnTalk: !settings.stopOnTalk })}
                label="Let me interrupt"
              />
            }
          />
        </SettingsSection>

        {/* ── MEMORY & RESEARCH ────────────────────────────────────────── */}
        <SettingsSection
          id="memory"
          icon={Brain}
          title="Memory & Research"
          desc="What MetaIoid carries between conversations, and how deep it digs."
        >
          <SettingsRow
            label="Remember things"
            hint="Keeps preferences and project facts, so you do not repeat yourself."
            control={
              <Toggle
                on={settings.memoryEnabled}
                onFlip={() => updateSettings({ memoryEnabled: !settings.memoryEnabled })}
                label="Memory"
              />
            }
          />

          <SettingsRow
            label="Memory vault"
            hint="Review, edit or delete anything MetaIoid has remembered."
            control={
              <button
                onClick={() => setView('memory')}
                aria-label="Open memory vault"
                className="btn-ghost h-9 px-3.5 text-small"
              >
                Open
              </button>
            }
          />

          <SettingsRow
            label="Research depth"
            hint="Deeper research reads more sources and takes longer."
            control={
              <Seg
                options={['Quick', 'Standard', 'Deep'] as const}
                value={settings.responseLength === 'Detailed' ? 'Deep' : settings.responseLength === 'Concise' ? 'Quick' : 'Standard'}
                onPick={(v) =>
                  updateSettings({ responseLength: v === 'Deep' ? 'Detailed' : v === 'Quick' ? 'Concise' : 'Balanced' })
                }
                label="Research depth"
              />
            }
          />
        </SettingsSection>

        {/* ── CONTROL ──────────────────────────────────────────────────── */}
        <SettingsSection
          id="control"
          icon={ShieldCheck}
          title="Control"
          desc="What MetaIoid is allowed to do on its own, and how to stop it."
        >
          <SettingsRow
            label={settings.paused ? 'Paused' : 'Pause MetaIoid'}
            hint={
              settings.paused
                ? 'Everything in flight is held. Completed work and checkpoints are kept.'
                : 'Stops speech, holds work in progress and keeps everything already finished.'
            }
            control={
              settings.paused ? (
                <button onClick={resumeMetaIoid} className="btn-primary h-9 gap-1.5 px-3.5 text-small">
                  <Play size={13} />
                  Resume
                </button>
              ) : (
                <button onClick={pauseMetaIoid} className="btn-ghost h-9 gap-1.5 px-3.5 text-small">
                  <Pause size={13} />
                  Pause
                </button>
              )
            }
          />

          <SettingsRow
            label="What can MetaIoid do automatically?"
            hint={autonomyOption(settings.autonomy).hint}
            stacked
            control={
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Autonomy level">
                {AUTONOMY_LEVELS.map((level) => {
                  const on = settings.autonomy === level.id;
                  return (
                    <button
                      key={level.id}
                      role="radio"
                      aria-checked={on}
                      onClick={() => {
                        updateSettings({ autonomy: level.id as AutonomyLevel });
                        saved(`Autonomy: ${level.label}`);
                      }}
                      className={cn(
                        'flex flex-col rounded-[var(--radius-md)] border p-3 text-left',
                        'transition-colors duration-small ease-out',
                        on
                          ? 'border-[var(--accent)] bg-[var(--surface-elevated)]'
                          : 'border-[var(--border)] bg-[var(--surface-elevated)] hover:border-[var(--border-strong)]',
                      )}
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="text-ui font-medium text-[var(--fg)]">{level.label}</span>
                        {on && <Check size={13} className="text-[var(--accent)]" />}
                      </span>
                      <span className="mt-0.5 text-small text-[var(--fg-muted)] text-pretty">{level.hint}</span>
                    </button>
                  );
                })}
              </div>
            }
          />
        </SettingsSection>

        {/* ── PRIVACY ──────────────────────────────────────────────────── */}
        <SettingsSection
          id="privacy"
          icon={ShieldCheck}
          title="Privacy"
          desc="What stays here, and how to remove it."
        >
          <SettingsRow
            label="Where your data lives"
            hint="Conversations, memories and files stay in this browser unless you sign in to sync."
            control={<span className="text-small text-[var(--fg-muted)]">On this device</span>}
          />

          <SettingsRow
            label="Clear local data"
            hint="Removes every conversation, memory and file from this device. Cannot be undone."
            control={
              <button onClick={() => openModal('clear-data')} className="btn-danger h-9 px-3.5 text-small">
                <Trash2 size={13} />
                Clear
              </button>
            }
          />
        </SettingsSection>

        {/* ── ADVANCED ─────────────────────────────────────────────────── */}
        <SettingsSection
          id="advanced"
          icon={SlidersHorizontal}
          title="Advanced"
          desc="Diagnostics and developer surfaces. Nothing here is needed for everyday use."
        >
          <SettingsRow
            label="Gateway"
            hint="Leave blank to use the built-in demo gateway."
            control={
              <input
                value={settings.backendUrl}
                onChange={(e) => updateSettings({ backendUrl: e.target.value })}
                placeholder="http://127.0.0.1:8787"
                className="field w-[260px] font-mono text-small"
                aria-label="Gateway address"
              />
            }
          />

          <SystemStatus />

          <SettingsRow
            label="Skill runtime"
            hint="The sandboxed self-improvement engine."
            control={
              <button
                onClick={() => setSkillForgeOpen(true)}
                aria-label="Open Skill Forge"
                className="btn-ghost h-9 gap-1.5 px-3.5 text-small"
              >
                <Flame size={14} className="text-[var(--accent)]" />
                Open
              </button>
            }
          />
        </SettingsSection>
      </div>
    </div>
  );
}
