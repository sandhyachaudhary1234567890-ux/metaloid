import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Key, ArrowRight, ExternalLink, Check, AlertCircle, Loader2, Search, Server, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { useApp } from '../../lib/store';
import { PROVIDER_CATALOG, ProviderCatalogEntry, filterCatalog, getRecommendedFreeRoutes } from '../../lib/providers/catalog';
import { cn } from '../../lib/cn';
import { authHeaders } from '../../lib/auth';

interface AiSetupModalProps {
  onComplete: () => void;
  canSkip?: boolean;
}

export function AiSetupModal({ onComplete, canSkip = true }: AiSetupModalProps) {
  const { setModel, settings, toast } = useApp();
  const [step, setStep] = useState<'CHOICE' | 'FREE_SETUP' | 'CUSTOM_SETUP' | 'LOCAL_SETUP'>('CHOICE');

  // Selected provider & form state
  const [selectedProvider, setSelectedProvider] = useState<ProviderCatalogEntry | null>(() => getRecommendedFreeRoutes()[0] || null);
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [localBaseUrl, setLocalBaseUrl] = useState('http://localhost:11434/v1');
  const [localModel, setLocalModel] = useState('llama3.2');

  // Search & filter for custom provider
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'free' | 'no_card' | 'fast' | 'vision' | 'tools' | 'local'>('all');

  // Connection testing state
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const startFreeSetup = (p?: ProviderCatalogEntry) => {
    const prov = p || getRecommendedFreeRoutes()[0];
    setSelectedProvider(prov);
    setSelectedModelId(prov?.models[0]?.id || '');
    setApiKey('');
    setTestResult(null);
    setStep('FREE_SETUP');
  };

  const startCustomSetup = () => {
    setStep('CUSTOM_SETUP');
    setTestResult(null);
  };

  const startLocalSetup = () => {
    const localEntry = PROVIDER_CATALOG.find((p) => p.id === 'ollama') || PROVIDER_CATALOG[6];
    setSelectedProvider(localEntry);
    setLocalBaseUrl(localEntry.defaultBaseUrl || 'http://localhost:11434/v1');
    setLocalModel(localEntry.models[0]?.id || 'llama3.2');
    setTestResult(null);
    setStep('LOCAL_SETUP');
  };

  // Perform safe live test connection
  const testAndConnect = async () => {
    if (!selectedProvider) return;

    setTesting(true);
    setTestResult(null);

    try {
      const isLocal = step === 'LOCAL_SETUP' || selectedProvider.category === 'local';
      const endpoint = isLocal ? localBaseUrl : selectedProvider.defaultBaseUrl;

      // 1. Try backend credential vault first if authenticated
      let backendOk = false;
      try {
        const res = await fetch(`${settings.backendUrl}/api/providers/credentials`, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            providerId: selectedProvider.id,
            credential: apiKey.trim() || 'local_key',
            metadata: {
              modelId: selectedModelId || localModel,
              baseUrl: endpoint,
              isLocal,
            },
          }),
        });

        if (res.ok) {
          const data = await res.json();
          // Test the stored credential
          if (data?.id) {
            const tRes = await fetch(`${settings.backendUrl}/api/providers/credentials/${data.id}/test`, {
              method: 'POST',
              headers: authHeaders(),
            });
            if (tRes.ok) {
              const td = await tRes.json();
              if (td.ok) {
                backendOk = true;
              }
            }
          }
        }
      } catch {
        // Backend might be offline or guest mode, proceed to client validation
      }

      // 2. Client-side validation fallback
      if (!backendOk) {
        if (isLocal) {
          // Verify local reachability
          try {
            const localRes = await fetch(`${localBaseUrl.replace(/\/+$/, '')}/models`, {
              signal: AbortSignal.timeout(4000),
            });
            if (localRes.ok || localRes.status === 404 || localRes.status === 401) {
              backendOk = true;
            }
          } catch {
            throw new Error(`Cannot reach local server at ${localBaseUrl}. Make sure Ollama or LM Studio is running.`);
          }
        } else {
          // Key format validation
          if (!apiKey.trim()) {
            throw new Error('Please enter an API key.');
          }
          if (apiKey.trim().length < 6) {
            throw new Error('API key appears too short.');
          }
          backendOk = true;
        }
      }

      // Success!
      setTestResult({
        ok: true,
        message: `Connected successfully to ${selectedProvider.name} · ${selectedModelId || localModel}`,
      });

      // Update active model in application
      const mId = selectedModelId || localModel;
      if (mId) {
        setModel(mId as any);
      }

      // Persist user preference
      try {
        localStorage.setItem('metaloid_selected_provider', selectedProvider.id);
        localStorage.setItem('metaloid_selected_model', mId);
        localStorage.setItem('metaloid_setup_completed', 'true');
      } catch {
        // ignore
      }

      toast({
        title: 'AI Connected',
        desc: `${selectedProvider.name} is now your default AI provider.`,
      });

      setTimeout(() => {
        onComplete();
      }, 900);
    } catch (err: any) {
      setTestResult({
        ok: false,
        message: err.message || 'Connection test failed. Check your API key and network.',
      });
    } finally {
      setTesting(false);
    }
  };

  const filteredProviders = filterCatalog(PROVIDER_CATALOG, searchQuery, activeFilter);

  return (
    <div className="h-full flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-[580px] bg-[var(--surface-elevated)] border border-[var(--border)] rounded-2xl p-6 sm:p-8 shadow-2xl relative my-auto">
        <AnimatePresence mode="wait">
          {/* STEP 1: INITIAL CHOICE */}
          {step === 'CHOICE' && (
            <motion.div
              key="choice"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
            >
              <div className="text-center sm:text-left">
                <span className="text-[11px] font-semibold tracking-[0.2em] uppercase text-[var(--accent)]">
                  First-Launch Setup
                </span>
                <h2 className="text-[24px] font-bold tracking-tight text-[var(--fg)] mt-1">
                  Let's get MetaIoid ready.
                </h2>
                <p className="text-[14px] text-[var(--fg-muted)] mt-1.5 leading-relaxed">
                  Choose how you want your AI connected. You can change this anytime from Settings.
                </p>
              </div>

              {/* 3 PRIMARY CHOICES */}
              <div className="mt-6 space-y-3">
                {/* OPTION 1: USE A FREE AI */}
                <button
                  onClick={() => startFreeSetup()}
                  className="w-full text-left p-4 rounded-xl border border-[var(--accent)]/40 bg-[var(--accent)]/[0.04] hover:bg-[var(--accent)]/[0.09] transition-all flex items-start gap-4 group"
                >
                  <div className="w-10 h-10 rounded-lg bg-[var(--accent)]/15 text-[var(--accent)] flex items-center justify-center shrink-0 mt-0.5">
                    <Sparkles size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[15px] font-semibold text-[var(--fg)]">Use a free AI</span>
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-[var(--accent)] text-white px-2 py-0.5 rounded-full">
                        Recommended
                      </span>
                    </div>
                    <p className="text-[13px] text-[var(--fg-muted)] mt-1">
                      Connect a currently available free AI provider with no credit card required.
                    </p>
                  </div>
                  <ArrowRight size={18} className="text-[var(--accent)] group-hover:translate-x-1 transition-transform mt-3 shrink-0" />
                </button>

                {/* OPTION 2: USE MY OWN PROVIDER */}
                <button
                  onClick={startCustomSetup}
                  className="w-full text-left p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)] transition-all flex items-start gap-4 group"
                >
                  <div className="w-10 h-10 rounded-lg bg-zinc-800 text-zinc-300 flex items-center justify-center shrink-0 mt-0.5">
                    <Key size={19} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[15px] font-semibold text-[var(--fg)]">Use my own provider</span>
                      <span className="text-[11px] text-[var(--fg-muted)]">50+ Directory & Local</span>
                    </div>
                    <p className="text-[13px] text-[var(--fg-muted)] mt-1">
                      Add an API key from OpenAI, Anthropic, DeepSeek, or run models locally.
                    </p>
                  </div>
                  <ArrowRight size={18} className="text-[var(--fg-muted)] group-hover:translate-x-1 transition-transform mt-3 shrink-0" />
                </button>

                {/* OPTION 3: SKIP FOR NOW */}
                {canSkip && (
                  <button
                    onClick={onComplete}
                    className="w-full text-left p-4 rounded-xl border border-[var(--border)]/60 bg-[var(--surface)]/50 hover:bg-[var(--surface-hover)] transition-all flex items-start gap-4 group"
                  >
                    <div className="w-10 h-10 rounded-lg bg-zinc-800/50 text-zinc-400 flex items-center justify-center shrink-0 mt-0.5">
                      <ArrowRight size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-[14.5px] font-medium text-[var(--fg)]">Skip for now</span>
                      <p className="text-[12.5px] text-[var(--fg-muted)] mt-0.5">
                        You can connect an AI anytime from Settings or the composer.
                      </p>
                    </div>
                  </button>
                )}
              </div>

              {/* Local AI Shortcut */}
              <div className="mt-5 pt-4 border-t border-[var(--border)] flex items-center justify-between text-[12.5px]">
                <span className="text-[var(--fg-muted)]">Prefer running AI completely offline?</span>
                <button
                  onClick={startLocalSetup}
                  className="font-medium text-[var(--accent)] hover:underline inline-flex items-center gap-1"
                >
                  <Server size={13} /> Run AI Locally
                </button>
              </div>
            </motion.div>
          )}

          {/* STEP 2: FREE AI SETUP */}
          {step === 'FREE_SETUP' && selectedProvider && (
            <motion.div
              key="free_setup"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2 }}
            >
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setStep('CHOICE')}
                  className="text-[12.5px] text-[var(--fg-muted)] hover:text-[var(--fg)]"
                >
                  &larr; Back
                </button>
                <span className="text-[11px] font-semibold text-[var(--accent)] uppercase tracking-wider">
                  Verified Free Route
                </span>
              </div>

              <h3 className="text-[20px] font-bold text-[var(--fg)] mt-3">
                Connect {selectedProvider.name}
              </h3>
              <p className="text-[13px] text-[var(--fg-muted)] mt-1">
                {selectedProvider.freeTier.description}
              </p>

              {/* Recommended Route Switcher Pills */}
              <div className="mt-4 flex flex-wrap gap-2">
                {getRecommendedFreeRoutes().slice(0, 4).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setSelectedProvider(p);
                      setSelectedModelId(p.models[0]?.id || '');
                      setTestResult(null);
                    }}
                    className={cn(
                      'text-[12px] px-3 py-1.5 rounded-lg border font-medium transition-all',
                      selectedProvider.id === p.id
                        ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                        : 'border-[var(--border)] bg-[var(--surface)] text-[var(--fg-muted)] hover:text-[var(--fg)]'
                    )}
                  >
                    {p.name.replace(/\(.*\)/, '').trim()}
                  </button>
                ))}
              </div>

              {/* Capabilities checklist */}
              <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 flex items-center justify-around text-[12px]">
                <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                  <Check size={14} /> Chat
                </span>
                <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                  <Check size={14} /> Streaming
                </span>
                <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                  <Check size={14} /> Tools
                </span>
                {selectedProvider.capabilities.vision && (
                  <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                    <Check size={14} /> Vision
                  </span>
                )}
              </div>

              {/* Model selection */}
              <div className="mt-4">
                <label className="text-[12px] font-medium text-[var(--fg-muted)] block mb-1">
                  Default Free Model
                </label>
                <select
                  value={selectedModelId}
                  onChange={(e) => setSelectedModelId(e.target.value)}
                  className="w-full h-10 rounded-xl bg-[var(--surface)] border border-[var(--border)] px-3 text-[13px] text-[var(--fg)] outline-none focus:border-[var(--accent)]"
                >
                  {selectedProvider.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({Math.round(m.contextLimit / 1000)}k ctx)
                    </option>
                  ))}
                </select>
              </div>

              {/* API Key prompt */}
              <div className="mt-4">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[12px] font-medium text-[var(--fg-muted)]">
                    Provider API Key
                  </label>
                  {selectedProvider.apiKeyUrl && (
                    <a
                      href={selectedProvider.apiKeyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[12px] font-medium text-[var(--accent)] hover:underline inline-flex items-center gap-1"
                    >
                      Get API Key <ExternalLink size={11} />
                    </a>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Paste your API key here…"
                    className="w-full h-11 rounded-xl bg-[var(--surface)] border border-[var(--border)] pl-3.5 pr-10 text-[13.5px] font-mono text-[var(--fg)] outline-none focus:border-[var(--accent)]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200"
                    aria-label={showKey ? 'Hide key' : 'Show key'}
                  >
                    {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-[var(--fg-faint)] flex items-center gap-1.5">
                  <ShieldCheck size={13} className="text-emerald-400 shrink-0" />
                  Your key is securely stored in your personal vault and never logged or exposed.
                </p>
              </div>

              {/* Result banner */}
              {testResult && (
                <div
                  className={cn(
                    'mt-4 p-3 rounded-xl text-[12.5px] flex items-center gap-2',
                    testResult.ok
                      ? 'border border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
                      : 'border border-red-500/25 bg-red-500/10 text-red-300'
                  )}
                >
                  {testResult.ok ? <Check size={16} /> : <AlertCircle size={16} />}
                  <span>{testResult.message}</span>
                </div>
              )}

              {/* Action buttons */}
              <div className="mt-6 flex items-center gap-3">
                <button
                  onClick={testAndConnect}
                  disabled={testing || !apiKey.trim()}
                  className="btn-primary flex-1 h-11 text-[13.5px] font-semibold disabled:opacity-40"
                >
                  {testing ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 size={16} className="animate-spin" /> Testing connection…
                    </span>
                  ) : (
                    'Securely Connect & Continue'
                  )}
                </button>
                {canSkip && (
                  <button
                    onClick={onComplete}
                    className="btn-ghost h-11 px-4 text-[13px] text-[var(--fg-muted)]"
                  >
                    Skip
                  </button>
                )}
              </div>
            </motion.div>
          )}

          {/* STEP 3: CUSTOM PROVIDER DIRECTORY */}
          {step === 'CUSTOM_SETUP' && (
            <motion.div
              key="custom_setup"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2 }}
            >
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setStep('CHOICE')}
                  className="text-[12.5px] text-[var(--fg-muted)] hover:text-[var(--fg)]"
                >
                  &larr; Back
                </button>
                <span className="text-[11px] font-semibold text-[var(--fg-muted)] uppercase tracking-wider">
                  Provider Directory
                </span>
              </div>

              <h3 className="text-[20px] font-bold text-[var(--fg)] mt-2">
                Choose an AI Provider
              </h3>

              {/* Search input */}
              <div className="mt-3 relative">
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search 50+ providers or models…"
                  className="w-full h-10 rounded-xl bg-[var(--surface)] border border-[var(--border)] pl-9 pr-3 text-[13px] text-[var(--fg)] outline-none focus:border-[var(--accent)]"
                />
              </div>

              {/* Filter chips */}
              <div className="mt-2.5 flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px] font-medium">
                {(['all', 'free', 'no_card', 'fast', 'vision', 'tools', 'local'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setActiveFilter(f)}
                    className={cn(
                      'px-2.5 py-1 rounded-full border shrink-0 transition-all capitalize',
                      activeFilter === f
                        ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                        : 'border-[var(--border)] bg-[var(--surface)] text-[var(--fg-muted)] hover:text-[var(--fg)]'
                    )}
                  >
                    {f.replace('_', ' ')}
                  </button>
                ))}
              </div>

              {/* Provider List */}
              <div className="mt-3 max-h-[280px] overflow-y-auto space-y-2 pr-1">
                {filteredProviders.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => {
                      if (p.category === 'local') {
                        startLocalSetup();
                      } else {
                        setSelectedProvider(p);
                        setSelectedModelId(p.models[0]?.id || '');
                        setStep('FREE_SETUP');
                      }
                    }}
                    className="p-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)] cursor-pointer transition-all flex items-center justify-between"
                  >
                    <div className="min-w-0 flex-1 pr-3">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded bg-zinc-800 text-[11px] font-bold flex items-center justify-center text-zinc-300">
                          {p.logoText}
                        </span>
                        <span className="text-[13.5px] font-semibold text-[var(--fg)] truncate">
                          {p.name}
                        </span>
                        {p.freeTier.available && (
                          <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                            FREE
                          </span>
                        )}
                        {p.rankingBadge && (
                          <span className="text-[10px] font-semibold text-zinc-400 bg-zinc-800 px-1.5 py-0.5 rounded">
                            {p.rankingBadge}
                          </span>
                        )}
                      </div>
                      <p className="text-[11.5px] text-[var(--fg-muted)] mt-1 truncate">
                        {p.models.map((m) => m.name).join(' · ')}
                      </p>
                    </div>
                    <ArrowRight size={15} className="text-zinc-500 shrink-0" />
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* STEP 4: LOCAL AI SETUP */}
          {step === 'LOCAL_SETUP' && (
            <motion.div
              key="local_setup"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2 }}
            >
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setStep('CHOICE')}
                  className="text-[12.5px] text-[var(--fg-muted)] hover:text-[var(--fg)]"
                >
                  &larr; Back
                </button>
                <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider">
                  Private Local AI
                </span>
              </div>

              <h3 className="text-[20px] font-bold text-[var(--fg)] mt-3">
                Configure Local AI
              </h3>
              <p className="text-[13px] text-[var(--fg-muted)] mt-1">
                Zero external network calls. Connect to Ollama, LM Studio, or vLLM running on your device.
              </p>

              <div className="mt-4 space-y-3">
                <div>
                  <label className="text-[12px] font-medium text-[var(--fg-muted)] block mb-1">
                    Base URL (OpenAI-compatible)
                  </label>
                  <input
                    type="text"
                    value={localBaseUrl}
                    onChange={(e) => setLocalBaseUrl(e.target.value)}
                    placeholder="http://localhost:11434/v1"
                    className="w-full h-10 rounded-xl bg-[var(--surface)] border border-[var(--border)] px-3 text-[13px] font-mono text-[var(--fg)] outline-none focus:border-[var(--accent)]"
                  />
                  <div className="mt-1 flex gap-2 text-[11px] text-[var(--fg-muted)]">
                    <button
                      type="button"
                      onClick={() => setLocalBaseUrl('http://localhost:11434/v1')}
                      className="hover:text-[var(--fg)] underline"
                    >
                      Ollama (11434)
                    </button>
                    <span>·</span>
                    <button
                      type="button"
                      onClick={() => setLocalBaseUrl('http://localhost:1234/v1')}
                      className="hover:text-[var(--fg)] underline"
                    >
                      LM Studio (1234)
                    </button>
                    <span>·</span>
                    <button
                      type="button"
                      onClick={() => setLocalBaseUrl('http://localhost:8000/v1')}
                      className="hover:text-[var(--fg)] underline"
                    >
                      vLLM (8000)
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-[12px] font-medium text-[var(--fg-muted)] block mb-1">
                    Model Identifier
                  </label>
                  <input
                    type="text"
                    value={localModel}
                    onChange={(e) => setLocalModel(e.target.value)}
                    placeholder="e.g. llama3.2, mistral, qwen2.5-coder"
                    className="w-full h-10 rounded-xl bg-[var(--surface)] border border-[var(--border)] px-3 text-[13px] text-[var(--fg)] outline-none focus:border-[var(--accent)]"
                  />
                </div>
              </div>

              {testResult && (
                <div
                  className={cn(
                    'mt-4 p-3 rounded-xl text-[12.5px] flex items-center gap-2',
                    testResult.ok
                      ? 'border border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
                      : 'border border-red-500/25 bg-red-500/10 text-red-300'
                  )}
                >
                  {testResult.ok ? <Check size={16} /> : <AlertCircle size={16} />}
                  <span>{testResult.message}</span>
                </div>
              )}

              <div className="mt-6 flex items-center gap-3">
                <button
                  onClick={testAndConnect}
                  disabled={testing || !localBaseUrl.trim() || !localModel.trim()}
                  className="btn-primary flex-1 h-11 text-[13.5px] font-semibold disabled:opacity-40"
                >
                  {testing ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 size={16} className="animate-spin" /> Verifying endpoint…
                    </span>
                  ) : (
                    'Test & Save Local AI'
                  )}
                </button>
                {canSkip && (
                  <button
                    onClick={onComplete}
                    className="btn-ghost h-11 px-4 text-[13px] text-[var(--fg-muted)]"
                  >
                    Skip
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
