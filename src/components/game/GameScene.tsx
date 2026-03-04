'use client';

import { useEffect, useMemo, useCallback, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Canvas, ThreeEvent, useThree } from '@react-three/fiber';
import { OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import HexGrid from './HexGrid';
import MapController from './MapController';
import GameHUD from '../ui/GameHUD';
import { useGameStore } from '@/store/useGameStore';
import { setAiParams } from '@/lib/aiParams';
import { axialToWorld, worldToAxial, HEX_RADIUS } from '@/types/game';

/** Match scripts/train-ai.ts default (TRAIN_MAP_SIZE / TRAIN_MAP) so watch mode uses same small map. */
const TRAIN_MAP_SIZE = 38;

// ─── Scene Lighting ────────────────────────────────────────────────

function SceneLighting() {
  return (
    <>
      <ambientLight intensity={2.0} color="#ffffff" />
      <directionalLight
        position={[40, 100, 50]}
        intensity={1.5}
        color="#fff8e8"
      />
      <directionalLight position={[-40, 60, -30]} intensity={0.8} color="#d0e0ff" />
      <hemisphereLight args={['#ffffff', '#80a060', 0.6]} />
    </>
  );
}

// ─── Hex Click Interaction Plane ───────────────────────────────────

function HexInteractionPlane() {
  const selectHex = useGameStore(s => s.selectHex);
  const config = useGameStore(s => s.config);

  const { center, size } = useMemo(() => {
    const w = config.width;
    const h = config.height;
    const [minX, minZ] = axialToWorld(0, 0, HEX_RADIUS);
    const [maxX, maxZ] = axialToWorld(Math.max(0, w - 1), Math.max(0, h - 1), HEX_RADIUS);
    const margin = HEX_RADIUS * 4;
    const sizeX = Math.max(maxX - minX + margin, margin * 2);
    const sizeZ = Math.max(maxZ - minZ + margin, margin * 2);
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    return { center: [centerX, centerZ] as [number, number], size: [sizeX, sizeZ] as [number, number] };
  }, [config]);

  const getHexFromEvent = useCallback((e: { point: { x: number; z: number } }) => {
    const { x, z } = e.point;
    const [q, r] = worldToAxial(x, z, HEX_RADIUS);
    if (q >= 0 && q < config.width && r >= 0 && r < config.height) return { q, r };
    return null;
  }, [config]);

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const hex = getHexFromEvent(e);
    if (hex) selectHex(hex.q, hex.r);
  }, [selectHex, getHexFromEvent]);

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[center[0], 0.01, center[1]]}
      onClick={handleClick}
    >
      <planeGeometry args={[size[0], size[1]]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

// ─── Camera Target ─────────────────────────────────────────────────

function useCameraTarget(): [number, number, number] {
  const provinceCenters = useGameStore(s => s.provinceCenters);
  const cities = useGameStore(s => s.cities);
  const config = useGameStore(s => s.config);
  const gameMode = useGameStore(s => s.gameMode);

  return useMemo(() => {
    // Bot-vs-bot (2 or 4): center camera on capitals so all are visible
    if ((gameMode === 'bot_vs_bot' || gameMode === 'bot_vs_bot_4') && cities.length >= 2) {
      let sumX = 0, sumZ = 0;
      for (const c of cities) {
        const [x, z] = axialToWorld(c.q, c.r, HEX_RADIUS);
        sumX += x;
        sumZ += z;
      }
      return [sumX / cities.length, 0, sumZ / cities.length];
    }
    const humanCity = cities.find(c => c.ownerId.includes('human'));
    if (humanCity) {
      const [x, z] = axialToWorld(humanCity.q, humanCity.r, HEX_RADIUS);
      return [x, 0, z];
    }
    const firstCity = cities[0];
    if (firstCity) {
      const [x, z] = axialToWorld(firstCity.q, firstCity.r, HEX_RADIUS);
      return [x, 0, z];
    }
    if (provinceCenters.length > 0) {
      const c = provinceCenters[0];
      const [x, z] = axialToWorld(c.q, c.r, HEX_RADIUS);
      return [x, 0, z];
    }
    const [x, z] = axialToWorld(config.width / 2, config.height / 2, HEX_RADIUS);
    return [x, 0, z];
  }, [gameMode, provinceCenters, cities, config]);
}

// ─── Camera Zoom Controller ─────────────────────────────────────────

function CameraZoomController() {
  const phase = useGameStore(s => s.phase);
  const gameMode = useGameStore(s => s.gameMode);
  const { camera } = useThree();
  const prevPhaseRef = useRef(phase);
  const botZoomSet = useRef(false);

  useEffect(() => {
    const cam = camera as THREE.OrthographicCamera;
    if (phase === 'playing' && (gameMode === 'bot_vs_bot' || gameMode === 'bot_vs_bot_4') && !botZoomSet.current) {
      botZoomSet.current = true;
      cam.zoom = gameMode === 'bot_vs_bot_4' ? 10 : 14;
      cam.updateProjectionMatrix();
    }
    if (phase !== 'playing') botZoomSet.current = false;

    if (prevPhaseRef.current === 'place_city' && phase === 'playing' && gameMode === 'human_vs_ai') {
      const targetZoom = 35;
      const startZoom = cam.zoom;
      const duration = 1200;
      const startTime = Date.now();
      const animate = () => {
        const elapsed = Date.now() - startTime;
        const t = Math.min(1, elapsed / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        cam.zoom = startZoom + (targetZoom - startZoom) * eased;
        cam.updateProjectionMatrix();
        if (t < 1) requestAnimationFrame(animate);
      };
      animate();
    }
    prevPhaseRef.current = phase;
  }, [phase, gameMode, camera]);

  return null;
}

// ─── Escape Key Handler ─────────────────────────────────────────────

function useEscapeKey() {
  const deselectAll = useGameStore(s => s.deselectAll);
  const cancelBuilderBuild = useGameStore(s => s.cancelBuilderBuild);
  const uiMode = useGameStore(s => s.uiMode);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (uiMode === 'build_mine' || uiMode === 'build_quarry' || uiMode === 'build_gold_mine' || uiMode === 'build_road') {
          cancelBuilderBuild();
        } else {
          deselectAll();
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deselectAll, cancelBuilderBuild, uiMode]);
}

// ─── Main Scene ────────────────────────────────────────────────────

export default function GameScene() {
  const searchParams = useSearchParams();
  const generateWorld = useGameStore(s => s.generateWorld);
  const isGenerated = useGameStore(s => s.isGenerated);
  const phase = useGameStore(s => s.phase);
  const target = useCameraTarget();
  const [aiParamsLoadAttempted, setAiParamsLoadAttempted] = useState(false);

  useEscapeKey();

  const watchParam = searchParams.get('watch') ?? searchParams.get('mode');
  const watchMode = watchParam != null;
  const watchFour = watchParam === '4';

  // Generate map: 38x38 for ?watch (2 bot), skip for ?watch=4 (4-bot generates its own 52x52)
  useEffect(() => {
    if (!isGenerated && !watchFour) {
      generateWorld(watchMode ? { width: TRAIN_MAP_SIZE, height: TRAIN_MAP_SIZE } : undefined);
    }
  }, [isGenerated, generateWorld, watchMode, watchFour]);

  // Load champion AI params from public/ai-params.json (written by npm run train-ai)
  useEffect(() => {
    fetch('/ai-params.json')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) setAiParams(data);
        setAiParamsLoadAttempted(true);
      })
      .catch(() => setAiParamsLoadAttempted(true));
  }, []);

  // ?watch: auto-start 2-bot after map ready; ?watch=4: auto-start 4-bot (generates its own map)
  useEffect(() => {
    if (!aiParamsLoadAttempted || phase !== 'setup') return;
    if (watchFour) {
      useGameStore.getState().startFourBotVsBot();
      return;
    }
    if (watchMode && isGenerated) useGameStore.getState().startBotVsBot();
  }, [watchMode, watchFour, isGenerated, phase, aiParamsLoadAttempted]);

  const cameraPosition: [number, number, number] = [
    target[0] + 60, 80, target[2] + 60,
  ];

  return (
    <div className="w-full h-screen bg-empire-dark">
      <Canvas
        shadows
        gl={{
          antialias: true,
          toneMapping: THREE.NoToneMapping,
        }}
        dpr={[1, 2]}
      >
        <color attach="background" args={['#0f1a2a']} />
        <SceneLighting />

        <OrthographicCamera
          makeDefault
          position={cameraPosition}
          zoom={20}
          near={0.1}
          far={500}
        />

        <MapController target={target} />
        <CameraZoomController />
        <HexInteractionPlane />

        {isGenerated && <HexGrid />}
      </Canvas>

      {/* Full HUD overlay */}
      <GameHUD />
    </div>
  );
}
