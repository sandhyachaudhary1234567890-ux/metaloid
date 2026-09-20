import { useEffect } from 'react';
import { useApp } from '../lib/store';

export function useKeyboardShortcuts() {
  const { setPaletteOpen, paletteOpen, closeModal, setVoiceOpen, voiceOpen, newConversation, setView } = useApp();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
        return;
      }
      if (e.key === 'Escape') {
        closeModal();
        setPaletteOpen(false);
        setVoiceOpen(false);
        return;
      }
      if (mod && e.key.toLowerCase() === 'n') {
        // avoid hijacking when typing? allow anyway as new chat is safe
      }
      // global quick nav (when not typing)
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA';
      if (!typing && !mod) {
        if (e.key === '1') setView('home');
        if (e.key === '2') setView('chat');
        if (e.key === '3') setView('live');
      }
      void newConversation;
      void voiceOpen;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, setPaletteOpen, closeModal, setVoiceOpen, voiceOpen, newConversation, setView]);
}
