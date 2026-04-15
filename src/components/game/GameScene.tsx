'use client';

import { useEffect, useLayoutEffect, useMemo, useCallback, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import { Canvas, ThreeEvent, useThree } from '@react-three/fiber';
import { OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import HexGrid from './HexGrid';
import MapController, { MAP_CAMERA_OFFSET } from './MapController';
import GameHUD from '../ui/GameHUD';
import { useGameStore } from '@/store/useGameStore';
import { setAiParams } from '@/lib/aiParams';
import { axialToWorld, worldToAxial, HEX_RADIUS, tileKey, parseTileKey } from '@/types/game';
import { collectHumanStackKeysInScreenRect, hexFromClientOnMap } from '@/lib/mapBoxSelect';
import { useMultiplayerSession } from '@/hooks/useMultiplayerSession';

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

const UNIT_BOX_SELECT_MIN_DRAG_PX = 8;

function canStartUnitBoxSelect(): boolean {
  const s = useGameStore.getState();
  if (Date.now() < s.mapClickSuppressionUntilMs) return false;
  if (s.phase !== 'playing') return false;
  if (!['human_vs_ai', 'human_solo', 'battle_test', 'multiplayer'].includes(s.gameMode)) return false;
  if (s.assigningTacticalForSelectedStacks !== null || s.assigningTacticalForStack !== null) return false;
  if (s.splitStackPending !== null) return false;
  if (s.supplyViewTab === 'supply') return false;
  const bm =
    s.uiMode === 'build_mine' ||
    s.uiMode === 'build_quarry' ||
    s.uiMode === 'build_gold_mine' ||
    s.uiMode === 'build_logging_hut' ||
    s.uiMode === 'build_road' ||
    s.uiMode === 'build_defense';
  if (bm) return false;
  return true;
}

function HexInteractionPlane() {
  const selectHex = useGameStore(s => s.selectHex);
  const rightClickHex = useGameStore(s => s.rightClickHex);
  const setUnitBoxSelectRect = useGameStore(s => s.setUnitBoxSelectRect);
  const config = useGameStore(s => s.config);
  const { camera, gl } = useThree();
  const dragPaintRef = useRef(false);
  const lastPaintHexKeyRef = useRef<string | null>(null);
  const boxDragRef = useRef<{
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    altKey: boolean;
  } | null>(null);
  const boxSelectRafRef = useRef<number | null>(null);
  const boxSelectPendingRectRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const skipClickAfterBoxRef = useRef(false);
  const skipContextMenuAfterBoxRef = useRef(false);

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

  const handlePointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const isShiftLeftDrag = e.shiftKey && e.button === 0;
      const isRightDrag = e.button === 2;
      if (!isShiftLeftDrag && !isRightDrag) return;
      if (!canStartUnitBoxSelect()) return;
      e.stopPropagation();
      const el = gl.domElement;
      const startX = e.clientX;
      const startY = e.clientY;
      boxDragRef.current = { startX, startY, lastX: startX, lastY: startY, altKey: e.altKey };
      flushSync(() => {
        setUnitBoxSelectRect({ x0: startX, y0: startY, x1: startX, y1: startY });
      });
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }

      const onMove = (ev: PointerEvent) => {
        const b = boxDragRef.current;
        if (!b) return;
        b.lastX = ev.clientX;
        b.lastY = ev.clientY;
        boxSelectPendingRectRef.current = {
          x0: b.startX,
          y0: b.startY,
          x1: b.lastX,
          y1: b.lastY,
        };
        if (boxSelectRafRef.current == null) {
          boxSelectRafRef.current = requestAnimationFrame(() => {
            boxSelectRafRef.current = null;
            const r = boxSelectPendingRectRef.current;
            if (r) setUnitBoxSelectRect(r);
          });
        }
      };

      const onUp = (ev: PointerEvent) => {
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
        if (boxSelectRafRef.current != null) {
          cancelAnimationFrame(boxSelectRafRef.current);
          boxSelectRafRef.current = null;
        }
        boxSelectPendingRectRef.current = null;
        try {
          el.releasePointerCapture(ev.pointerId);
        } catch {
          /* ignore */
        }

        const b = boxDragRef.current;
        boxDragRef.current = null;
        setUnitBoxSelectRect(null);

        if (!b) return;

        const dx = b.lastX - b.startX;
        const dy = b.lastY - b.startY;
        const dist = Math.hypot(dx, dy);

        if (dist < UNIT_BOX_SELECT_MIN_DRAG_PX) {
          const hex = hexFromClientOnMap(
            ev.clientX,
            ev.clientY,
            camera,
            el,
            config.width,
            config.height,
          );
          if (hex) {
            if (ev.button === 2) {
              useGameStore.getState().rightClickHex(hex.q, hex.r);
              skipContextMenuAfterBoxRef.current = true;
            } else {
              selectHex(hex.q, hex.r);
            }
          }
          skipClickAfterBoxRef.current = true;
          return;
        }

        skipContextMenuAfterBoxRef.current = true;

        const s = useGameStore.getState();
        const minX = Math.min(b.startX, b.lastX);
        const maxX = Math.max(b.startX, b.lastX);
        const minY = Math.min(b.startY, b.lastY);
        const maxY = Math.max(b.startY, b.lastY);

        const keys = collectHumanStackKeysInScreenRect(
          s.units,
          s.cities,
          camera,
          el.getBoundingClientRect(),
          minX,
          minY,
          maxX,
          maxY,
        );

        if (keys.length === 0) {
          skipClickAfterBoxRef.current = true;
          return;
        }

        let finalKeys = keys;
        if (b.altKey) {
          const merged = new Set([...s.tacticalSelectedStackKeys, ...keys]);
          finalKeys = Array.from(merged).sort((a, c) => {
            const [aq, ar] = parseTileKey(a);
            const [cq, cr] = parseTileKey(c);
            return aq !== cq ? aq - cq : ar - cr;
          });
        }

        const [fq, fr] = parseTileKey(finalKeys[0]!);

        useGameStore.setState({
          pendingTacticalOrders: s.pendingTacticalOrders ?? {},
          tacticalSelectedStackKeys: finalKeys,
          tacticalOrderScope: 'selected',
          tacticalOrderScopeArmyId: null,
          selectedHex: { q: fq, r: fr },
          stackMoveUnitId: null,
          uiMode: 'normal',
          pendingMove: null,
          cityLogisticsOpen: false,
        });
        skipClickAfterBoxRef.current = true;
      };

      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
    },
    [camera, config.width, config.height, gl, selectHex, setUnitBoxSelectRect],
  );

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      if (skipClickAfterBoxRef.current) {
        skipClickAfterBoxRef.current = false;
        return;
      }
      if (dragPaintRef.current) {
        dragPaintRef.current = false;
        return;
      }
      const hex = getHexFromEvent(e);
      if (hex) selectHex(hex.q, hex.r);
    },
    [selectHex, getHexFromEvent],
  );

  const handleContextMenu = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      e.nativeEvent.preventDefault();
      if (skipContextMenuAfterBoxRef.current) {
        skipContextMenuAfterBoxRef.current = false;
        return;
      }
      const hex = getHexFromEvent(e);
      if (hex) rightClickHex(hex.q, hex.r);
    },
    [getHexFromEvent, rightClickHex],
  );

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[center[0], 0.01, center[1]]}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      <planeGeometry args={[size[0], size[1]]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

function UnitBoxSelectOverlay() {
  const rect = useGameStore(s => s.unitBoxSelectRect);
  if (!rect) return null;
  const left = Math.min(rect.x0, rect.x1);
  const top = Math.min(rect.y0, rect.y1);
  const rawW = Math.abs(rect.x1 - rect.x0);
  const rawH = Math.abs(rect.y1 - rect.y0);
  /** Min size so the marquee is visible immediately on pointerdown (0×0 would be invisible). */
  const width = Math.max(rawW, 2);
  const height = Math.max(rawH, 2);
  return (
    <div
      className="pointer-events-none fixed z-[88] box-border border-2 border-amber-300/90 bg-amber-400/20 shadow-[0_0_0_1px_rgba(0,0,0,0.35),0_0_20px_rgba(251,191,36,0.35)] backdrop-blur-[0.5px]"
      style={{ left, top, width, height, willChange: 'width, height, left, top' }}
      aria-hidden
    />
  );
}

// ─── Camera Target ─────────────────────────────────────────────────

function useCameraTarget(): [number, number, number] {
  const provinceCenters = useGameStore(s => s.provinceCenters);
  const cities = useGameStore(s => s.cities);
  const units = useGameStore(s => s.units);
  const config = useGameStore(s => s.config);
  const gameMode = useGameStore(s => s.gameMode);
  const phase = useGameStore(s => s.phase);
  const pendingCityHex = useGameStore(s => s.pendingCityHex);

  return useMemo(() => {
    // Battle test: frame the skirmish (no cities)
    if (gameMode === 'battle_test') {
      const u = units.find(x => x.ownerId.includes('human'));
      if (u) {
        const [x, z] = axialToWorld(u.q, u.r, HEX_RADIUS);
        return [x, 0, z];
      }
    }
    // Bot-vs-bot / online 1v1: center camera on capitals so both are visible
    if (
      (gameMode === 'bot_vs_bot' || gameMode === 'bot_vs_bot_4' || gameMode === 'spectate' || gameMode === 'multiplayer') &&
      cities.length >= 2
    ) {
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
  }, [gameMode, provinceCenters, cities, units, config, phase, pendingCityHex]);
}

// ─── Camera Zoom Controller ─────────────────────────────────────────

function CameraZoomController() {
  const phase = useGameStore(s => s.phase);
  const gameMode = useGameStore(s => s.gameMode);
  const { camera } = useThree();
  const prevPhaseRef = useRef(phase);
  const botZoomSet = useRef(false);
  const battleTestZoomSet = useRef(false);

  useEffect(() => {
    const cam = camera as THREE.OrthographicCamera;
    if (
      phase === 'playing' &&
      (gameMode === 'bot_vs_bot' || gameMode === 'bot_vs_bot_4' || gameMode === 'spectate' || gameMode === 'multiplayer') &&
      !botZoomSet.current
    ) {
      botZoomSet.current = true;
      cam.zoom = gameMode === 'bot_vs_bot_4' ? 10 : 14;
      cam.updateProjectionMatrix();
    }
    if (phase !== 'playing') botZoomSet.current = false;

    if (phase === 'playing' && gameMode === 'battle_test' && !battleTestZoomSet.current) {
      battleTestZoomSet.current = true;
      cam.zoom = 36;
      cam.updateProjectionMatrix();
    }
    if (phase !== 'playing') battleTestZoomSet.current = false;

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
  const { multiplayerActive, connecting, waitingForPeer, inviteUrl, netError } = useMultiplayerSession();
  const [inviteCopied, setInviteCopied] = useState(false);
  const generateWorld = useGameStore(s => s.generateWorld);
  const isGenerated = useGameStore(s => s.isGenerated);
  const phase = useGameStore(s => s.phase);
  const gameMode = useGameStore(s => s.gameMode);
  const liveTarget = useCameraTarget();
  const isBotWatch =
    gameMode === 'bot_vs_bot' || gameMode === 'bot_vs_bot_4' || gameMode === 'spectate' || gameMode === 'multiplayer';
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
    <div className="w-full h-screen bg-empire-dark relative" onContextMenu={e => e.preventDefault()}>
      {multiplayerActive && netError && (
        <div className="absolute inset-0 z-[200] flex flex-col items-center justify-center gap-3 bg-empire-dark/95 px-6 text-center text-empire-parchment text-sm pointer-events-auto">
          <p className="text-amber-200/90 max-w-md">{netError}</p>
          <p className="text-empire-parchment/55 text-xs max-w-md">
            From the repo root run <code className="text-empire-gold/80">npm run game-server</code> in a separate terminal, then refresh.
          </p>
        </div>
      )}
      {multiplayerActive && connecting && !netError && (
        <div className="absolute inset-0 z-[200] flex items-center justify-center bg-empire-dark/90 text-empire-parchment text-sm pointer-events-none">
          Connecting to multiplayer…
        </div>
      )}
      {multiplayerActive && waitingForPeer && !connecting && !netError && (
        <div className="absolute inset-0 z-[199] flex flex-col items-center justify-center gap-4 bg-black/55 px-4 text-center pointer-events-auto">
          <p className="text-empire-parchment font-cinzel text-lg tracking-wide">Waiting for opponent</p>
          <p className="text-empire-parchment/65 text-xs max-w-lg">
            Share this invite link (guest opens it on another machine or browser profile):
          </p>
          <div className="flex flex-col sm:flex-row gap-2 max-w-2xl w-full items-stretch justify-center">
            <code className="flex-1 text-left text-[11px] leading-relaxed break-all rounded border border-empire-gold/25 bg-black/40 px-3 py-2 text-empire-parchment/90">
              {inviteUrl}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(inviteUrl).then(() => {
                  setInviteCopied(true);
                  setTimeout(() => setInviteCopied(false), 2000);
                });
              }}
              className="shrink-0 px-4 py-2 rounded border border-empire-gold/50 bg-empire-gold/15 text-empire-gold text-sm hover:bg-empire-gold/25"
            >
              {inviteCopied ? 'Copied' : 'Copy link'}
            </button>
          </div>
        </div>
      )}
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

      <UnitBoxSelectOverlay />

      {/* Full HUD overlay */}
      <GameHUD />
    </div>
  );
}
