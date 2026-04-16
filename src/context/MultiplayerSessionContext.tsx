'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { MultiplayerSessionApi } from '@/hooks/useMultiplayerSession';

const MultiplayerSessionContext = createContext<MultiplayerSessionApi | null>(null);

export function MultiplayerSessionProvider({
  value,
  children,
}: {
  value: MultiplayerSessionApi;
  children: ReactNode;
}) {
  return <MultiplayerSessionContext.Provider value={value}>{children}</MultiplayerSessionContext.Provider>;
}

export function useMultiplayerSessionValue(): MultiplayerSessionApi | null {
  return useContext(MultiplayerSessionContext);
}
