'use client';

import { useEffect, useRef } from 'react';
import { useGameStore } from '@/store/useGameStore';
import {
  playNotification,
  playVictory,
  playDefeat,
  playBuildComplete,
  playCombat,
  playCityFounded,
  resumeAudioContext,
} from '@/lib/sound';

/**
 * Listens to game phase and notifications and drives medieval pixel-art music + SFX.
 */
export default function SoundController() {
  const phase = useGameStore(s => s.phase);
  const notifications = useGameStore(s => s.notifications);
  const playedVictoryRef = useRef(false);
  const prevNotifCountRef = useRef(notifications.length);
  const lastNotifIdRef = useRef<string | null>(
    notifications.length > 0 ? notifications[notifications.length - 1].id : null
  );

  // Resume AudioContext on first user interaction (browser policy)
  useEffect(() => {
    const resume = () => {
      resumeAudioContext();
      document.removeEventListener('click', resume);
      document.removeEventListener('keydown', resume);
    };
    document.addEventListener('click', resume, { once: true });
    document.addEventListener('keydown', resume, { once: true });
    return () => {
      document.removeEventListener('click', resume);
      document.removeEventListener('keydown', resume);
    };
  }, []);

  // Music disabled for now
  useEffect(() => {
    if (phase !== 'victory') playedVictoryRef.current = false;
  }, [phase]);

  // Victory / defeat fanfare once when entering victory phase
  useEffect(() => {
    if (phase !== 'victory' || playedVictoryRef.current) return;
    playedVictoryRef.current = true;
    const last = notifications[notifications.length - 1];
    const isWin = last?.type === 'success';
    if (isWin) playVictory();
    else playDefeat();
  }, [phase, notifications]);

  // SFX for new notifications
  useEffect(() => {
    const count = notifications.length;
    if (count === 0 || count <= prevNotifCountRef.current) {
      prevNotifCountRef.current = count;
      return;
    }

    const last = notifications[count - 1];
    if (last.id === lastNotifIdRef.current) {
      prevNotifCountRef.current = count;
      return;
    }
    lastNotifIdRef.current = last.id;
    prevNotifCountRef.current = count;

    const msg = (last.message || '').toLowerCase();
    if (msg.includes('founded') || msg.includes('empire rises')) {
      playCityFounded();
      return;
    }
    if (msg.includes('completed') && (msg.includes('at (') || msg.includes('barracks') || msg.includes('factory') || msg.includes('quarry') || msg.includes('mine') || msg.includes('road'))) {
      playBuildComplete();
      return;
    }
    if (msg.includes('defeated') || msg.includes('casualty') || msg.includes('combat') || msg.includes('attack') || msg.includes('captured')) {
      playCombat();
      return;
    }
    playNotification(last.type === 'success' || last.type === 'info');
  }, [notifications]);

  return null;
}
