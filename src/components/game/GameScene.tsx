'use client';

import { useEffect, useLayoutEffect, useMemo, useCallback, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Canvas, ThreeEvent, useThree } from '@react-three/fiber';
import { OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import HexGrid from './HexGrid';
import MapController, { MAP_CAMERA_OFFSET } from './MapController';
import GameHUD from '../ui/GameHUD';
import { useGameStore } from '@/store/useGameStore';
import { setAiParams } from '@/lib/aiParams';
import { axialToWorld, worldToAxial, HEX_RADIUS, tileKey } from '@/types/game';

/** Match scripts/train-ai.ts default (TRAIN_MAP_SIZE / TRAIN_MAP) so watch mode uses same small map. */
const TRAIN_MAP_SIZE = 38;

// ─── Scene Lighting ────────────────────────────────────────────────

function SceneLighting() {
  return (
    <>
      <ambientLight intensity={1.25} color="#ebe6df" />
      <directionalLight
        position={[52, 118, 48]}
        intensity={2.05}
        color="#fff4dc"
      />
      <directionalLight position={[-42, 78, -32]} intensity={0.62} color="#a8b8e8" />
      <hemisphereLight args={['#f2ebe3', '#5c4a3a', 0.62]} />
    </>
  );
}

/** Gradient sky + soft exponential fog so the map reads as a lit tableau, not a void. */
function MapAtmosphere() {
  const { scene } = useThree();

  useLayoutEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#2a2438');
    g.addColorStop(0.28, '#16121f');
    g.addColorStop(0.55, '#0e0c14');
    g.addColorStop(1, '#060508');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 512);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const prevBg = scene.background;
    scene.background = tex;
    const prevFog = scene.fog;
    scene.fog = new THREE.FogExp2(0x121018, 0.00135);
    return () => {
      scene.background = prevBg;
      scene.fog = prevFog;
      tex.dispose();
    };
  }, [scene]);

  return null;
}

// ─── Hex Click Interaction Plane ───────────────────────────────────

function HexInteractionPlane() {
  const selectHex = useGameStore(s => s.selectHex);
  const config = useGameStore(s => s.config);
  const dragPaintRef = useRef(false);
  const lastPaintHexKeyRef = useRef<string | null>(null);

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

  const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    const s = useGameStore.getState();
    if (s.assigningTacticalForSelectedStacks?.orderType !== 'patrol_paint') return;
    if (e.buttons === 0) return;
    const hex = getHexFromEvent(e);
    if (!hex) return;
    const k = tileKey(hex.q, hex.r);
    if (lastPaintHexKeyRef.current === k) return;
    lastPaintHexKeyRef.current = k;
    s.addTacticalPatrolPaintHex(hex.q, hex.r);
    dragPaintRef.current = true;
  }, [getHexFromEvent]);

  const handlePointerUp = useCallback(() => {
    lastPaintHexKeyRef.current = null;
  }, []);

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (dragPaintRef.current) {
      dragPaintRef.current = false;
      return;
    }
    const hex = getHexFromEvent(e);
    if (hex) selectHex(hex.q, hex.r);
  }, [selectHex, getHexFromEvent]);

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[center[0], 0.01, center[1]]}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
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
  const phase = useGameStore(s => s.phase);
  const pendingCityHex = useGameStore(s => s.pendingCityHex);

  return useMemo(() => {
    // Bot-vs-bot (2 or 4): center camera on capitals so all are visible
    if ((gameMode === 'bot_vs_bot' || gameMode === 'bot_vs_bot_4' || gameMode === 'spectate') && cities.length >= 2) {
      let sumX = 0, sumZ = 0;
      for (const c of cities) {
        const [x, z] = axialToWorld(c.q, c.r, HEX_RADIUS);
        sumX += x;
        sumZ += z;
      }
      return [sumX / cities.length, 0, sumZ / cities.length];
    }
    // Placement: follow suggested / selected capital hex so the player is not lost on the full map
    if (
      (gameMode === 'human_vs_ai' || gameMode === 'human_solo') &&
      phase === 'place_city' &&
      pendingCityHex
    ) {
      const [x, z] = axialToWorld(pendingCityHex.q, pendingCityHex.r, HEX_RADIUS);
      return [x, 0, z];
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
  }, [gameMode, provinceCenters, cities, config, phase, pendingCityHex]);
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
    if (phase === 'playing' && (gameMode === 'bot_vs_bot' || gameMode === 'bot_vs_bot_4' || gameMode === 'spectate') && !botZoomSet.current) {
      botZoomSet.current = true;
      cam.zoom = gameMode === 'bot_vs_bot_4' ? 10 : 14;
      cam.updateProjectionMatrix();
    }
    if (phase !== 'playing') botZoomSet.current = false;

    if (
      (prevPhaseRef.current === 'place_city' || prevPhaseRef.current === 'starting_game') &&
      phase === 'playing' &&
      (gameMode === 'human_vs_ai' || gameMode === 'human_solo')
    ) {
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
  const escapeFromUi = useGameStore(s => s.escapeFromUi);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        escapeFromUi();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [escapeFromUi]);
}

// ─── Main Scene ────────────────────────────────────────────────────

export default function GameScene() {
  const searchParams = useSearchParams();
  const generateWorld = useGameStore(s => s.generateWorld);
  const isGenerated = useGameStore(s => s.isGenerated);
  const phase = useGameStore(s => s.phase);
  const gameMode = useGameStore(s => s.gameMode);
  const liveTarget = useCameraTarget();
  const isBotWatch = gameMode === 'bot_vs_bot' || gameMode === 'bot_vs_bot_4' || gameMode === 'spectate';
  const [mapTarget, setMapTarget] = useState(liveTarget);
  const [aiParamsLoadAttempted, setAiParamsLoadAttempted] = useState(false);
  const prevPhaseForCameraRef = useRef(phase);

  useEffect(() => {
    if (isBotWatch) {
      setMapTarget(liveTarget);
      prevPhaseForCameraRef.current = phase;
      return;
    }
    const enteredPlaying = prevPhaseForCameraRef.current !== 'playing' && phase === 'playing';
    // Keep syncing while not in the match (menus / placement); on first frame of play, snap to capital / live target
    if (phase !== 'playing' || enteredPlaying) {
      setMapTarget(liveTarget);
    }
    prevPhaseForCameraRef.current = phase;
  }, [liveTarget, phase, isBotWatch]);

  useEscapeKey();

  const watchParam = searchParams.get('watch') ?? searchParams.get('mode');
  const watchMode = watchParam != null;
  const watchFour = watchParam === '4';
  const sandboxMode = searchParams.get('sandbox') != null && !watchMode;

  // Generate map only for dev URLs — main menu generates when you start a match (?watch / ?sandbox use 38×38)
  useEffect(() => {
    if (!isGenerated && !watchFour && (watchMode || sandboxMode)) {
      generateWorld({ width: TRAIN_MAP_SIZE, height: TRAIN_MAP_SIZE });
    }
  }, [isGenerated, generateWorld, watchMode, watchFour, sandboxMode]);

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

  // ?watch (1v1): use champion from ai-params.json; map matches train-ai (38×38). Start only after params load attempted.
  useEffect(() => {
    if (!aiParamsLoadAttempted || phase !== 'setup') return;
    if (watchFour) {
      useGameStore.getState().startFourBotVsBot();
      return;
    }
    if (watchMode && isGenerated) useGameStore.getState().startBotVsBot();
  }, [watchMode, watchFour, isGenerated, phase, aiParamsLoadAttempted]);

  // ?sandbox: 38×38 map, human-only placement (no AI).
  useEffect(() => {
    if (!sandboxMode || !isGenerated || phase !== 'setup') return;
    useGameStore.getState().startSoloPlacement();
  }, [sandboxMode, isGenerated, phase]);

  const cameraPosition: [number, number, number] = [
    mapTarget[0] + MAP_CAMERA_OFFSET.x,
    mapTarget[1] + MAP_CAMERA_OFFSET.y,
    mapTarget[2] + MAP_CAMERA_OFFSET.z,
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
        <MapAtmosphere />
        <SceneLighting />

        <OrthographicCamera
          makeDefault
          position={cameraPosition}
          zoom={20}
          near={0.1}
          far={500}
        />

        <MapController target={mapTarget} />
        <CameraZoomController />
        <HexInteractionPlane />

        {isGenerated && <HexGrid />}
      </Canvas>

      {/* Full HUD overlay */}
      <GameHUD />
    </div>
  );
}
