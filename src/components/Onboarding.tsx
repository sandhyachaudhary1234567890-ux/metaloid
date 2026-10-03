import { useState } from 'react';
import { useApp } from '../lib/store';
import { submitOnboarding } from '../lib/transport';
import { cn } from '../lib/cn';
import { AiSetupModal } from './setup/AiSetupModal';

const LANGS = [
  { id: 'auto', label: 'Auto', hint: 'Match my language' },
  { id: 'en', label: 'English', hint: '' },
  { id: 'hinglish', label: 'Hinglish', hint: '' },
  { id: 'hi', label: 'हिंदी', hint: '' },
];
const STYLES = [
  { id: 'balanced', label: 'Balanced', hint: 'Default depth' },
  { id: 'brief', label: 'Concise', hint: 'Short answers' },
  { id: 'detailed', label: 'Detailed', hint: 'Thorough dives' },
];
const PROACTIVITY = [
  { id: 'passive', label: 'Calm', hint: 'Only when I ask' },
  { id: 'assisted', label: 'Helpful', hint: 'Suggest next steps' },
  { id: 'proactive', label: 'Proactive', hint: 'Act ahead, tell me' },
];

export function Onboarding() {
  const { settings, refreshAuth } = useApp();
  const [subStep, setSubStep] = useState<'PROFILE' | 'AI_SETUP'>('PROFILE');
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('auto');
  const [verbosity, setVerbosity] = useState('balanced');
  const [autonomy, setAutonomy] = useState('assisted');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const saveProfileAndProceed = async () => {
    setBusy(true);
    setError('');
    try {
      await submitOnboarding(settings.backendUrl, {
        displayName: name.trim(),
        language,
        verbosity,
        autonomy,
        proactivity: autonomy,
      });
      // Move to AI setup step
      setSubStep('AI_SETUP');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save profile. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const finalizeAll = async () => {
    try {
      localStorage.setItem('metaloid_onboarding_completed', 'true');
    } catch {
      // ignore
    }
    await refreshAuth();
  };

  if (subStep === 'AI_SETUP') {
    return (
      <div className="h-full bg-[var(--bg)] text-[var(--fg)] overflow-hidden">
        <AiSetupModal onComplete={finalizeAll} canSkip={true} />
      </div>
    );
  }

  const Chip = ({ active, onClick, label, hint }: { active: boolean; onClick: () => void; label: string; hint: string }) => (
    <button
      onClick={onClick}
      className={cn(
        'rounded-xl border px-3.5 py-2.5 text-left transition-colors',
        active
          ? 'border-[var(--accent)] bg-[var(--accent)]/10'
          : 'border-[var(--border)] bg-[var(--surface-elevated)] hover:border-[var(--fg-faint)]'
      )}
    >
      <span className="block text-[13.5px] font-semibold text-[var(--fg)]">{label}</span>
      {hint && <span className="block text-[11.5px] text-[var(--fg-muted)]">{hint}</span>}
    </button>
  );

  return (
    <div className="h-full flex items-center justify-center px-4 overflow-y-auto">
      <div className="w-full max-w-[480px] py-10">
        <p className="text-[12px] font-semibold tracking-[0.18em] text-[var(--accent)]">FIRST-RUN SETUP</p>
        <h1 className="text-[24px] font-bold tracking-tight text-[var(--fg)] mt-1">Tell MetaIoid the essentials.</h1>
        <p className="text-[13.5px] text-[var(--fg-muted)] mt-1">Thirty seconds now — everything else it learns from how you use it.</p>

        <label className="block mt-6">
          <span className="text-[12px] font-medium text-[var(--fg-muted)]">What should MetaIoid call you?</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="mt-1.5 h-11 w-full rounded-xl bg-[var(--surface-elevated)] border border-[var(--border)] px-3.5 text-[14px] text-[var(--fg)] outline-none focus:border-[var(--accent)]"
          />
        </label>

        <p className="mt-5 text-[12px] font-medium text-[var(--fg-muted)]">Language</p>
        <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {LANGS.map((l) => (
            <Chip key={l.id} active={language === l.id} onClick={() => setLanguage(l.id)} label={l.label} hint={l.hint} />
          ))}
        </div>

        <p className="mt-5 text-[12px] font-medium text-[var(--fg-muted)]">Answer style</p>
        <div className="mt-1.5 grid grid-cols-3 gap-2">
          {STYLES.map((s) => (
            <Chip key={s.id} active={verbosity === s.id} onClick={() => setVerbosity(s.id)} label={s.label} hint={s.hint} />
          ))}
        </div>

        <p className="mt-5 text-[12px] font-medium text-[var(--fg-muted)]">How independent should MetaIoid be?</p>
        <div className="mt-1.5 grid grid-cols-3 gap-2">
          {PROACTIVITY.map((p) => (
            <Chip key={p.id} active={autonomy === p.id} onClick={() => setAutonomy(p.id)} label={p.label} hint={p.hint} />
          ))}
        </div>
        <p className="mt-2 text-[11.5px] text-[var(--fg-faint)]">You can change this anytime in Control Center. MetaIoid never raises it by itself.</p>

        {error && (
          <p className="mt-3 text-[13px] text-red-400" role="alert">
            {error}
          </p>
        )}

        <button
          onClick={saveProfileAndProceed}
          disabled={busy}
          className="mt-6 h-11 w-full rounded-xl bg-[var(--accent)] text-white text-[14px] font-semibold disabled:opacity-50 hover:brightness-110"
        >
          {busy ? 'Setting up…' : 'Continue to AI Setup →'}
        </button>
      </div>
    </div>
  );
}
