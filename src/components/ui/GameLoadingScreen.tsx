'use client';

import type { ReactNode } from 'react';

export function LoadingSpinner({ className = '' }: { className?: string }) {
  return (
    <div
      className={`h-11 w-11 rounded-full border-2 border-empire-gold/25 border-t-empire-gold animate-spin ${className}`}
      aria-hidden
    />
  );
}

/** Card body for in-game overlays (multiplayer, setup). Parent supplies positioning. */
export function EmpireLoadingCard({
  title,
  subtitle,
  children,
  showSpinner = true,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
  showSpinner?: boolean;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="w-full max-w-md rounded-2xl border border-empire-gold/40 bg-black/55 px-8 py-10 shadow-[0_0_48px_rgba(0,0,0,0.5)] backdrop-blur-md"
    >
      {showSpinner && (
        <div className="mb-6 flex justify-center">
          <LoadingSpinner />
        </div>
      )}
      <h2 className="text-center font-cinzel text-xl font-semibold tracking-wide text-empire-gold">{title}</h2>
      {subtitle ? (
        <p className="mt-3 text-center text-sm leading-relaxed text-empire-parchment/70">{subtitle}</p>
      ) : null}
      {children}
    </div>
  );
}

/** Full-viewport loading (Next.js dynamic import, Suspense, or standalone). */
export function GameLoadingScreen({
  title = 'Preparing the realm',
  message,
}: {
  title?: string;
  message?: string;
}) {
  return (
    <div className="flex h-full min-h-screen w-full items-center justify-center bg-gradient-to-b from-[#2a2438] via-empire-dark to-[#060508] px-4">
      <EmpireLoadingCard title={title} subtitle={message} />
    </div>
  );
}
