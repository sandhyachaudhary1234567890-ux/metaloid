// Session slice — owns: navigation, agent status, settings, connection,
// toasts, modal, sidebar, voice/palette/drawer overlays.
// Nothing here knows about messages or memories.

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { AgentStatus, AppSettings, ConnectionState, LanguageId, ModelId, ToastItem, ViewId } from '../lib/types';
import { storage, uid, setActiveUser, claimLegacyForUser } from '../lib/storage';
import { watchTheme } from '../lib/theme';
import { allDown, checkBackend, type ServiceHealth } from '../lib/transport';
import {
  getSession, setSession as saveSession, clearSession, onSessionChange,
  type AuthUser,
} from '../lib/auth';
import { GlobalStopController } from '../lib/ready/globalStop';
import { InitiativeEngine } from '../lib/agent/initiativeEngine';
import { autonomyToPolicy } from '../lib/control';
import { saveSbSession, sbAccessToken, sbRefreshToken, sbSignOut } from '../lib/supabaseAuth';
import { authSignup as apiSignup, authLogin as apiLogin, authLogout as apiLogout, fetchMe as apiMe } from '../lib/transport';

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
  closeToast: (id: string) => void;
  modal: ModalState;
  openModal: (kind: string, payload?: unknown) => void;
  closeModal: () => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (b: boolean) => void;
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: (b: boolean) => void;
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
  skillForgeOpen: boolean;
  setSkillForgeOpen: (b: boolean) => void;
  skillsOpen: boolean;
  setSkillsOpen: (b: boolean) => void;
  liveTaskId: string | null;
  setLiveTaskId: (id: string | null) => void;
  /** Hold everything MetaIoid is doing. Completed work is preserved. */
  pauseMetaIoid: () => void;
  /** Release the hold and let work continue. */
  resumeMetaIoid: () => void;
  /** Text dropped into the composer from elsewhere (home, pulse, palette). */
  composerDraft: string;
  setComposerDraft: (s: string) => void;
  clearAllData: () => void;
  // ---- identity (multi-user) ----
  authUser: AuthUser | null;
  authReady: boolean;
  onboardingDone: boolean;
  signup: (handle: string, displayName: string, passcode: string) => Promise<void>;
  login: (handle: string, passcode: string) => Promise<void>;
  loginWithSupabase: (accessToken: string, refreshToken: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<void>;
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
  const [view, setViewState] = useState<ViewId>('chat');
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [settings, setSettings] = useState<AppSettings>(() => storage.loadSettings());
  const [connection, setConnection] = useState<ConnectionState>('checking');
  const [health, setHealth] = useState<ServiceHealth>(allDown);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [modal, setModal] = useState<ModalState>({ kind: null });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [osintOpen, setOsintOpen] = useState(false);
  const [osintTarget, setOsintTarget] = useState('');
  const [missionsOpen, setMissionsOpen] = useState(false);
  const [missionDraft, setMissionDraft] = useState('');
  const [skillForgeOpen, setSkillForgeOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [liveTaskId, setLiveTaskId] = useState<string | null>(null);
  const [composerDraft, setComposerDraft] = useState('');

  // ---- identity: session → namespaced stores → full context switch ----
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => getSession()?.user || null);
  const [authReady, setAuthReady] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);

  const applySessionUser = useCallback((u: AuthUser | null, onboarded?: boolean) => {
    setActiveUser(u ? u.id : null);
    setAuthUser(u);
    if (u) claimLegacyForUser();
    if (onboarded !== undefined) setOnboardingDone(onboarded);
  }, []);

  const signup = useCallback(async (handle: string, displayName: string, passcode: string) => {
    const r = await apiSignup(settings.backendUrl, handle, displayName, passcode);
    saveSession({ access: r.access, refresh: r.refresh, user: r.user });
    applySessionUser(r.user, !!(r.profile as { onboardingDone?: boolean }).onboardingDone);
    window.location.reload(); // slices rehydrate from the new namespace
  }, [settings.backendUrl, applySessionUser]);

  const login = useCallback(async (handle: string, passcode: string) => {
    const r = await apiLogin(settings.backendUrl, handle, passcode);
    saveSession({ access: r.access, refresh: r.refresh, user: r.user });
    applySessionUser(r.user, !!(r.profile as { onboardingDone?: boolean }).onboardingDone);
    window.location.reload();
  }, [settings.backendUrl, applySessionUser]);

  // Supabase email session: the sb access_token IS the gateway Bearer token
  // (gateway accepts it as sb:<uuid>). Validated via /me before reload.
  const loginWithSupabase = useCallback(async (accessToken: string, refreshToken: string) => {
    saveSbSession({ access_token: accessToken, refresh_token: refreshToken } as unknown as Parameters<typeof saveSbSession>[0]);
    saveSession({ access: accessToken, refresh: refreshToken, user: { id: 'sb:pending', handle: 'email', displayName: '', role: 'user', createdAt: '' } });
    try {
      const me = await apiMe(settings.backendUrl);
      saveSession({ access: accessToken, refresh: refreshToken, user: me.user });
      applySessionUser(me.user, !!(me.profile as { onboardingDone?: boolean } | undefined)?.onboardingDone);
      window.location.reload();
    } catch {
      clearSession();
      saveSbSession(null);
      applySessionUser(null, false);
      throw new Error('Email session was rejected by the gateway.');
    }
  }, [settings.backendUrl, applySessionUser]);

  const logout = useCallback(async () => {
    try {
      await apiLogout(settings.backendUrl);
    } catch { /* session already dead — still switch locally */ }
    clearSession();
    await sbSignOut();
    applySessionUser(null, false);
    window.location.reload(); // no stale context from the previous identity
  }, [settings.backendUrl, applySessionUser]);

  const refreshAuth = useCallback(async () => {
    try {
      const me = await apiMe(settings.backendUrl);
      const s = getSession();
      if (s) saveSession({ ...s, user: me.user });
      setAuthUser(me.user);
      setOnboardingDone(!!(me.profile as { onboardingDone?: boolean } | undefined)?.onboardingDone);
    } catch {
      clearSession();
      applySessionUser(null, false);
    } finally {
      setAuthReady(true);
    }
  }, [settings.backendUrl, applySessionUser]);

  // boot: namespace stores to the session user, validate the session.
  // Supabase email sessions are adopted too (sb token → gateway /me).
  useEffect(() => {
    const adoptSb = async (): Promise<boolean> => {
      // No sync supabaseConfigured() gate: build-time env may be empty while
      // /api/config still supplies the project (sbAccessToken resolves null
      // when truly unconfigured, which is the same outcome).
      if (getSession()) return false;
      const token = await sbAccessToken().catch(() => null);
      if (!token) return false;
      saveSession({ access: token, refresh: (await sbRefreshToken()) || '', user: { id: 'sb:pending', handle: 'email', displayName: '', role: 'user', createdAt: '' } });
      return true;
    };
    const s = getSession();
    setActiveUser(s?.user.id || null);
    if (!s) {
      adoptSb().then((adopted) => {
        if (!adopted) setAuthReady(true);
        else refreshAuth();
      });
      return;
    }
    let alive = true;
    apiMe(settings.backendUrl)
      .then((me) => {
        if (!alive) return;
        const cur = getSession();
        if (cur) saveSession({ ...cur, user: me.user });
        setAuthUser(me.user);
        setOnboardingDone(!!(me.profile as { onboardingDone?: boolean } | undefined)?.onboardingDone);
        setAuthReady(true);
      })
      .catch(() => {
        if (!alive) return;
        clearSession();
        applySessionUser(null, false);
        setAuthReady(true);
      });
    const off = onSessionChange(() => {
      const cur = getSession();
      applySessionUser(cur?.user || null);
    });
    return () => {
      alive = false;
      off();
    };
  }, [settings.backendUrl, applySessionUser]);

  useEffect(() => storage.saveSettings(settings), [settings]);

  // The initiative engine obeys the level the user chose, and a paused
  // MetaIoid obeys "ask first" no matter what the level says.
  useEffect(() => {
    InitiativeEngine.setUserAutonomy(autonomyToPolicy(settings.autonomy, settings.paused));
  }, [settings.autonomy, settings.paused]);

  // One place applies the design tokens, including following the OS when the
  // theme is set to `system`.
  useEffect(() => watchTheme(settings), [settings]);

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
    window.setTimeout(() => setToasts((p) => p.filter((x) => x.id !== id)), t.tone === 'error' ? 5200 : 3400);
  }, []);

  const closeToast = useCallback((id: string) => {
    setToasts((p) => p.filter((x) => x.id !== id));
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
  // Pausing is a real hold, not a UI flag: speech stops, in-flight work is
  // checkpointed, and the initiative policy drops to "ask first" until the
  // user releases it. Resuming never invents progress — it just lets the
  // preserved checkpoints continue.
  const pauseMetaIoid = useCallback(() => {
    GlobalStopController.stopAll();
    updateSettings({ paused: true });
    toast({ title: 'MetaIoid paused', desc: 'Everything in flight is held. Completed work is saved.' });
  }, [updateSettings, toast]);

  const resumeMetaIoid = useCallback(() => {
    GlobalStopController.clearHalt();
    updateSettings({ paused: false });
    toast({ title: 'MetaIoid resumed' });
  }, [updateSettings, toast]);

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
    toasts, toast, closeToast, modal, openModal, closeModal,
    sidebarCollapsed, setSidebarCollapsed,
    mobileSidebarOpen, setMobileSidebarOpen,
    voiceOpen, setVoiceOpen, paletteOpen, setPaletteOpen,
    toolsOpen, setToolsOpen,
    osintOpen, setOsintOpen, osintTarget, setOsintTarget,
    missionsOpen, setMissionsOpen, missionDraft, setMissionDraft,
    skillForgeOpen, setSkillForgeOpen,
    skillsOpen, setSkillsOpen,
    liveTaskId, setLiveTaskId,
    pauseMetaIoid, resumeMetaIoid,
    composerDraft, setComposerDraft,
    clearAllData,
    authUser, authReady, onboardingDone, signup, login, loginWithSupabase, logout, refreshAuth,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}
