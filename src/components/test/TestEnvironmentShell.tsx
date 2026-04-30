'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef } from 'react';
import { GameLoadingScreen } from '@/components/ui/GameLoadingScreen';
import { useGameStore } from '@/store/useGameStore';
import type { TestEnvironmentSpec } from '@/lib/testEnvironments';

const GameScene = dynamic(
  () => import('@/components/game/GameScene'),
  {
    ssr: false,
    loading: () => (
      <GameLoadingScreen
        title="Preparing test environment"
        message="Loading the deterministic sandbox shell..."
      />
    ),
  },
);

function TestEnvironmentBanner({ environment }: { environment: TestEnvironmentSpec }) {
  return (
    <div className="pointer-events-none fixed left-4 top-4 z-[120] max-w-sm rounded border border-sky-400/35 bg-black/70 px-4 py-3 text-sm text-empire-parchment/85 shadow-2xl backdrop-blur-md">
      <p className="font-cinzel text-xs font-bold uppercase tracking-[0.18em] text-sky-200/90">
        AI Test Environment
      </p>
      <h1 className="mt-1 font-cinzel text-base font-semibold text-empire-gold">
        {environment.title}
      </h1>
      <p className="mt-1 text-xs leading-relaxed text-empire-parchment/60">
        {environment.description}
      </p>
    </div>
  );
}

function TestEnvironmentBootstrap({ environment }: { environment: TestEnvironmentSpec }) {
  const bootedRef = useRef(false);

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;

    const store = useGameStore.getState();
    if (environment.bootMode === 'battle_test') {
      store.startBattleTest();
      window.setTimeout(() => {
        const latest = useGameStore.getState();
        latest.openBattleModal();
        latest.setRealTimePaused(true);
      }, 0);
      return;
    }

    if (environment.bootMode === 'spectate') {
      store.generateWorld({
        width: 38,
        height: 38,
        seed: environment.seed ?? 910_000,
        ensureCornerLand: true,
        mapTerrain: 'continents',
      });
      store.startSpectateMatch({ opponentCount: environment.opponentCount ?? 1 });
      window.setTimeout(() => {
        useGameStore.getState().setRealTimePaused(true);
      }, 0);
    }
  }, [environment]);

  return <TestEnvironmentBanner environment={environment} />;
}

export function TestEnvironmentShell({ environment }: { environment: TestEnvironmentSpec }) {
  if (environment.bootMode === 'loading') {
    return (
      <main className="relative min-h-screen w-full bg-empire-dark">
        <GameLoadingScreen
          title="Awakening the engine"
          message="Loading screen sandbox: this route intentionally renders the start/loading state only."
        />
        <TestEnvironmentBanner environment={environment} />
      </main>
    );
  }

  return (
    <main className="relative min-h-screen w-full bg-empire-dark">
      <TestEnvironmentBootstrap environment={environment} />
      <GameScene />
    </main>
  );
}
