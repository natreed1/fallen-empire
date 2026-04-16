'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useGameStore } from '@/store/useGameStore';
import {
  registerMultiplayerPlanSender,
  registerMultiplayerSimControlSender,
  sendMultiplayerSimControl,
  type MultiplayerSimControlPayload,
} from '@/lib/multiplayerBridge';
import type { SerializedSimState } from '@/lib/simStateSerialization';
import type { SimSpeedMultiplier } from '@/store/useGameStore';

export type MultiplayerSimSettings = {
  tickMs: number;
  paused: boolean;
  speedMultiplier: SimSpeedMultiplier;
};

export type MultiplayerSessionApi = {
  multiplayerActive: boolean;
  connecting: boolean;
  peerCount: number | null;
  /** Host alone: show “share link” until guest connects. */
  waitingForPeer: boolean;
  inviteUrl: string;
  netError: string | null;
  /** From server: economy tick cadence and pause (guest read-only in UI). */
  mpSimSettings: MultiplayerSimSettings | null;
  isMultiplayerHost: boolean;
  sendMultiplayerSimControl: (payload: MultiplayerSimControlPayload) => void;
};

/**
 * Connects to the game server when URL has `mp` + `room`.
 * - `?mp=host&room=<uuid>` — creates match state (host must open first)
 * - `?mp=join&room=<uuid>` — second player
 */
export function useMultiplayerSession(): MultiplayerSessionApi {
  const searchParams = useSearchParams();
  const mp = searchParams.get('mp');
  const room = searchParams.get('room');
  const [connecting, setConnecting] = useState(false);
  const [peerCount, setPeerCount] = useState<number | null>(null);
  const [netError, setNetError] = useState<string | null>(null);
  const [mpSimSettings, setMpSimSettings] = useState<MultiplayerSimSettings | null>(null);

  const multiplayerActive = mp != null && room != null;
  const isMultiplayerHost = multiplayerActive && mp !== 'join' && mp !== 'guest';

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
    setMpSimSettings(null);

    const ws = new WebSocket(wsUrl);

    registerMultiplayerPlanSender(plan => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'plan', plan }));
      }
    });

    registerMultiplayerSimControlSender(payload => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (resolvedRole !== 'host') return;
      ws.send(JSON.stringify({ type: 'sim_control', ...payload }));
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
          tickMs?: number;
          paused?: boolean;
          speedMultiplier?: number;
        };
        const applyMpSim = () => {
          const tickMs = typeof msg.tickMs === 'number' ? msg.tickMs : 4000;
          const sp = msg.speedMultiplier;
          const speedOk = sp === 0.5 || sp === 1 || sp === 2 || sp === 4;
          setMpSimSettings({
            tickMs,
            paused: Boolean(msg.paused),
            speedMultiplier: speedOk ? sp : 1,
          });
        };
        if (msg.type === 'lobby' && typeof msg.players === 'number') {
          setPeerCount(msg.players);
          applyMpSim();
        }
        if (msg.type === 'sim_settings') {
          applyMpSim();
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
      registerMultiplayerSimControlSender(null);
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
    mpSimSettings,
    isMultiplayerHost,
    sendMultiplayerSimControl,
  };
}
