import { Palette, Mic2, Globe2, Cpu, Brain, ShieldCheck, Plug, Server, Keyboard, Trash2, Check, Flame } from 'lucide-react';
import { useApp } from '../lib/store';
import { SettingsSection, SettingsRow, Seg, Toggle } from '../components/SettingsGroup';
import { SystemStatus } from '../components/SystemStatus';
import { LANGUAGES, MODELS } from '../lib/i18n';
import { getVoices } from '../providers/tts';
import { THEME_PRESETS, ACCENT_PALETTES, type ThemePreset } from '../lib/theme';
import type { LanguageId, ModelId, ThemeId, RadiusScale } from '../lib/types';
import { cn } from '../lib/cn';

// SETTINGS — organized by user intent:
// Appearance · Voice · Language · Agent · Memory · Privacy · Connections · System.
// Zero theme flash, instant live switching, curated presets.

export function SettingsScreen() {
  const { settings, updateSettings, toast, openModal, setView, connection, setSkillForgeOpen } = useApp();
  const saved = (msg: string) => toast({ title: msg });

  const presetsList = Object.values(THEME_PRESETS);

  return (
    <div className="max-w-[860px] mx-auto px-4 sm:px-8 py-6 pb-32 md:pb-12 space-y-4">
      <div>
        <h2 className="text-[22px] font-bold tracking-tight text-[var(--fg)]">Settings</h2>
        <p className="text-[13.5px] text-[var(--fg-muted)] mt-0.5">
          Configure {settings.agentName} &middot; All preferences are preserved locally on this device.
        </p>
      </div>

      {/* ============ APPEARANCE ============ */}
      <SettingsSection icon={Palette} title="Appearance & Visual System" desc="Curated theme presets, signature accents, and border geometry">
        {/* Curated Theme Preset Grid */}
        <div className="space-y-2">
          <div className="text-[13px] font-medium text-[var(--fg)]">Theme Preset</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {presetsList.map((preset) => {
              const active = settings.theme === preset.id;
              return (
                <button
                  key={preset.id}
                  onClick={() => {
                    updateSettings({ theme: preset.id });
                    saved(`Theme: ${preset.name}`);
                  }}
                  className={cn(
                    'relative flex flex-col p-3 rounded-2xl border text-left transition-all duration-150',
                    active
                      ? 'border-[var(--accent)] ring-2 ring-[var(--accent-subtle)] bg-[var(--surface-elevated)]'
                      : 'border-[var(--border)] bg-[var(--surface-sunken)] hover:border-[var(--border-strong)]'
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[13px] font-semibold text-[var(--fg)]">{preset.name}</span>
                    {active && <Check size={14} className="text-[var(--accent)]" />}
                  </div>

                  {/* Visual palette swatch */}
                  <div
                    className="w-full h-10 rounded-lg p-1.5 flex items-center gap-1.5 border border-white/10"
                    style={{ backgroundColor: preset.colors.bg }}
                  >
                    <div
                      className="w-5 h-5 rounded-md border border-white/10"
                      style={{ backgroundColor: preset.colors.surface }}
                    />
                    <div
                      className="w-5 h-5 rounded-md border border-white/10"
                      style={{ backgroundColor: preset.colors.surfaceElevated }}
                    />
                    <span
                      className="text-[10px] ml-auto font-mono uppercase px-1.5 py-0.5 rounded border border-white/10"
                      style={{ color: preset.colors.fgSecondary }}
                    >
                      {preset.type}
                    </span>
                  </div>

                  <p className="text-[11.5px] text-[var(--fg-muted)] mt-2 line-clamp-1">{preset.description}</p>
                </button>
              );
            })}

            {/* System auto preset */}
            <button
              onClick={() => {
                updateSettings({ theme: 'system' });
                saved('Theme: System auto');
              }}
              className={cn(
                'relative flex flex-col p-3 rounded-2xl border text-left transition-all duration-150',
                settings.theme === 'system'
                  ? 'border-[var(--accent)] ring-2 ring-[var(--accent-subtle)] bg-[var(--surface-elevated)]'
                  : 'border-[var(--border)] bg-[var(--surface-sunken)] hover:border-[var(--border-strong)]'
              )}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-semibold text-[var(--fg)]">System Auto</span>
                {settings.theme === 'system' && <Check size={14} className="text-[var(--accent)]" />}
              </div>
              <div className="w-full h-10 rounded-lg p-1.5 flex items-center justify-center border border-[var(--border)] bg-[var(--surface)] text-[11px] text-[var(--fg-muted)]">
                Syncs with OS
              </div>
              <p className="text-[11.5px] text-[var(--fg-muted)] mt-2">Automatically matches system dark / light mode</p>
            </button>
          </div>
        </div>

        {/* Accent Color Palette */}
        <SettingsRow
          label="Signature Accent"
          hint="Restrained focal point across buttons, active states, and indicators"
          control={
            <div className="flex flex-wrap gap-2">
              {ACCENT_PALETTES.map((acc) => {
                const active = settings.accent === acc.hex;
                return (
                  <button
                    key={acc.id}
                    onClick={() => {
                      updateSettings({ accent: acc.hex });
                      saved(`Accent: ${acc.label}`);
                    }}
                    title={acc.label}
                    aria-label={`Accent ${acc.label}`}
                    aria-pressed={active}
                    className={cn(
                      'w-8 h-8 rounded-full border-2 transition-all flex items-center justify-center',
                      active ? 'border-[var(--fg)] scale-110 shadow-sm' : 'border-transparent hover:scale-105'
                    )}
                    style={{ backgroundColor: acc.hex }}
                  >
                    {active && <Check size={13} className="text-white" />}
                  </button>
                );
              })}
            </div>
          }
        />

        {/* Radius Scale */}
        <SettingsRow
          label="Corner Radius"
          hint="Controls the physical curvature scale across the interface"
          control={
            <Seg
              options={['sharp', 'refined', 'soft'] as const}
              value={settings.radius || 'refined'}
              onPick={(v: RadiusScale) => {
                updateSettings({ radius: v });
                saved(`Radius: ${v}`);
              }}
              label="Corner Radius"
            />
          }
        />

        {/* Density */}
        <SettingsRow
          label="Information Density"
          control={
            <Seg
              options={['comfortable', 'compact'] as const}
              value={settings.density}
              onPick={(v) => updateSettings({ density: v })}
              label="Density"
            />
          }
        />

        {/* Animations */}
        <SettingsRow
          label="Motion & Transitions"
          hint="Reduced eliminates animated transitions"
          control={
            <Seg
              options={['full', 'reduced'] as const}
              value={settings.animations}
              onPick={(v) => updateSettings({ animations: v })}
              label="Animations"
            />
          }
        />

        {/* Startup animation */}
        <SettingsRow
          label="Startup sequence"
          hint="Cinematic telemetry boot into workspace"
          control={
            <Toggle
              on={settings.showStartup}
              onFlip={() => updateSettings({ showStartup: !settings.showStartup })}
              label="Startup animation"
            />
          }
        />
      </SettingsSection>

      {/* ============ VOICE ============ */}
      <SettingsSection icon={Mic2} title="Voice Engine" desc="Streaming speech synthesis and dynamic endpoint sensitivity">
        <SettingsRow
          label="Voice interaction enabled"
          control={
            <Toggle
              on={settings.voiceEnabled}
              onFlip={() => {
                updateSettings({ voiceEnabled: !settings.voiceEnabled });
                saved(settings.voiceEnabled ? 'Voice disabled' : 'Voice enabled');
              }}
              label="Voice enabled"
            />
          }
        />
        <SettingsRow
          label="Preferred Hindi voice"
          control={
            <select
              value={settings.hindiVoice}
              onChange={(e) => updateSettings({ hindiVoice: e.target.value })}
              className="h-10 rounded-xl bg-[var(--surface-elevated)] border border-[var(--border)] px-3 text-[13px] text-[var(--fg)] outline-none"
              aria-label="Hindi voice"
            >
              {getVoices().filter((v) => v.lang === 'hi').map((v) => (
                <option key={v.id} value={v.label.split(' — ')[0]} className="bg-[var(--surface)] text-[var(--fg)]">
                  {v.label.split(' — ')[0]}
                </option>
              ))}
            </select>
          }
        />
        <SettingsRow
          label="Preferred English voice"
          control={
            <select
              value={settings.englishVoice}
              onChange={(e) => updateSettings({ englishVoice: e.target.value })}
              className="h-10 rounded-xl bg-[var(--surface-elevated)] border border-[var(--border)] px-3 text-[13px] text-[var(--fg)] outline-none"
              aria-label="English voice"
            >
              {getVoices().filter((v) => v.lang === 'en').map((v) => (
                <option key={v.id} value={v.label} className="bg-[var(--surface)] text-[var(--fg)]">
                  {v.label}
                </option>
              ))}
            </select>
          }
        />
        <SettingsRow
          label="Voice speed"
          hint={`${settings.speed}x`}
          control={
            <Seg
              options={['0.75', '1', '1.25', '1.5']}
              value={String(settings.speed)}
              onPick={(v) => updateSettings({ speed: Number(v) })}
              label="Voice speed"
            />
          }
        />
        <SettingsRow
          label="Speech endpoint sensitivity"
          hint="Higher sensitivity for rapid conversational turn-taking"
          control={
            <Seg
              options={['Low', 'Medium', 'High'] as const}
              value={settings.vadSensitivity}
              onPick={(v) => updateSettings({ vadSensitivity: v })}
              label="Mic sensitivity"
            />
          }
        />
        <SettingsRow
          label="Barge-in interrupt"
          hint="Instantly cancels agent playback when speech is detected"
          control={
            <Toggle
              on={settings.stopOnTalk}
              onFlip={() => updateSettings({ stopOnTalk: !settings.stopOnTalk })}
              label="Stop on talk"
            />
          }
        />
      </SettingsSection>

      {/* ============ LANGUAGE ============ */}
      <SettingsSection icon={Globe2} title="Language" desc="Automatic detection with first-class Hindi, Hinglish, and English">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
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
                  'min-h-[48px] rounded-xl border text-[13px] font-medium transition-all px-3 py-2 text-left',
                  active
                    ? 'border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--fg)]'
                    : 'border-[var(--border)] bg-[var(--surface)] text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)]'
                )}
              >
                <div>{l.label}</div>
                <div className="text-[11px] text-[var(--fg-muted)]">{l.native}</div>
              </button>
            );
          })}
        </div>
      </SettingsSection>

      {/* ============ AGENT ============ */}
      <SettingsSection icon={Cpu} title="Agent Personality" desc="Name, model intelligence tier, and response profile">
        <SettingsRow
          label="Agent name"
          control={
            <input
              value={settings.agentName}
              onChange={(e) => updateSettings({ agentName: e.target.value.toLowerCase() || 'metaloid' })}
              className="h-10 w-44 rounded-xl bg-[var(--surface-elevated)] border border-[var(--border)] px-3 text-[13px] text-[var(--fg)] outline-none lowercase"
              aria-label="Agent name"
            />
          }
        />
        <SettingsRow
          label="Reasoning tier"
          control={
            <select
              value={settings.model}
              onChange={(e) => updateSettings({ model: e.target.value as ModelId })}
              className="h-10 rounded-xl bg-[var(--surface-elevated)] border border-[var(--border)] px-3 text-[13px] text-[var(--fg)] outline-none"
              aria-label="Model"
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id} className="bg-[var(--surface)] text-[var(--fg)]">
                  {m.label} &mdash; {m.desc}
                </option>
              ))}
            </select>
          }
        />
        <SettingsRow
          label="Response depth"
          control={
            <Seg
              options={['Concise', 'Balanced', 'Detailed'] as const}
              value={settings.responseLength}
              onPick={(v) => updateSettings({ responseLength: v })}
              label="Response length"
            />
          }
        />
        <SettingsRow
          label="Tone style"
          control={
            <Seg
              options={['Friendly', 'Professional', 'Minimal', 'Warm'] as const}
              value={settings.voiceBehavior}
              onPick={(v) => updateSettings({ voiceBehavior: v })}
              label="Voice behavior"
            />
          }
        />
      </SettingsSection>

      {/* ============ MEMORY & PRIVACY ============ */}
      <SettingsSection icon={Brain} title="Memory & Privacy" desc="Local durable memory and zero telemetry leak guarantees">
        <SettingsRow
          label="Durable memory enabled"
          hint="Allows agent to retain key user preferences and project facts locally"
          control={
            <Toggle
              on={settings.memoryEnabled}
              onFlip={() => updateSettings({ memoryEnabled: !settings.memoryEnabled })}
              label="Memory enabled"
            />
          }
        />
        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <button
            onClick={() => setView('memory')}
            className="btn-ghost h-10 px-4 text-[13px] flex-1"
          >
            Open Memory Vault
          </button>
          <button
            onClick={() => openModal('clear-data')}
            className="btn-danger h-10 px-4 text-[13px]"
          >
            <Trash2 size={14} /> Clear Local Data
          </button>
        </div>
      </SettingsSection>

      {/* ============ CONNECTIONS & SYSTEM ============ */}
      <SettingsSection icon={Plug} title="Gateway & System Status" desc="Backend service status and keyboard accelerators">
        <SettingsRow
          label="Backend Gateway URL"
          hint="Empty uses on-device mock transport"
          control={
            <input
              value={settings.backendUrl}
              onChange={(e) => updateSettings({ backendUrl: e.target.value })}
              placeholder="http://127.0.0.1:8787"
              className="h-10 w-56 rounded-xl bg-[var(--surface-elevated)] border border-[var(--border)] px-3 text-[12.5px] font-mono text-[var(--fg)] outline-none"
              aria-label="Backend URL"
            />
          }
        />
        <SystemStatus />
      </SettingsSection>

      {/* ============ DEVELOPER / OWNER & SKILL FORGE ============ */}
      <SettingsSection icon={Flame} title="Developer / Owner &middot; Skill Forge" desc="Autonomous continuous self-improvement engine, sandboxed workers, benchmarks, and canary rollback">
        <SettingsRow
          label="Continuous Skill Engine"
          hint="Self-improvement loop with zero-credential sandboxed worker isolation"
          control={
            <span className="text-[11px] font-mono uppercase px-2 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
              Active &middot; Sandboxed
            </span>
          }
        />
        <div className="pt-2">
          <button
            onClick={() => setSkillForgeOpen(true)}
            className="w-full h-11 rounded-xl text-[13px] font-semibold border border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)] hover:opacity-90 flex items-center justify-center gap-2 transition-all"
          >
            <Flame size={16} /> Open Skill Forge & Continuous Engine
          </button>
        </div>
      </SettingsSection>
    </div>
  );
}
