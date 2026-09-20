// Chat slice — owns conversations, streaming generation, TTS side-effects.
// Data flow: command bar → transport.streamChat → tool card → tokens →
// optional memory save → history persist → UI. Screen never freezes:
// tokens commit incrementally, stop aborts the controller.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Attachment, ChatMessage, Conversation } from '../lib/types';
import { storage, uid } from '../lib/storage';
import { streamChat, agentContinue } from '../lib/transport';
import { planResponse } from '../lib/mockAgent';
import { speakText, stopSpeaking } from '../providers/tts';
import { VOICE_SYSTEM_INSTRUCTION } from '../lib/voice/responsePlanner';
import { HumanBehaviorPipeline } from '../lib/behavior';
import { CapabilityGapEngine } from '../lib/skills';
import { useSession } from './session';
import { useLibrary } from './library';

interface ChatValue {
  conversations: Conversation[];
  activeId: string | null;
  activeConv: Conversation | null;
  detectedLang: string | null;
  isGenerating: boolean;
  newConversation: () => string;
  selectConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  pinConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  sendMessage: (text: string, opts?: { vision?: boolean; attachments?: Attachment[] }) => Promise<void>;
  regenerate: (msgId?: string) => Promise<void>;
  speakMessage: (text: string) => Promise<void>;
  stopGenerating: () => void;
  setFeedback: (msgId: string, f: 'up' | 'down' | null) => void;
  setVersionIndex: (msgId: string, i: number) => void;
  editAndResend: (msgId: string, text: string) => Promise<void>;
  retryFailed: (msgId: string) => Promise<void>;
  runVoiceTurn: (
    transcript: string,
    cbs: { onToken: (full: string) => void; onDone: (full: string) => void }
  ) => Promise<void>;
  stopVoiceTurn: () => void;
  speculativeTurn: (
    transcript: string,
    cbs: { onToken: (full: string) => void }
  ) => { promise: Promise<string>; abort: () => void };
  stopSpeculative: () => void;
  commitSpeculativeTurn: (transcript: string, full: string) => void;
}

const Ctx = createContext<ChatValue | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { settings, setStatus, toast, setView, setToolsOpen, connection, setOsintOpen, setOsintTarget, setMissionsOpen, setMissionDraft } = useSession();
  const { addMemory, memories } = useLibrary();
  const [conversations, setConversations] = useState<Conversation[]>(() => storage.loadConversations());
  const [activeId, setActiveId] = useState<string | null>(() => storage.loadActiveConv());
  const [detectedLang, setDetectedLang] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const voiceAbortRef = useRef<AbortController | null>(null);
  const speculativeAbortRef = useRef<AbortController | null>(null);

  useEffect(() => storage.saveConversations(conversations), [conversations]);
  useEffect(() => storage.saveActiveConv(activeId), [activeId]);

  const newConversation = useCallback(() => {
    const id = uid('conv');
    const c: Conversation = {
      id, title: 'New conversation', createdAt: Date.now(), updatedAt: Date.now(),
      messages: [], model: settings.model, language: settings.defaultLanguage,
    };
    setConversations((prev) => [c, ...prev]);
    setActiveId(id);
    return id;
  }, [settings.model, settings.defaultLanguage]);

  const selectConversation = useCallback((id: string) => {
    setActiveId(id);
    setView('chat');
  }, [setView]);

  const deleteConversation = useCallback((id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    setActiveId((a) => (a === id ? null : a));
  }, []);
  const pinConversation = useCallback((id: string) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)));
  }, []);
  const renameConversation = useCallback((id: string, title: string) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
  }, []);

  const stopGenerating = useCallback(() => {
    abortRef.current?.abort();
    stopSpeaking();
    setIsGenerating(false);
    setStatus('idle');
  }, [setStatus]);

  const stopVoiceTurn = useCallback(() => {
    voiceAbortRef.current?.abort();
  }, []);

  const stopSpeculative = useCallback(() => {
    speculativeAbortRef.current?.abort();
  }, []);

  const voiceContext = useCallback(() => ({
    userName: 'Aryan',
    memories: memories.map((m) => ({ category: m.category, content: m.content })),
    preferences: {
      responseLength: settings.responseLength,
      personality: settings.personality,
      language: settings.defaultLanguage,
    },
    systemInstruction: VOICE_SYSTEM_INSTRUCTION,
    voiceFirst: true,
  }), [memories, settings]);

  const priorHistory = useCallback((convId: string | null) => (
    (conversations.find((c) => c.id === convId)?.messages ?? [])
      .filter((m) => !m.streaming)
      .map((m) => ({ role: m.role, content: m.content }))
  ), [conversations]);

  /**
   * Preemptive generation: stream a guess WITHOUT touching history.
   * Committed only if the final transcript confirms it; otherwise aborted
   * and its tokens never existed as far as the UI is concerned.
   */
  const speculativeTurn = useCallback((
    transcript: string,
    cbs: { onToken: (full: string) => void }
  ) => {
    const clean = transcript.trim();
    const controller = new AbortController();
    speculativeAbortRef.current = controller;
    const promise = (async () => {
      const out = await streamChat(clean, {
        configuredUrl: settings.backendUrl,
        history: priorHistory(activeId),
        task: 'voice',
        context: voiceContext(),
        signal: controller.signal,
      }, (partial) => cbs.onToken(partial));
      return out.text;
    })();
    return { promise, abort: () => controller.abort() };
  }, [activeId, priorHistory, settings.backendUrl, voiceContext]);

  /** Commit a confirmed speculation as a real turn (user + completed reply). */
  const commitSpeculativeTurn = useCallback((transcript: string, full: string) => {
    const clean = transcript.trim();
    if (!clean || !full.trim()) return;
    let convId = activeId;
    if (!convId) {
      convId = uid('conv');
      const c: Conversation = {
        id: convId, title: clean.slice(0, 42) || 'Voice conversation',
        preview: clean.slice(0, 90),
        createdAt: Date.now(), updatedAt: Date.now(),
        messages: [], model: settings.model, language: settings.defaultLanguage,
      };
      setConversations((prev) => [c, ...prev]);
      setActiveId(convId);
    }
    const plan = planResponse(clean);
    setDetectedLang(plan.detectedLang);
    if (plan.navigate) {
      const nav = plan.navigate;
      window.setTimeout(() => setView(nav), 600);
    }
    if (plan.openTools) window.setTimeout(() => setToolsOpen(true), 600);
    if (plan.remember && settings.memoryEnabled) addMemory(plan.remember, 'Personal');
    const userMsg: ChatMessage = { id: uid('msg'), role: 'user', content: clean, createdAt: Date.now() };
    const asst: ChatMessage = {
      id: uid('msg'), role: 'assistant', content: full, createdAt: Date.now(),
      streaming: false, detectedLang: plan.detectedLang,
    };
    setConversations((prev) => prev.map((c) => {
      if (c.id !== convId) return c;
      const title = c.messages.length === 0 ? clean.slice(0, 42) : c.title;
      return { ...c, title, updatedAt: Date.now(), messages: [...c.messages, userMsg, asst] };
    }));
  }, [activeId, addMemory, settings, setToolsOpen, setView]);

  /**
   * Voice leg of a turn: transcript in (from realtime STT), streamed tokens
   * out to the caller (which segments → speaks). Writes the same history
   * as typed chat. Aborted by stopVoiceTurn on barge-in.
   */
  const runVoiceTurn = useCallback(async (
    transcript: string,
    cbs: { onToken: (full: string) => void; onDone: (full: string) => void }
  ) => {
    const clean = transcript.trim();
    if (!clean) return;
    let convId = activeId;
    if (!convId) {
      convId = uid('conv');
      const c: Conversation = {
        id: convId, title: clean.slice(0, 42) || 'Voice conversation',
        preview: clean.slice(0, 90),
        createdAt: Date.now(), updatedAt: Date.now(),
        messages: [], model: settings.model, language: settings.defaultLanguage,
      };
      setConversations((prev) => [c, ...prev]);
      setActiveId(convId);
    }
    const userMsg: ChatMessage = { id: uid('msg'), role: 'user', content: clean, createdAt: Date.now() };
    setConversations((prev) => prev.map((c) => {
      if (c.id !== convId) return c;
      const title = c.messages.length === 0 ? clean.slice(0, 42) : c.title;
      return { ...c, title, updatedAt: Date.now(), messages: [...c.messages, userMsg] };
    }));

    const plan = planResponse(clean);
    setDetectedLang(plan.detectedLang);
    if (plan.navigate) {
      const nav = plan.navigate;
      window.setTimeout(() => setView(nav), 600);
    }
    if (plan.openTools) window.setTimeout(() => setToolsOpen(true), 600);
    if (plan.remember && settings.memoryEnabled) {
      addMemory(plan.remember, 'Personal');
      window.setTimeout(() => toast({ title: 'Memory saved' }), 900);
    }

    const priorHistory = (conversations.find((c) => c.id === convId)?.messages ?? [])
      .filter((m) => !m.streaming)
      .map((m) => ({ role: m.role, content: m.content }));

    const controller = new AbortController();
    voiceAbortRef.current = controller;
    const assistantId = uid('msg');
    setConversations((prev) => prev.map((c) =>
      c.id === convId
        ? { ...c, messages: [...c.messages, { id: assistantId, role: 'assistant', content: '', createdAt: Date.now(), streaming: true }] }
        : c
    ));

    try {
      const context = {
        userName: 'Aryan',
        memories: memories.map((m) => ({ category: m.category, content: m.content })),
        preferences: {
          responseLength: settings.responseLength,
          personality: settings.personality,
          language: settings.defaultLanguage,
        },
        systemInstruction: VOICE_SYSTEM_INSTRUCTION,
        voiceFirst: true,
      };
      const out = await streamChat(clean, {
        configuredUrl: settings.backendUrl,
        history: priorHistory,
        task: 'voice',
        context,
        signal: controller.signal,
      }, (partial) => {
        cbs.onToken(partial);
        setConversations((prev) => prev.map((c) =>
          c.id === convId
            ? { ...c, messages: c.messages.map((m) => (m.id === assistantId ? { ...m, content: partial } : m)) }
            : c
        ));
      });
      const behavioral = HumanBehaviorPipeline.processTurn(clean, out.text, { isVoiceTurn: true });
      setConversations((prev) => prev.map((c) =>
        c.id === convId
          ? { ...c, updatedAt: Date.now(), messages: c.messages.map((m) => (m.id === assistantId ? { ...m, content: behavioral.displayText, streaming: false, detectedLang: behavioral.detectedLang } : m)) }
          : c
      ));
      cbs.onDone(behavioral.spokenText);
      CapabilityGapEngine.extractFromSuccess({
        task: clean,
        success: true,
        stepsCount: 1,
        executionTimeMs: 1100,
      });
    } catch {
      if (controller.signal.aborted) {
        // barge-in: freeze partial text, clear streaming flag, stay quiet
        setConversations((prev) => prev.map((c) =>
          c.id === convId
            ? { ...c, messages: c.messages.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)) }
            : c
        ));
        return;
      }
      setConversations((prev) => prev.map((c) =>
        c.id === convId
          ? { ...c, messages: c.messages.map((m) => (m.id === assistantId ? { ...m, streaming: false, content: m.content || 'I could not reach the model. Try again.' } : m)) }
          : c
      ));
      cbs.onDone('');
    }
  }, [activeId, addMemory, conversations, memories, settings, setDetectedLang, setToolsOpen, setView, toast]);

  const sendMessage = useCallback(async (text: string, opts?: { vision?: boolean; attachments?: Attachment[] }) => {
    const clean = text.trim();
    if ((!clean && !(opts?.attachments?.length)) || isGenerating) return;
    let convId = activeId;
    if (!convId) {
      convId = uid('conv');
      const c: Conversation = {
        id: convId, title: clean.slice(0, 42) || 'New conversation',
        preview: clean.slice(0, 90),
        createdAt: Date.now(), updatedAt: Date.now(),
        messages: [], model: settings.model, language: settings.defaultLanguage,
      };
      setConversations((prev) => [c, ...prev]);
      setActiveId(convId);
    }
    const userMsg: ChatMessage = {
      id: uid('msg'), role: 'user', content: clean, createdAt: Date.now(),
      vision: opts?.vision, attachments: opts?.attachments?.length ? opts.attachments : undefined,
    };
    setConversations((prev) => prev.map((c) => {
      if (c.id !== convId) return c;
      const title = c.messages.length === 0 ? clean.slice(0, 42) : c.title;
      const preview = c.messages.length === 0 ? clean.slice(0, 90) : c.preview;
      return { ...c, title, preview, updatedAt: Date.now(), messages: [...c.messages, userMsg] };
    }));

    // OSINT intent — open the investigation workspace with the target.
    // Runs before any LLM call, online or offline.
    const osintMatch = clean.match(/^(investigate|osint|recon)\b\s*(.*)$/i);
    if (osintMatch) {
      const target = (osintMatch[2] || '').trim();
      const note: ChatMessage = {
        id: uid('msg'), role: 'assistant', createdAt: Date.now(),
        content: target
          ? `Opening an OSINT investigation on **${target}** — passive public sources only, every finding keeps its provenance. Confirm the target is yours or authorized, then start.`
          : 'Opening the OSINT workspace — enter a domain, username, email, organization, or repo you own or are authorized to investigate.',
      };
      setConversations((prev) => prev.map((c) =>
        c.id === convId ? { ...c, updatedAt: Date.now(), messages: [...c.messages, note] } : c
      ));
      setOsintTarget(target);
      window.setTimeout(() => setOsintOpen(true), 350);
      setStatus('idle');
      return;
    }

    // Mission intents — the kernel owns execution; chat stays the interface.
    // Narrow on purpose: "mission: <objective>" or "start mission <objective>".
    const missionMatch = clean.match(/^(?:mission\s*:|do mission|start mission)\s*(.+)$/is);
    if (missionMatch && missionMatch[1].trim().length > 3) {
      const objective = missionMatch[1].trim().slice(0, 300);
      const note: ChatMessage = {
        id: uid('msg'), role: 'assistant', createdAt: Date.now(),
        content: `Mission framed: **${objective.slice(0, 120)}** — opening Mission Control where you can run, pause, and verify it. Say "continue" anytime to resume.`,
      };
      setConversations((prev) => prev.map((c) =>
        c.id === convId ? { ...c, updatedAt: Date.now(), messages: [...c.messages, note] } : c
      ));
      setMissionDraft(objective);
      window.setTimeout(() => setMissionsOpen(true), 350);
      setStatus('idle');
      return;
    }
    if (/^(continue|resume|carry on)\b/i.test(clean)) {
      const note: ChatMessage = { id: uid('msg'), role: 'assistant', createdAt: Date.now(), content: '' };
      setConversations((prev) => prev.map((c) =>
        c.id === convId ? { ...c, messages: [...c.messages, note] } : c
      ));
      try {
        const m = await agentContinue(settings.backendUrl);
        const text = m
          ? `Resuming mission **${m.objective.slice(0, 120)}** (status: ${m.status}) — watch it in Mission Control.`
          : 'No active mission. Start one with "mission: <objective>".';
        setConversations((prev) => prev.map((c) =>
          c.id === convId ? { ...c, updatedAt: Date.now(), messages: c.messages.map((x) => (x.id === note.id ? { ...x, content: text } : x)) } : c
        ));
        if (m) window.setTimeout(() => setMissionsOpen(true), 350);
      } catch (e) {
        const text = e instanceof Error ? e.message : 'Gateway offline — missions need the backend.';
        setConversations((prev) => prev.map((c) =>
          c.id === convId ? { ...c, messages: c.messages.map((x) => (x.id === note.id ? { ...x, content: text } : x)) } : c
        ));
      }
      setStatus('idle');
      return;
    }

    const online = connection === 'online';
    const priorHistory = (conversations.find((c) => c.id === convId)?.messages ?? [])
      .filter((m) => !m.streaming)
      .map((m) => ({ role: m.role, content: m.content }));

    const controller = new AbortController();
    abortRef.current = controller;
    setIsGenerating(true);
    setStatus('thinking');
    setDetectedLang(null);

    // thinking beat — real latency window once backend streams
    await new Promise((r) => setTimeout(r, 550 + Math.random() * 500));
    if (controller.signal.aborted) return;

    const assistantId = uid('msg');
    let toolSeed: ChatMessage['toolActivity'] = [];
    // seed synchronously after first token batch instead — placeholder replaced below
    setConversations((prev) => prev.map((c) =>
      c.id === convId
        ? { ...c, messages: [...c.messages, { id: assistantId, role: 'assistant', content: '', createdAt: Date.now(), streaming: true, toolActivity: toolSeed }] }
        : c
    ));

    const plan = planResponse(clean);
    try {
      const result = await (async () => {
        setDetectedLang(plan.detectedLang);
        if (plan.navigate) {
          const nav = plan.navigate;
          window.setTimeout(() => setView(nav), 450);
        }
        if (plan.openTools) window.setTimeout(() => setToolsOpen(true), 450);
        if (plan.remember && settings.memoryEnabled) {
          addMemory(plan.remember, 'Personal');
          window.setTimeout(() => toast({ title: 'Memory saved', desc: 'Stored locally in this browser' }), 900);
        }
        // Simulated tool theatre runs ONLY in demo. Online, the model is
        // real — never show a tool card unless a tool actually executed.
        if (!online && plan.tool) {
          toolSeed = [{ id: uid('tool'), tool: plan.tool.tool, label: plan.tool.label, detail: plan.tool.detail, state: 'running' as const, demo: true }];
          setConversations((prev) => prev.map((c) =>
            c.id === convId
              ? { ...c, messages: c.messages.map((m) => (m.id === assistantId ? { ...m, toolActivity: toolSeed } : m)) }
              : c
          ));
          setStatus('executing');
          await new Promise((r) => setTimeout(r, 1000 + Math.random() * 700));
          if (controller.signal.aborted) throw new Error('aborted');
          setConversations((prev) => prev.map((c) =>
            c.id === convId
              ? { ...c, messages: c.messages.map((m) => (m.id === assistantId ? { ...m, toolActivity: (m.toolActivity ?? []).map((t) => ({ ...t, state: 'done' as const })) } : m)) }
              : c
          ));
          setStatus('thinking');
          await new Promise((r) => setTimeout(r, 300));
        }
        if (plan.vision) setStatus('vision');
        // Layer 2/9 grounding: real memories + preferences travel with the
        // request so the constitution's RUNTIME CONTEXT is populated, never invented.
        const context = {
          userName: 'Aryan',
          memories: memories.map((m) => ({ category: m.category, content: m.content })),
          preferences: {
            responseLength: settings.responseLength,
            personality: settings.personality,
            language: settings.defaultLanguage,
            voiceBehavior: settings.voiceBehavior,
          },
        };
        const out = await streamChat(clean, {
          configuredUrl: settings.backendUrl,
          history: priorHistory,
          context,
          signal: controller.signal,
        }, (partial) => {
          setConversations((prev) => prev.map((c) =>
            c.id === convId
              ? { ...c, messages: c.messages.map((m) => (m.id === assistantId ? { ...m, content: partial, vision: plan.vision || m.vision } : m)) }
              : c
          ));
        });
        return out;
      })();

      if (controller.signal.aborted) return;
      const behavioral = HumanBehaviorPipeline.processTurn(clean, result.text, { isVoiceTurn: false });
      setConversations((prev) => prev.map((c) =>
        c.id === convId
          ? { ...c, updatedAt: Date.now(), messages: c.messages.map((m) => (m.id === assistantId ? { ...m, content: behavioral.displayText, streaming: false, detectedLang: behavioral.detectedLang } : m)) }
          : c
      ));

      CapabilityGapEngine.extractFromSuccess({
        task: clean,
        success: true,
        stepsCount: plan.tool ? 3 : 1,
        toolsInvoked: plan.tool ? [plan.tool.tool] : undefined,
        executionTimeMs: 1400,
      });

      if (settings.autoSpeak && settings.voiceEnabled) {
        setStatus('speaking');
        await speakText(behavioral.spokenText.slice(0, 600), { rate: settings.speed }).catch(() => {});
        if (controller.signal.aborted) return;
      }
      setStatus('idle');
      setIsGenerating(false);
    } catch (e) {
      if (controller.signal.aborted) return;
      CapabilityGapEngine.triageFailure({
        task: clean,
        success: false,
        error: e instanceof Error ? e.message : String(e),
        stepsCount: 1,
        executionTimeMs: 500,
      });
      setStatus('error');
      setIsGenerating(false);
      // never strand an empty streaming bubble: finalize as a compact error
      setConversations((prev) => prev.map((c) =>
        c.id === convId
          ? {
              ...c, updatedAt: Date.now(),
              messages: c.messages.map((m) =>
                m.id === assistantId ? { ...m, streaming: false, error: true } : m
              ),
            }
          : c
      ));
      const msg = e instanceof Error ? e.message : '';
      toast({
        title: "METALOID couldn't reach the AI.",
        desc: msg && !/abort/i.test(msg) ? msg.slice(0, 120) : 'Retry',
      });
      window.setTimeout(() => setStatus('idle'), 2600);
    }
  }, [activeId, addMemory, connection, conversations, isGenerating, memories, settings, setMissionsOpen, setMissionDraft, setOsintOpen, setOsintTarget, setStatus, setToolsOpen, setView, toast]);

  const regenerate = useCallback(async (msgId?: string) => {
    const conv = conversations.find((c) => c.id === activeId);
    if (!conv || isGenerating) return;
    // target: given assistant message, else the last assistant message
    const asstIdx = msgId
      ? conv.messages.findIndex((m) => m.id === msgId && m.role === 'assistant')
      : [...conv.messages].map((m, i) => ({ m, i })).reverse().find((x) => x.m.role === 'assistant')?.i ?? -1;
    if (asstIdx < 0) return;
    const target = conv.messages[asstIdx];
    if (target.streaming || !target.content) return;
    const priorUser = [...conv.messages.slice(0, asstIdx)].reverse().find((m) => m.role === 'user');
    if (!priorUser) return;
    // intent notes (investigate/mission/continue) regenerate as plain resends
    const isIntent = /^(investigate|osint|recon|mission\s*:|do mission|start mission|continue|resume|carry on)\b/i.test(priorUser.content.trim());
    const stash = isIntent ? null : { versions: [...(target.versions ?? []), target.content] };
    // truncate the branch BEFORE the user turn (sendMessage re-adds it —
    // no duplicated user bubbles), everything after is replaced
    const cut = conv.messages.slice(0, asstIdx);
    const ui = [...cut].reverse().findIndex((m) => m.role === 'user');
    const base = ui < 0 ? cut : cut.slice(0, cut.length - 1 - ui);
    setConversations((prev) => prev.map((c) => {
      if (c.id !== activeId) return c;
      return { ...c, messages: base, updatedAt: Date.now() };
    }));
    await sendMessage(priorUser.content, priorUser.attachments?.length ? { attachments: priorUser.attachments } : undefined);
    // attach the stashed generation to the fresh answer (if one streamed)
    if (stash) {
      setConversations((prev) => prev.map((c) => {
        if (c.id !== activeId) return c;
        const rev = [...c.messages].reverse();
        const li = rev.findIndex((m) => m.role === 'assistant' && !m.streaming && m.content);
        if (li < 0) return c;
        const idx = c.messages.length - 1 - li;
        const fresh = c.messages[idx];
        if (fresh.content === target.content) return c; // identical — no version needed
        const next = [...c.messages];
        next[idx] = { ...fresh, versions: stash.versions, versionIndex: -1 };
        return { ...c, messages: next };
      }));
    }
  }, [activeId, conversations, isGenerating, sendMessage]);

  const setFeedback = useCallback((msgId: string, f: 'up' | 'down' | null) => {
    setConversations((prev) => prev.map((c) => ({
      ...c,
      messages: c.messages.map((m) => (m.id === msgId ? { ...m, feedback: f ?? undefined } : m)),
    })));
  }, []);

  const setVersionIndex = useCallback((msgId: string, i: number) => {
    setConversations((prev) => prev.map((c) => ({
      ...c,
      messages: c.messages.map((m) => (m.id === msgId ? { ...m, versionIndex: i } : m)),
    })));
  }, []);

  /**
   * Edit a user message + resend: the branch visibly changes —
   * everything after the edited turn is replaced by the fresh answer.
   */
  const editAndResend = useCallback(async (msgId: string, text: string) => {
    const clean = text.trim();
    if (!clean || isGenerating) return;
    const conv = conversations.find((c) => c.id === activeId);
    if (!conv) return;
    const idx = conv.messages.findIndex((m) => m.id === msgId && m.role === 'user');
    if (idx < 0) return;
    const original = conv.messages[idx];
    const base = conv.messages.slice(0, idx);
    setConversations((prev) => prev.map((c) => {
      if (c.id !== activeId) return c;
      return { ...c, messages: base, updatedAt: Date.now() };
    }));
    await sendMessage(clean, original.attachments?.length ? { attachments: original.attachments } : undefined);
    // mark the resent turn so the branch change is visible
    setConversations((prev) => prev.map((c) => {
      if (c.id !== activeId) return c;
      const rev = [...c.messages].reverse();
      const li = rev.findIndex((m) => m.role === 'user' && m.content === clean);
      if (li < 0) return c;
      const ri = c.messages.length - 1 - li;
      const next = [...c.messages];
      next[ri] = { ...next[ri], edited: true };
      return { ...c, messages: next };
    }));
  }, [activeId, conversations, isGenerating, sendMessage]);

  /** Retry a failed generation: drop the error stub, resend the last user turn. */
  const retryFailed = useCallback(async (msgId: string) => {
    const conv = conversations.find((c) => c.id === activeId);
    if (!conv || isGenerating) return;
    const idx = conv.messages.findIndex((m) => m.id === msgId);
    if (idx < 0) return;
    const priorUser = [...conv.messages.slice(0, idx)].reverse().find((m) => m.role === 'user');
    if (!priorUser) return;
    setConversations((prev) => prev.map((c) => {
      if (c.id !== activeId) return c;
      return { ...c, messages: c.messages.filter((m) => m.id !== msgId) };
    }));
    await sendMessage(priorUser.content, priorUser.attachments?.length ? { attachments: priorUser.attachments } : undefined);
  }, [activeId, conversations, isGenerating, sendMessage]);

  const speakMessage = useCallback(async (text: string) => {    if (!settings.voiceEnabled) return;
    stopSpeaking();
    setStatus('speaking');
    await speakText(text.slice(0, 600), { rate: settings.speed }).catch(() => {});
    setStatus('idle');
  }, [settings.voiceEnabled, settings.speed, setStatus]);

  const activeConv = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId]
  );

  return (
    <Ctx.Provider value={{
      conversations, activeId, activeConv, detectedLang, isGenerating,
      newConversation, selectConversation, deleteConversation, pinConversation,
      renameConversation, sendMessage, regenerate, speakMessage, stopGenerating,
      runVoiceTurn, stopVoiceTurn, speculativeTurn, stopSpeculative, commitSpeculativeTurn,
      setFeedback, setVersionIndex, editAndResend, retryFailed,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useChat(): ChatValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useChat outside ChatProvider');
  return v;
}
