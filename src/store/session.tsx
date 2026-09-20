// Session slice — owns: navigation, agent status, settings, connection,
// toasts, modal, sidebar, voice/palette/drawer overlays.
// Nothing here knows about messages or memories.

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { AgentStatus, AppSettings, ConnectionState, LanguageId, ModelId, ToastItem, ViewId } from '../lib/types';
import { storage, uid } from '../lib/storage';
import { applyTheme } from '../lib/theme';
import { allDown, checkBackend, type ServiceHealth } from '../lib/transport';

export interface ModalState {
  kind: string | null;
  payload?: unknown;
}

interface SessionValue {
  view: ViewId;
  setView: (v: ViewId) => void;
  status: AgentStatus;
  setStatus: (s: AgentStatus) => void;
  statusText: string;
  connection: ConnectionState;
  health: ServiceHealth;
  recheckConnection: () => Promise<void>;
  settings: AppSettings;
  updateSettings: (p: Partial<AppSettings>) => void;
  language: LanguageId;
  setLanguage: (l: LanguageId) => void;
  model: ModelId;
  setModel: (m: ModelId) => void;
  toasts: ToastItem[];
  toast: (t: Omit<ToastItem, 'id'>) => void;
  modal: ModalState;
  openModal: (kind: string, payload?: unknown) => void;
  closeModal: () => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (b: boolean) => void;
  voiceOpen: boolean;
  setVoiceOpen: (b: boolean) => void;
  paletteOpen: boolean;
  setPaletteOpen: (b: boolean) => void;
  toolsOpen: boolean;
  setToolsOpen: (b: boolean) => void;
  osintOpen: boolean;
  setOsintOpen: (b: boolean) => void;
  osintTarget: string;
  setOsintTarget: (t: string) => void;
  missionsOpen: boolean;
  setMissionsOpen: (b: boolean) => void;
  missionDraft: string;
  setMissionDraft: (t: string) => void;
  deviceMorphOpen: boolean;
  setDeviceMorphOpen: (b: boolean) => void;
  skillForgeOpen: boolean;
  setSkillForgeOpen: (b: boolean) => void;
  clearAllData: () => void;
}

const Ctx = createContext<SessionValue | null>(null);

export function statusLabel(s: AgentStatus): string {
  switch (s) {
    case 'listening': return 'Listening…';
    case 'thinking': return 'Thinking…';
    case 'executing': return 'Using tool…';
    case 'speaking': return 'Speaking…';
    case 'vision': return 'Looking…';
    case 'error': return 'Unavailable';
    default: return 'Ready';
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [view, setViewState] = useState<ViewId>('home');
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [settings, setSettings] = useState<AppSettings>(() => storage.loadSettings());
  const [connection, setConnection] = useState<ConnectionState>('checking');
  const [health, setHealth] = useState<ServiceHealth>(allDown);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [modal, setModal] = useState<ModalState>({ kind: null });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [osintOpen, setOsintOpen] = useState(false);
  const [osintTarget, setOsintTarget] = useState('');
  const [missionsOpen, setMissionsOpen] = useState(false);
  const [missionDraft, setMissionDraft] = useState('');
  const [deviceMorphOpen, setDeviceMorphOpen] = useState(false);
  const [skillForgeOpen, setSkillForgeOpen] = useState(false);

  useEffect(() => storage.saveSettings(settings), [settings]);

  useEffect(() => {
    applyTheme(settings);
    if (settings.theme === 'system' && typeof window !== 'undefined') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = () => applyTheme(settings);
      mq.addEventListener('change', listener);
      return () => mq.removeEventListener('change', listener);
    }
  }, [settings]);

  const recheckConnection = useCallback(async () => {
    setConnection('checking');
    const r = await checkBackend(settings.backendUrl);
    setConnection(r.state);
    setHealth(r.health);
  }, [settings.backendUrl]);

  // real backend health on boot + poll + refocus (§32/§33)
  useEffect(() => {
    let alive = true;
    checkBackend(settings.backendUrl).then((r) => {
      if (!alive) return;
      setConnection(r.state);
      setHealth(r.health);
    });
    const id = window.setInterval(async () => {
      const r = await checkBackend(settings.backendUrl);
      if (!alive) return;
      setConnection(r.state);
      setHealth(r.health);
    }, 20000);
    const onFocus = () => recheckConnection();
    window.addEventListener('focus', onFocus);
    return () => {
      alive = false;
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [settings.backendUrl, recheckConnection]);

  const toast = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = uid('toast');
    setToasts((p) => [...p.slice(-3), { ...t, id }]);
    window.setTimeout(() => setToasts((p) => p.filter((x) => x.id !== id)), 3400);
  }, []);

  const setView = useCallback((v: ViewId) => {
    setViewState(v);
    window.scrollTo({ top: 0 });
  }, []);

  const updateSettings = useCallback((p: Partial<AppSettings>) => {
    setSettings((s) => ({ ...s, ...p }));
  }, []);
  const setLanguage = useCallback((l: LanguageId) => {
    setSettings((s) => ({ ...s, defaultLanguage: l }));
  }, []);
  const setModel = useCallback((m: ModelId) => {
    setSettings((s) => ({ ...s, model: m }));
  }, []);
  const openModal = useCallback((kind: string, payload?: unknown) => setModal({ kind, payload }), []);
  const closeModal = useCallback(() => setModal({ kind: null }), []);
  const clearAllData = useCallback(() => {
    storage.clearAll();
    // slices rehydrate from storage on boot — reload for a clean slate
    window.location.reload();
  }, []);

  const value: SessionValue = {
    view, setView, status, setStatus,
    statusText: statusLabel(status),
    connection, health, recheckConnection,
    settings, updateSettings, language: settings.defaultLanguage, setLanguage,
    model: settings.model, setModel,
    toasts, toast, modal, openModal, closeModal,
    sidebarCollapsed, setSidebarCollapsed,
    voiceOpen, setVoiceOpen, paletteOpen, setPaletteOpen,
    toolsOpen, setToolsOpen,
    osintOpen, setOsintOpen, osintTarget, setOsintTarget,
    missionsOpen, setMissionsOpen, missionDraft, setMissionDraft,
    deviceMorphOpen, setDeviceMorphOpen,
    skillForgeOpen, setSkillForgeOpen,
    clearAllData,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}
