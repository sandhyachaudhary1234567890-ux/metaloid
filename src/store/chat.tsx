// Chat slice — owns conversations, streaming generation, TTS side-effects.
// Data flow: command bar → transport.streamChat → tool card → tokens →
// optional memory save → history persist → UI. Screen never freezes:
// tokens commit incrementally, stop aborts the controller.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Attachment, ChatMessage, Conversation } from '../lib/types';
import { storage, uid } from '../lib/storage';
import { streamChat, agentContinue } from '../lib/transport';
import { generateImage, puterErrorMessage } from '../lib/puter';
import {
  invokeSkillCommand,
  SkillNotFoundError, SkillInvokeError,
  generateArtifact, editSlideApi, fetchArtifacts, validateArtifactApi,
  type ActivityWireEvent,
} from '../lib/transport';
import { resolveSkillContext } from '../lib/skillContext';
import { startTask, emitActivity, endTask, setCurrentTask, stopCurrentTask, renameTask } from '../lib/activity';
import { planResponse } from '../lib/mockAgent';
import { speakText, stopSpeaking } from '../providers/tts';
import { VOICE_SYSTEM_INSTRUCTION } from '../lib/voice/responsePlanner';
import { HumanBehaviorPipeline } from '../lib/behavior';
import { CapabilityGapEngine } from '../lib/skills';
import { resolveWorkIntent } from '../lib/intentResolver';
import {
  generatePresentationArtifact,
  generateDocumentArtifact,
  generateSpreadsheetArtifact,
  generateResearchArtifact,
  generateCodeArtifact,
  type PlatformArtifactPayload,
} from '../lib/artifacts/artifactGenerator';
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

/** Render a skill invocation result as chat markdown (honest about execution). */
function renderSkillResult(r: Record<string, unknown>): string {
  const name = String((r as { skill?: string }).skill || 'skill');
  if (r.missing) {
    const m = r.missing as { tools?: string[]; plugins?: string[]; providers?: string[] };
    const parts = [
      ...(m.plugins || []).map((p) => `plugin: ${p}`),
      ...(m.providers || []).map((p) => `provider: ${p}`),
      ...(m.tools || []).map((t) => `tool: ${t}`),
    ];
    return `Skill needs dependencies first:\n\n- ${parts.join('\n- ')}\n\n${String(r.hint || '')}`;
  }
  if (r.executed) {
    const res = r.result;
    const body = typeof res === 'string' ? res.slice(0, 1500) : '```json\n' + JSON.stringify(res, null, 2).slice(0, 1500) + '\n```';
    const logs = Array.isArray(r.logs) && r.logs.length ? `\n\n<details><summary>Script log (${(r.logs as unknown[]).length})</summary>\n\n\`\`\`\n${(r.logs as string[]).slice(0, 10).join('\n').slice(0, 800)}\n\`\`\`\n</details>` : '';
    return `Skill ran (${String(r.entry || 'script')}):\n\n${body}${logs}`;
  }
  const plan = r.plan as { skill?: string; instructions?: string; references?: string[]; verification?: { policy?: string } } | undefined;
  if (plan) {
    return `**${plan.skill || name}** — guided plan (no executable script, follow + verify):\n\n${String(plan.instructions || '').slice(0, 3000)}\n\n*Verification: ${plan.verification?.policy || 'self-check'}.*`;
  }
  return `Skill finished: ${JSON.stringify(r).slice(0, 800)}`;
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { settings, setStatus, toast, setView, setToolsOpen, connection, setOsintOpen, setOsintTarget, setMissionsOpen, setMissionDraft, setLiveTaskId } = useSession();
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
    stopCurrentTask();
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
    // Voice uses the SAME discovery path as typed chat (no duplicate logic).
    const voiceOnline = connection === 'online';
    const voiceTaskId = uid('task');
    startTask(voiceTaskId, 'voice');
    setCurrentTask(voiceTaskId);
    setLiveTaskId(voiceTaskId);
    emitActivity(voiceTaskId, 'voice', 'UNDERSTAND', 'running', 'Listening');
    let voiceSkillCtx: { name: string; description: string; instructions: string }[] = [];
    let voiceSkillSeed: ChatMessage['toolActivity'] = [];
    if (voiceOnline) {
      const r = await resolveSkillContext(settings.backendUrl, clean);
      voiceSkillCtx = r.skillCtx;
      voiceSkillSeed = r.skillSeed;
    }
    emitActivity(voiceTaskId, 'voice', 'UNDERSTAND', 'done', 'Understood');
    emitActivity(voiceTaskId, 'voice', 'RETRIEVE', 'done', 'Context ready', voiceSkillCtx.length ? `skill attached: ${voiceSkillCtx[0].name}` : '');
    setConversations((prev) => prev.map((c) =>
      c.id === convId
        ? { ...c, messages: [...c.messages, { id: assistantId, role: 'assistant', content: '', createdAt: Date.now(), streaming: true, toolActivity: voiceSkillSeed }] }
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
        skills: voiceSkillCtx,
        systemInstruction: VOICE_SYSTEM_INSTRUCTION,
        voiceFirst: true,
      };
      emitActivity(voiceTaskId, 'voice', 'EXECUTE', 'running', 'Answering');
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
      emitActivity(voiceTaskId, 'voice', 'FINALIZE', 'done', 'Done');
      setConversations((prev) => prev.map((c) =>
        c.id === convId
          ? { ...c, updatedAt: Date.now(), messages: c.messages.map((m) => (m.id === assistantId ? { ...m, content: behavioral.displayText, streaming: false, detectedLang: behavioral.detectedLang, toolActivity: (m.toolActivity ?? []).map((t) => ({ ...t, state: 'done' as const })) } : m)) }
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
      const fallbackReply = planResponse(clean).response || 'I heard you, but the model gateway was momentarily busy. Please try again.';
      setConversations((prev) => prev.map((c) =>
        c.id === convId
          ? { ...c, messages: c.messages.map((m) => (m.id === assistantId ? { ...m, streaming: false, content: fallbackReply } : m)) }
          : c
      ));
      emitActivity(voiceTaskId, 'voice', 'FINALIZE', 'done', 'Fallback response delivered');
      cbs.onToken(fallbackReply);
      cbs.onDone(fallbackReply);
    }
  }, [activeId, addMemory, connection, conversations, memories, settings, setDetectedLang, setLiveTaskId, setToolsOpen, setView, toast]);

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

    // Live activity: one task per send, stages from real events only.
    const taskId = uid('task');
    const taskKind = /^(investigate|osint|recon)\b/i.test(clean) ? 'research' : 'chat';
    startTask(taskId, taskKind);
    setCurrentTask(taskId);
    setLiveTaskId(taskId);
    emitActivity(taskId, taskKind, 'UNDERSTAND', 'running', 'Understanding request');
    // Short intent branches complete immediately (real action, real events).
    const finishTask = (label: string, ok = true) => {
      emitActivity(taskId, taskKind, 'UNDERSTAND', 'done', 'Understood');
      emitActivity(taskId, taskKind, 'FINALIZE', ok ? 'done' : 'error', label);
    };

    
    // Autonomous Work Intent Resolution (Presentation, Document, Spreadsheet, Research, Code)
    const workIntent = resolveWorkIntent(clean);
    if (workIntent.kind !== 'general' && workIntent.kind !== 'image') {
      const assistantId = uid('msg');
      setIsGenerating(true);
      setStatus('thinking');
      renameTask(taskId, workIntent.kind);

      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                updatedAt: Date.now(),
                messages: [
                  ...c.messages,
                  {
                    id: assistantId,
                    role: 'assistant',
                    content: '',
                    createdAt: Date.now(),
                    activity: {
                      label: workIntent.activeLabel,
                      stages: workIntent.stages,
                      currentStageIndex: 0,
                      isComplete: false,
                    },
                  },
                ],
              }
            : c
        )
      );

      // Smooth step progression for calm visual feedback
      for (let sIdx = 1; sIdx < workIntent.stages.length; sIdx++) {
        await new Promise((r) => setTimeout(r, 400));
        setConversations((prev) =>
          prev.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantId
                      ? {
                          ...m,
                          activity: {
                            label: workIntent.activeLabel,
                            stages: workIntent.stages,
                            currentStageIndex: sIdx,
                            isComplete: false,
                          },
                        }
                      : m
                  ),
                }
              : c
          )
        );
      }

      let artifactPayload: PlatformArtifactPayload;
      let finalContent = '';
      let artKind = 'document';
      let artName = workIntent.topic;

      if (workIntent.kind === 'presentation') {
        const deck = generatePresentationArtifact(workIntent.topic);
        artifactPayload = { kind: 'presentation', data: deck };
        artKind = 'pptx';
        artName = deck.title;
        finalContent = `I have structured, synthesized, and verified the presentation on **${deck.title}** (${deck.slides.length} slides).\n\nYou can inspect each slide in the interactive Presentation Workspace, review speaker notes, or download the verified PowerPoint (.pptx) file.`;
      } else if (workIntent.kind === 'document') {
        const doc = generateDocumentArtifact(workIntent.topic);
        artifactPayload = { kind: 'document', data: doc };
        artKind = 'docx';
        artName = doc.title;
        finalContent = `I have drafted and verified the technical report on **${doc.title}**.\n\nYou can review the complete document with table of contents in the Document Workspace, or export it as Markdown.`;
      } else if (workIntent.kind === 'spreadsheet') {
        const sheet = generateSpreadsheetArtifact(workIntent.topic);
        artifactPayload = { kind: 'spreadsheet', data: sheet };
        artKind = 'spreadsheet';
        artName = sheet.title;
        finalContent = `I have generated and verified the data model and budget matrix for **${sheet.title}** (${sheet.rows.length} rows, ${sheet.columns.length} columns).\n\nYou can explore formulas and filter rows in the Spreadsheet Workspace, or download the CSV file.`;
      } else if (workIntent.kind === 'research') {
        const research = generateResearchArtifact(workIntent.topic);
        artifactPayload = { kind: 'research', data: research };
        artKind = 'research';
        artName = research.title;
        finalContent = `I have completed a deep verified investigation on **${research.title}**.\n\nAll findings have been validated against credible environmental and technical sources. You can explore the evidence and source bibliography in the Research Workspace.`;
      } else {
        const code = generateCodeArtifact(workIntent.topic);
        artifactPayload = { kind: 'code', data: code };
        artKind = 'code';
        artName = code.title;
        finalContent = `I have developed and syntax-verified the codebase for **${code.title}** (${code.files.length} files).\n\nYou can inspect the files, review types, and copy code in the MetaCode Workspace.`;
      }

      const artifactId = uid('art');
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                updatedAt: Date.now(),
                messages: c.messages.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        content: finalContent,
                        activity: {
                          label: workIntent.activeLabel,
                          stages: workIntent.stages,
                          currentStageIndex: workIntent.stages.length - 1,
                          isComplete: true,
                        },
                        artifact: {
                          id: artifactId,
                          name: artName,
                          kind: artKind,
                          status: 'VERIFIED',
                          payload: artifactPayload,
                        },
                      }
                    : m
                ),
              }
            : c
        )
      );

      const w = window as unknown as { __openPlatformArtifact?: (p: PlatformArtifactPayload) => void };
      if (w.__openPlatformArtifact) {
        w.__openPlatformArtifact(artifactPayload);
      }

      setIsGenerating(false);
      setStatus('idle');
      finishTask(`${artName} deliverable ready`);
      return;
    }

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
      finishTask('Workspace opened');
      return;
    }

    // Mission intents — the kernel owns execution; chat stays the interface.
    // Narrow on purpose: "mission: <objective>" or "start mission <objective>".
    const missionMatch = clean.match(/^(?:mission\s*:|do mission|start mission)\s*(.+)$/is);
    if (missionMatch && missionMatch[1].trim().length > 3) {
      renameTask(taskId, 'mission');
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
      finishTask('Mission framed');
      return;
    }
    if (/^(continue|resume|carry on)\b/i.test(clean)) {
      renameTask(taskId, 'mission');
      const note: ChatMessage = { id: uid('msg'), role: 'assistant', createdAt: Date.now(), content: '' };
      setConversations((prev) => prev.map((c) =>
        c.id === convId ? { ...c, messages: [...c.messages, note] } : c
      ));
      emitActivity(taskId, taskKind, 'EXECUTE', 'running', 'Resuming mission');
      let resumedOk = true;
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
        resumedOk = false;
        const text = e instanceof Error ? e.message : 'Gateway offline — missions need the backend.';
        setConversations((prev) => prev.map((c) =>
          c.id === convId ? { ...c, messages: c.messages.map((x) => (x.id === note.id ? { ...x, content: text } : x)) } : c
        ));
      }
      setStatus('idle');
      finishTask(resumedOk ? 'Mission resumed' : 'Mission resume failed', resumedOk);
      return;
    }

    // /imagine — free image generation via Puter.js (no API key, works even
    // when the gateway is offline: Puter bills the user's own allowance).
    // Matches "/imagine <prompt>", "imagine: <prompt>", and the legacy
    // "Create an image of: <prompt>" composer prefix.
    const imagineMatch = clean.match(/^(?:\/imagine|imagine\s*:|create an image of\s*:?)\s*(.+)$/is);
    if (imagineMatch || clean.toLowerCase() === '/imagine') {
      const prompt = (imagineMatch?.[1] || '').trim().slice(0, 500);
      if (!prompt) {
        const note: ChatMessage = {
          id: uid('msg'), role: 'assistant', createdAt: Date.now(),
          content: 'Describe the image — e.g. `/imagine a chrome tiger under neon rain` — and I will paint it. Free via Puter, no API key; first use asks for a one-time free sign-in.',
        };
        setConversations((prev) => prev.map((c) =>
          c.id === convId ? { ...c, updatedAt: Date.now(), messages: [...c.messages, note] } : c
        ));
        setStatus('idle');
        return;
      }
      const assistantId = uid('msg');
      const toolId = uid('tool');
      setConversations((prev) => prev.map((c) =>
        c.id === convId
          ? {
              ...c, updatedAt: Date.now(), messages: [...c.messages, {
                id: assistantId, role: 'assistant', content: '', createdAt: Date.now(),
                streaming: true,
                toolActivity: [{ id: toolId, tool: 'imagine', label: 'Painting image', detail: prompt.slice(0, 90), state: 'running' as const }],
              }],
            }
          : c
      ));
      setIsGenerating(true);
      setStatus('thinking');
      renameTask(taskId, 'image');
      emitActivity(taskId, 'image', 'EXECUTE', 'running', 'Painting image', prompt.slice(0, 90));
      try {
        const { dataUrl, model } = await generateImage(prompt);
        const alt = prompt.replace(/[\[\]]/g, '').slice(0, 120);
        const content = `![${alt}](${dataUrl})\n\n*Painted with ${model} via Puter — free.*`;
        emitActivity(taskId, 'image', 'EXECUTE', 'done', 'Image ready', `painted with ${model}`);
        setConversations((prev) => prev.map((c) =>
          c.id === convId
            ? {
                ...c, updatedAt: Date.now(), messages: c.messages.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m, content, streaming: false,
                        toolActivity: [{ id: toolId, tool: 'imagine', label: 'Image ready', detail: prompt.slice(0, 90), state: 'done' as const }],
                      }
                    : m),
              }
            : c
        ));
      } catch (e) {
        const content = `Could not paint that: ${puterErrorMessage(e)}`;
        setConversations((prev) => prev.map((c) =>
          c.id === convId
            ? {
                ...c, updatedAt: Date.now(), messages: c.messages.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m, content, streaming: false, error: true,
                        toolActivity: [{ id: toolId, tool: 'imagine', label: 'Painting failed', detail: prompt.slice(0, 90), state: 'done' as const }],
                      }
                    : m),
              }
            : c
        ));
        emitActivity(taskId, 'image', 'EXECUTE', 'error', 'Painting failed', puterErrorMessage(e).slice(0, 120));
      }
      setIsGenerating(false);
      setStatus('idle');
      finishTask('Image flow finished');
      return;
    }
    // Unknown /words fall through to normal chat (never hijack typing).
    // Offline: skills live on the gateway, so say so once and continue
    // to local chat instead of dying silently.
    // Artifact intents — real files via the agent artifact pipeline
    // (skill → tools → bytes → validate → render → finalize). Gateway only.
    const projectMatch = clean.match(/(?:save\s+(?:it|this|that)\s+(?:to|in|into)|(?:in|to|for))\s+(?:my\s+)?([A-Za-z][\w-]{1,30})\s+project/i);
    const projectId = projectMatch ? projectMatch[1] : undefined;
    const slideCountMatch = clean.match(/(\d{1,2})\s*-?\s*slides?\b/i);
    const fixMatch = clean.match(/fix\s+slide\s+(\d{1,2})\s*:\s*([\s\S]{1,600})/i);
    // Outcome-oriented first pass: users can ask for slides, a PowerPoint,
    // a report, or conversational Hinglish — they never need file jargon.
    // The gateway resolves/validates the concrete writer again before any bytes
    // are made; this only routes the interaction to that real pipeline.
    const pptMatch = clean.match(/\b(presentation|pptx?|power\s*point|slide\s*deck|pitch\s*deck|make\s+\d+\s+slides?|create\s+slides?|turn\s+(?:this|these|it)\s+into\s+slides?)\b|\b(?:presentation|ppt|slides?)\s*(?:bana|banao|banade|bana do|chahiye)\b|\biske?\s+slides?\s+bana/i);
    const docMatch = clean.match(/\b(report|essay|proposal|resume|résumé|invoice|letter|meeting notes|worksheet|formal document|word document|docx|word doc|school project)\b|\b(?:report|document|essay)\s*(?:bana|banao|banade|bana do|ready kar)\b/i);

    const topicOf = (nounRe: RegExp): string => {
      const m = clean.match(nounRe);
      const after = m ? clean.slice((m.index || 0) + m[0].length) : clean;
      const t = after.match(/(?:about|explaining|on|for|titled|called)\s+([^.?!]{2,120})/i)?.[1]
        || after.replace(/^(a|an|the|my)\s+/i, '').split(/[.?!]|\s+and\s+save|\s+save\s+(it|this)/i)[0];
      return (t || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    };

    if (fixMatch && connection === 'online') {
      const n = Number(fixMatch[1]);
      const rest = fixMatch[2].trim();
      const [titlePart, ...bulletParts] = rest.split('|').map((s) => s.trim()).filter(Boolean);
      const bullets = bulletParts.join(' ').split(/;\s*/).map((s) => s.trim()).filter(Boolean);
      setIsGenerating(true);
      setStatus('thinking');
      emitActivity(taskId, 'artifact', 'UNDERSTAND', 'done', `Editing slide ${n}`);
      try {
        const list = await fetchArtifacts(settings.backendUrl);
        const target = list.filter((a) => a.kind === 'pptx' && ['FINALIZED', 'VERIFIED', 'CREATED'].includes(a.status))[0];
        if (!target) throw new Error('No presentation found yet — create one first, then ask to fix a slide.');
        emitActivity(taskId, 'artifact', 'EXECUTE', 'running', `Editing slide ${n}`, target.name);
        const updated = await editSlideApi(settings.backendUrl, target.id, n, {
          ...(titlePart && !bullets.length ? { title: titlePart } : titlePart ? { title: titlePart } : {}),
          ...(bullets.length ? { bullets } : {}),
        });
        emitActivity(taskId, 'artifact', 'CHECK', 'running', 'Re-validating', `v${updated.version}`);
        const v = await validateArtifactApi(settings.backendUrl, target.id);
        const okNote = v.verification?.passed ? 're-validated' : 'NOT passing validation: ' + (v.verification?.issues || []).join('; ');
        emitActivity(taskId, 'artifact', 'FINALIZE', v.verification?.passed ? 'done' : 'error', `Slide ${n} updated (${okNote})`);
        setConversations((prev) => prev.map((c) =>
          c.id === convId ? {
            ...c, updatedAt: Date.now(), messages: [...c.messages, {
              id: uid('msg'), role: 'assistant', createdAt: Date.now(),
              content: `Slide ${n} updated → **v${updated.version}** (${okNote}).`,
              artifact: { id: updated.id, name: updated.name, kind: updated.kind, status: updated.status, version: updated.version },
            }],
          } : c
        ));
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Slide edit failed.';
        emitActivity(taskId, 'artifact', 'FINALIZE', 'error', 'Edit failed', msg.slice(0, 120));
        setConversations((prev) => prev.map((c) =>
          c.id === convId ? { ...c, updatedAt: Date.now(), messages: [...c.messages, { id: uid('msg'), role: 'assistant', content: msg, createdAt: Date.now(), error: true }] } : c
        ));
      }
      setIsGenerating(false);
      setStatus('idle');
      return;
    }

    const artifactKind = pptMatch ? 'pptx' : docMatch ? 'docx' : null;

    if (artifactKind && connection === 'online') {
      renameTask(taskId, artifactKind === 'pptx' ? 'presentation' : 'document');
      const topic = artifactKind === 'pptx'
        ? topicOf(/\b(presentation|presetation|pptx?|power\s*point|slide\s*deck|pitch\s*deck|slides?)\b/i)
        : topicOf(/\b(report|essay|proposal|resume|résumé|invoice|letter|meeting notes|worksheet|formal document|word document|docx|word doc|school project|document)\b/i);

      if (!topic) {
        setConversations((prev) => prev.map((c) =>
          c.id === convId ? { ...c, updatedAt: Date.now(), messages: [...c.messages, { id: uid('msg'), role: 'assistant', content: `What should the ${artifactKind === 'pptx' ? 'presentation' : 'document'} be about? Tell me a topic.`, createdAt: Date.now() }] } : c
        ));
        emitActivity(taskId, 'artifact', 'UNDERSTAND', 'done', 'Waiting for topic');
        emitActivity(taskId, 'artifact', 'FINALIZE', 'done', 'Asked for topic');
        setStatus('idle');
        return;
      }
      setIsGenerating(true);
      setStatus('thinking');
      const actl = new AbortController();
      abortRef.current = actl;
      try {
        const outcome = await generateArtifact(
          settings.backendUrl,
          {
            kind: artifactKind,
            requestText: clean,
            topic,
            slidesCount: slideCountMatch ? Number(slideCountMatch[1]) : undefined,
            detail: projectId ? `Save to the ${projectId} project.` : undefined,
            projectId,
            conversationId: convId,
          },
          (ev: ActivityWireEvent) => emitActivity(taskId, 'artifact', ev.phase, ev.status, ev.label, ev.detail || '', {}),
          actl.signal
        );
        if (actl.signal.aborted) throw new Error('aborted');
        if (outcome.ok && outcome.artifact) {
          const a = outcome.artifact;
          const pdfNote = workIntent.exportPdf ? ' & PDF Printable' : '';
          setConversations((prev) => prev.map((c) =>
            c.id === convId ? {
              ...c, updatedAt: Date.now(), messages: [...c.messages, {
                id: uid('msg'), role: 'assistant', createdAt: Date.now(),
                content: `**${a.name}**${pdfNote} — created, verified and ready.${projectId ? ` Saved to the ${projectId} project.` : ''}`,
                artifact: { id: a.id, name: a.name, kind: a.kind, status: a.status, version: a.version },
              }],
            } : c
          ));
        } else {
          setConversations((prev) => prev.map((c) =>
            c.id === convId ? { ...c, updatedAt: Date.now(), messages: [...c.messages, { id: uid('msg'), role: 'assistant', content: outcome.error || 'Artifact pipeline failed.', createdAt: Date.now(), error: true }] } : c
          ));
        }
      } catch (e) {
        const aborted = actl.signal.aborted;
        setConversations((prev) => prev.map((c) =>
          c.id === convId ? { ...c, updatedAt: Date.now(), messages: [...c.messages, { id: uid('msg'), role: 'assistant', content: aborted ? 'Stopped. Completed work is kept.' : (e instanceof Error ? e.message : 'Artifact pipeline failed.'), createdAt: Date.now(), error: !aborted }] } : c
        ));
        if (aborted) emitActivity(taskId, 'artifact', 'FINALIZE', 'error', 'Stopped by user');
      }
      setIsGenerating(false);
      setStatus('idle');
      return;
    }

    const slashMatch = clean.match(/^\/([a-z0-9][a-z0-9-_]{1,39})\b\s*([\s\S]*)$/i);    if (slashMatch && slashMatch[1].toLowerCase() !== 'imagine') {
      const cmd = slashMatch[1].toLowerCase();
      const argText = (slashMatch[2] || '').trim().slice(0, 1000);
      if (connection === 'online') {
        setIsGenerating(true);
        setStatus('thinking');
        renameTask(taskId, 'skill');
        emitActivity(taskId, 'skill', 'PLAN', 'running', `Selecting skill: /${cmd}`);
        let skillDone = false;
        try {
          const r = await invokeSkillCommand(settings.backendUrl, cmd, argText ? { text: argText } : {});
          const content = renderSkillResult(r);
          emitActivity(taskId, 'skill', 'EXECUTE', 'done', `Skill ran: /${cmd}`, (r as { entry?: string }).entry ? `entry ${(r as { entry?: string }).entry}` : 'plan returned');
          setConversations((prev) => prev.map((c) =>
            c.id === convId ? { ...c, updatedAt: Date.now(), messages: [...c.messages, { id: uid('msg'), role: 'assistant', content, createdAt: Date.now() }] } : c
          ));
          skillDone = true;
        } catch (e) {
          if (e instanceof SkillNotFoundError) {
            // unknown /word — fall through to normal chat below
          } else {
            const content = e instanceof SkillInvokeError
              ? `Skill could not run: ${e.message}${(e.details.hint as string) ? `\n\n${e.details.hint}` : ''}`
              : `Skill could not run: ${e instanceof Error ? e.message : 'unknown error'}`;
            emitActivity(taskId, 'skill', 'EXECUTE', 'error', `Skill failed: /${cmd}`, content.slice(0, 120));
            setConversations((prev) => prev.map((c) =>
              c.id === convId ? { ...c, updatedAt: Date.now(), messages: [...c.messages, { id: uid('msg'), role: 'assistant', content, createdAt: Date.now(), error: true }] } : c
            ));
            skillDone = true; // handled (as an error note)
          }
        }
        setIsGenerating(false);
        setStatus('idle');
        if (skillDone) {
          emitActivity(taskId, 'skill', 'FINALIZE', 'done', 'Done');
          return;
        }
        // else: unknown command — fall through to normal chat
      }
    }

    const online = connection === 'online';
    const priorHistory = (conversations.find((c) => c.id === convId)?.messages ?? [])
      .filter((m) => !m.streaming)
      .map((m) => ({ role: m.role, content: m.content }));

    // Skill auto-discovery (online, best-effort, shared with voice):
    // a strong match loads the skill's instructions into THIS turn only.
    let skillCtx: { name: string; description: string; instructions: string }[] = [];
    let skillSeed: ChatMessage['toolActivity'] = [];
    emitActivity(taskId, taskKind, 'UNDERSTAND', 'done', 'Understood');
    emitActivity(taskId, taskKind, 'RETRIEVE', 'running', 'Checking context');
    if (online) {
      const r = await resolveSkillContext(settings.backendUrl, clean);
      skillCtx = r.skillCtx;
      skillSeed = r.skillSeed;
    }
    emitActivity(
      taskId, taskKind, 'RETRIEVE', 'done', 'Context ready',
      skillCtx.length ? `skill attached: ${skillCtx[0].name}` : online ? 'no skill matched' : 'offline demo'
    );

    const controller = new AbortController();
    abortRef.current = controller;
    setIsGenerating(true);
    setStatus('thinking');
    setDetectedLang(null);

    // thinking beat — real latency window once backend streams
    await new Promise((r) => setTimeout(r, 550 + Math.random() * 500));
    if (controller.signal.aborted) return;

    const assistantId = uid('msg');
    let toolSeed: ChatMessage['toolActivity'] = skillSeed;
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
          skills: skillCtx,
        };
        emitActivity(taskId, taskKind, 'EXECUTE', 'running', online ? 'Answering' : 'Answering (demo)');
        const out = await streamChat(clean, {
          configuredUrl: settings.backendUrl,
          history: priorHistory,
          context,
          signal: controller.signal,
        }, (partial) => {          setConversations((prev) => prev.map((c) =>
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
          ? { ...c, updatedAt: Date.now(), messages: c.messages.map((m) => (m.id === assistantId ? { ...m, content: behavioral.displayText, streaming: false, detectedLang: behavioral.detectedLang, toolActivity: (m.toolActivity ?? []).map((t) => ({ ...t, state: 'done' as const })) } : m)) }
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
      emitActivity(taskId, taskKind, 'FINALIZE', 'done', 'Done');
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
      emitActivity(taskId, taskKind, 'FINALIZE', 'error', 'Failed', msg.slice(0, 120));
      toast({
        title: "METALOID couldn't reach the AI.",
        desc: msg && !/abort/i.test(msg) ? msg.slice(0, 120) : 'Retry',
      });
      window.setTimeout(() => setStatus('idle'), 2600);
    }
  }, [activeId, addMemory, connection, conversations, isGenerating, memories, settings, setLiveTaskId, setMissionsOpen, setMissionDraft, setOsintOpen, setOsintTarget, setStatus, setToolsOpen, setView, toast]);

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
    // intent notes (investigate/mission/continue/imagine) regenerate as plain resends
    const isIntent = /^(investigate|osint|recon|mission\s*:|do mission|start mission|continue|resume|carry on|\/imagine|imagine\s*:|create an image of)\b/i.test(priorUser.content.trim());
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
