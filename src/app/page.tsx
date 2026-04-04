'use client';

import dynamic from 'next/dynamic';
import { Suspense } from 'react';

// Dynamic import with SSR disabled — Three.js requires browser APIs
const GameScene = dynamic(
  () => import('@/components/game/GameScene'),
  {
    ssr: false,
    loading: () => (
      <div
        className="w-full h-screen bg-empire-dark"
        aria-hidden
      />
    ),
  },
);

/** `useSearchParams` in GameScene must be under Suspense (Next.js 14). */
function GameSceneShell() {
  return (
    <Suspense
      fallback={
        <div
          className="w-full h-screen bg-empire-dark flex items-center justify-center text-empire-parchment/50 text-sm"
        >
          Loading…
        </div>
      }
    >
      <GameScene />
    </Suspense>
  );
}

export default function Home() {
  return (
    <main className="relative w-full min-h-screen h-screen bg-empire-dark">
      <GameSceneShell />
    </main>
  );
}
