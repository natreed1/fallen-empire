'use client';

import dynamic from 'next/dynamic';
import { Suspense } from 'react';
import { GameLoadingScreen } from '@/components/ui/GameLoadingScreen';

// Dynamic import with SSR disabled — Three.js requires browser APIs
const GameScene = dynamic(
  () => import('@/components/game/GameScene'),
  {
    ssr: false,
    loading: () => (
      <GameLoadingScreen
        title="Awakening the engine"
        message="Loading the map renderer and game client…"
      />
    ),
  },
);

/** `useSearchParams` in GameScene must be under Suspense (Next.js 14). */
function GameSceneShell() {
  return (
    <Suspense
      fallback={
        <GameLoadingScreen title="Almost there" message="Resolving play mode from the address…" />
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
