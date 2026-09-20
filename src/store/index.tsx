// Store composition + compat hook.
// New code should import focused hooks (useSession / useLibrary / useChat).
// Existing screens keep working through useApp(), which merges all slices.

import React from 'react';
import { SessionProvider, useSession } from './session';
import { LibraryProvider, useLibrary } from './library';
import { ChatProvider, useChat } from './chat';

export { useSession, useLibrary, useChat };

export function StoreProviders({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <LibraryProvider>
        <ChatProvider>{children}</ChatProvider>
      </LibraryProvider>
    </SessionProvider>
  );
}

/** Compat merged hook — same shape as the legacy single context + new slices. */
export function useApp() {
  const session = useSession();
  const library = useLibrary();
  const chat = useChat();
  return { ...session, ...library, ...chat };
}
