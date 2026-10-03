// Library slice — owns personal memory only.
// Conversations/history live in the chat slice; settings in session.

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { MemoryItem } from '../lib/types';
import { storage, uid } from '../lib/storage';

interface LibraryValue {
  memories: MemoryItem[];
  addMemory: (content: string, category?: MemoryItem['category']) => void;
  updateMemory: (id: string, patch: Partial<MemoryItem>) => void;
  deleteMemory: (id: string) => void;
  /** Merge memories fetched from the account API (deduped by id). */
  importMemories: (rows: { id: string; content: string; category: MemoryItem['category']; createdAt: number }[]) => void;
}

const Ctx = createContext<LibraryValue | null>(null);

export function LibraryProvider({ children }: { children: React.ReactNode }) {
  const [memories, setMemories] = useState<MemoryItem[]>(() => storage.loadMemories());

  useEffect(() => storage.saveMemories(memories), [memories]);

  const addMemory = useCallback((content: string, category: MemoryItem['category'] = 'Personal') => {
    const item: MemoryItem = { id: uid('mem'), content: content.slice(0, 500), category, createdAt: Date.now() };
    setMemories((p) => [item, ...p]);
  }, []);
  const updateMemory = useCallback((id: string, patch: Partial<MemoryItem>) => {
    setMemories((p) => p.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);
  const deleteMemory = useCallback((id: string) => {
    setMemories((p) => p.filter((m) => m.id !== id));
  }, []);

  /** Additive merge — an existing local memory is never overwritten. */
  const importMemories = useCallback((rows: { id: string; content: string; category: MemoryItem['category']; createdAt: number }[]) => {
    if (!rows.length) return;
    setMemories((prev) => {
      const existing = new Set(prev.map((m) => m.id));
      const incoming = rows.filter((r) => !existing.has(r.id));
      if (!incoming.length) return prev;
      return [...incoming, ...prev].sort((a, b) => b.createdAt - a.createdAt);
    });
  }, []);

  return <Ctx.Provider value={{ memories, addMemory, updateMemory, deleteMemory, importMemories }}>{children}</Ctx.Provider>;
}

export function useLibrary(): LibraryValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLibrary outside LibraryProvider');
  return v;
}
