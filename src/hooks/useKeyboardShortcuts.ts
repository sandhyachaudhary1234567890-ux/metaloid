import { useEffect } from 'react';
import { useApp } from '../lib/store';

/**
 * Global accelerators. `disabled` is used while the sign-in gate is up so a
 * keystroke cannot open a palette or a voice overlay behind the auth screen.
 */
export function useKeyboardShortcuts(disabled = false) {
  const { setPaletteOpen, paletteOpen, closeModal, setVoiceOpen, voiceOpen, newConversation, setView } = useApp();

  useEffect(() => {
    if (disabled) return;
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
        if (e.key === '1') setView('chat');
        if (e.key === '2') setView('history');
        if (e.key === '3') setView('live');
      }
      void newConversation;
      void voiceOpen;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, setPaletteOpen, closeModal, setVoiceOpen, voiceOpen, newConversation, setView]);
}
