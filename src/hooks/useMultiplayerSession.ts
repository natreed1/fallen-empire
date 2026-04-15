'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useGameStore } from '@/store/useGameStore';
import { registerMultiplayerPlanSender } from '@/lib/multiplayerBridge';
import type { SerializedSimState } from '@/lib/simStateSerialization';

/**
 * Connects to the game server when URL has `mp` + `room`.
 * - `?mp=host&room=<uuid>` — creates match state (host must open first)
 * - `?mp=join&room=<uuid>` — second player
 */
export function useMultiplayerSession(): {
  multiplayerActive: boolean;
  connecting: boolean;
  peerCount: number | null;
  /** Host alone: show “share link” until guest connects. */
  waitingForPeer: boolean;
  inviteUrl: string;
  netError: string | null;
} {
  const searchParams = useSearchParams();
  const mp = searchParams.get('mp');
  const room = searchParams.get('room');
  const [connecting, setConnecting] = useState(false);
  const [peerCount, setPeerCount] = useState<number | null>(null);
  const [netError, setNetError] = useState<string | null>(null);

  const multiplayerActive = mp != null && room != null;

  const inviteUrl = useMemo(() => {
    if (typeof window === 'undefined' || !room) return '';
    return `${window.location.origin}/?mp=join&room=${encodeURIComponent(room)}`;
  }, [room]);

  /** Host until the second client connects (from `lobby.players`). */
  const waitingForPeer = mp === 'host' && peerCount === 1;

  useEffect(() => {
    if (!multiplayerActive || !room) return;

    const resolvedRole: 'host' | 'guest' = mp === 'join' || mp === 'guest' ? 'guest' : 'host';
    const wsUrl = process.env.NEXT_PUBLIC_MULTIPLAYER_WS_URL ?? 'ws://127.0.0.1:3333';
    setConnecting(true);
    setNetError(null);
    setPeerCount(null);

    const ws = new WebSocket(wsUrl);

    registerMultiplayerPlanSender(plan => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'plan', plan }));
      }
    });

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'join',
          roomId: room,
          role: resolvedRole === 'guest' ? 'guest' : 'host',
        }),
      );
    };

    ws.onmessage = ev => {
      try {
        const msg = JSON.parse(ev.data as string) as {
          type?: string;
          payload?: SerializedSimState;
          message?: string;
          players?: number;
          role?: string;
        };
        if (msg.type === 'lobby' && typeof msg.players === 'number') {
          setPeerCount(msg.players);
        }
        if (msg.type === 'state' && msg.payload) {
          useGameStore.getState().applyMultiplayerSnapshot(msg.payload, resolvedRole);
          setConnecting(false);
        }
        if (msg.type === 'error' && msg.message) {
          setNetError(msg.message);
          setConnecting(false);
        }
      } catch {
        /* ignore */
      }
    };

    ws.onerror = () => {
      setNetError('Could not connect to game server. Is it running? (npm run game-server)');
      setConnecting(false);
    };

    return () => {
      registerMultiplayerPlanSender(null);
      ws.close();
    };
  }, [multiplayerActive, room, mp]);

  return {
    multiplayerActive,
    connecting: multiplayerActive && connecting,
    peerCount,
    waitingForPeer,
    inviteUrl,
    netError,
  };
}
