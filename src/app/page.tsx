'use client';

import dynamic from 'next/dynamic';

// Dynamic import with SSR disabled — Three.js requires browser APIs
const GameScene = dynamic(
  () => import('@/components/game/GameScene'),
  { ssr: false }
);

export default function Home() {
  return (
    <main className="relative w-full h-screen">
      <GameScene />
    </main>
  );
}
