'use client';

import type { ReactNode } from 'react';
import { EmpireLoadingCard } from '@/components/ui/GameLoadingScreen';

function MultiplayerBackdrop({
  zClass,
  pointerEventsClass,
  children,
}: {
  zClass: string;
  pointerEventsClass: 'pointer-events-auto' | 'pointer-events-none';
  children: ReactNode;
}) {
  return (
    <div
      className={`absolute inset-0 ${zClass} flex flex-col items-center justify-center bg-gradient-to-b from-[#1f1b2e]/97 via-empire-dark/96 to-[#08060d]/98 px-4 ${pointerEventsClass}`}
    >
      {children}
    </div>
  );
}

export function MultiplayerConnectingOverlay({ asGuest }: { asGuest: boolean }) {
  return (
    <MultiplayerBackdrop zClass="z-[200]" pointerEventsClass="pointer-events-auto">
      <EmpireLoadingCard
        title={asGuest ? 'Joining the match' : 'Connecting'}
        subtitle={
          asGuest
            ? 'Syncing with the host and loading the shared realm…'
            : 'Handshaking with the game server and loading match state…'
        }
      />
    </MultiplayerBackdrop>
  );
}

export function MultiplayerErrorOverlay({ message, hint }: { message: string; hint?: ReactNode }) {
  return (
    <MultiplayerBackdrop zClass="z-[200]" pointerEventsClass="pointer-events-auto">
      <EmpireLoadingCard title="Connection failed" subtitle={message} showSpinner={false}>
        {hint ? <div className="mt-5 text-center text-xs leading-relaxed text-empire-parchment/60">{hint}</div> : null}
      </EmpireLoadingCard>
    </MultiplayerBackdrop>
  );
}

export function MultiplayerWaitingForPeerOverlay({
  inviteUrl,
  inviteCopied,
  onCopy,
  peerCount,
}: {
  inviteUrl: string;
  inviteCopied: boolean;
  onCopy: () => void;
  peerCount: number | null;
}) {
  const peerLine =
    peerCount != null ? (
      <p className="mt-2 text-center text-xs text-violet-200/80">
        Players in hall: <span className="font-semibold tabular-nums text-violet-100">{peerCount}</span> / 2
      </p>
    ) : null;

  return (
    <MultiplayerBackdrop zClass="z-[199]" pointerEventsClass="pointer-events-auto">
      <EmpireLoadingCard
        title="Waiting for opponent"
        subtitle="Share the invite link — they should open it in another browser or device."
        showSpinner
      >
        {peerLine}
        <div className="mt-6 flex w-full flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-stretch">
          <code className="max-h-28 flex-1 overflow-y-auto text-left text-[11px] leading-relaxed break-all rounded-lg border border-empire-gold/25 bg-black/45 px-3 py-2.5 text-empire-parchment/90">
            {inviteUrl}
          </code>
          <button
            type="button"
            onClick={onCopy}
            className="shrink-0 rounded-lg border border-empire-gold/50 bg-empire-gold/15 px-4 py-2.5 text-sm font-medium text-empire-gold hover:bg-empire-gold/25"
          >
            {inviteCopied ? 'Copied' : 'Copy link'}
          </button>
        </div>
        <p className="mt-5 text-center text-[11px] italic text-empire-parchment/45">
          Listening for your rival to enter…
        </p>
      </EmpireLoadingCard>
    </MultiplayerBackdrop>
  );
}
