import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { readFileSync } from 'fs';
import { setTimeout as delay } from 'timers/promises';

import { initMultiplayerGame, stepSimulation, DEFAULT_AI_PARAMS } from '../src/core/gameCore.ts';
import { emptyAiActions } from '../src/lib/ai.ts';
import { remapSimStateForClient } from '../src/lib/multiplayerRemap.ts';
import { mergeClientPlan } from '../game-server/src/clientPlans.ts';
import type { Unit } from '../src/types/game.ts';

const P1 = 'player_ai';
const P2 = 'player_ai_2';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function makeUnit(id: string, ownerId: string, q: number, r: number): Unit {
  return {
    id,
    ownerId,
    q,
    r,
    type: 'infantry',
    hp: 100,
    maxHp: 100,
    xp: 0,
    level: 1,
    armsLevel: 1,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
  };
}

function verifySharedSimulationAuthority(): void {
  const state = initMultiplayerGame(456, { width: 38, height: 38, seed: 456 });
  const p1City = state.cities.find(c => c.ownerId === P1);
  const p2City = state.cities.find(c => c.ownerId === P2);
  assert(p1City && p2City, 'expected both multiplayer capitals');

  state.units = [
    makeUnit('p1_unit', P1, p1City.q, p1City.r),
    makeUnit('p2_unit', P2, p2City.q, p2City.r),
  ];

  const next = stepSimulation(
    state,
    DEFAULT_AI_PARAMS,
    DEFAULT_AI_PARAMS,
    undefined,
    undefined,
    {
      humanPlansByPlayerId: {
        [P1]: {
          ...emptyAiActions(),
          moveTargets: [
            { unitId: 'p2_unit', toQ: p1City.q, toR: p1City.r },
            { unitId: 'p1_unit', toQ: p1City.q, toR: p1City.r },
          ],
        },
        [P2]: emptyAiActions(),
      },
    },
  );

  const p1Unit = next.units.find(u => u.id === 'p1_unit');
  const p2Unit = next.units.find(u => u.id === 'p2_unit');
  assert(p1Unit?.targetQ === p1City.q && p1Unit.targetR === p1City.r, 'owned move target should apply');
  assert(p2Unit?.targetQ === undefined && p2Unit?.targetR === undefined, 'cross-owner move target must be ignored');
}

function verifyServerPlanSanitizer(): void {
  const state = initMultiplayerGame(789, { width: 38, height: 38, seed: 789 });
  const p1City = state.cities.find(c => c.ownerId === P1);
  const p2City = state.cities.find(c => c.ownerId === P2);
  assert(p1City && p2City, 'expected both multiplayer capitals');
  state.units = [
    makeUnit('p1_unit', P1, p1City.q, p1City.r),
    makeUnit('p2_unit', P2, p2City.q, p2City.r),
  ];

  const merged = mergeClientPlan(
    emptyAiActions(),
    {
      moveTargets: [
        { unitId: 'p1_unit', toQ: p1City.q, toR: p1City.r },
        { unitId: 'p2_unit', toQ: p1City.q, toR: p1City.r },
        { unitId: 'p1_unit', toQ: 1.5, toR: p1City.r },
        { unitId: 'p1_unit', toQ: 9999, toR: 9999 },
      ],
      builds: [{ cityId: p1City.id, type: 'factory', q: p1City.q, r: p1City.r }],
      scouts: [{ targetQ: p2City.q, targetR: p2City.r }],
    },
    state,
    P1,
  );

  assert(merged.moveTargets.length === 1, 'only one owned finite in-map move should survive');
  assert(merged.moveTargets[0]?.unitId === 'p1_unit', 'sanitized move should be the owned unit');
  assert(merged.builds.length === 0, 'client builds must not be accepted over movement plan channel');
  assert(merged.scouts.length === 0, 'client scouts must not be accepted over movement plan channel');
}

function verifyMoraleRemap(): void {
  const state = initMultiplayerGame(321, { width: 38, height: 38, seed: 321 });
  state.combatMoraleState = new Map([
    ['a', { ownerId: P1, morale: 50 }],
    ['b', { ownerId: P2, morale: 75 }],
  ]);
  const guest = remapSimStateForClient(state, 'guest');
  assert(guest.combatMoraleState.get('a')?.ownerId === 'player_ai', 'guest should see P1 morale as opponent');
  assert(guest.combatMoraleState.get('b')?.ownerId === 'player_human', 'guest should see P2 morale as self');
}

function verifyFogAndCameraSourceGuards(): void {
  const hexGrid = readFileSync('src/components/game/HexGrid.tsx', 'utf8');
  assert(hexGrid.includes('opacity: 0.93'), 'unknown fog must be opaque enough to hide undiscovered terrain');
  assert(hexGrid.includes('if (!tile) return null;'), 'city markers must skip undiscovered city tiles');
  assert(hexGrid.includes('if (!tile) continue;'), 'building markers must skip undiscovered building tiles');
  assert(hexGrid.includes('for (const tile of discoveredTilesMap.values())'), 'terrain biomes must render from discovered tiles');
  assert(hexGrid.includes('tilesMap={discoveredTilesMap}'), 'mountain snow must use discovered tile map');
  assert(!hexGrid.includes('<MoveRangeOverlay fromQ={selectedHex.q} fromR={selectedHex.r} tiles={tiles}'), 'move overlay must not use full-map tiles');

  const gameScene = readFileSync('src/components/game/GameScene.tsx', 'utf8');
  const mapController = readFileSync('src/components/game/MapController.tsx', 'utf8');
  assert(gameScene.includes('playableCameraAnchorKey'), 'playable camera should wait for a concrete anchor');
  assert(gameScene.includes('playableInitialSnapRef.current == null'), 'playable camera should snap once after anchor arrives');
  assert(mapController.includes('lastAppliedTargetKeyRef'), 'map controller should apply changed initial targets');
}

function onceMessage(ws: WebSocket, predicate: (msg: any) => boolean, timeoutMs = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      reject(new Error('Timed out waiting for websocket message'));
    }, timeoutMs);
    const onMessage = (event: MessageEvent) => {
      const data = JSON.parse(String(event.data));
      if (!predicate(data)) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      resolve(data);
    };
    ws.addEventListener('message', onMessage);
  });
}

async function openClient(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', () => reject(new Error('websocket connection failed')), { once: true });
  });
  return ws;
}

async function waitForServer(proc: ChildProcessWithoutNullStreams): Promise<void> {
  let output = '';
  proc.stdout.on('data', chunk => {
    output += String(chunk);
  });
  proc.stderr.on('data', chunk => {
    output += String(chunk);
  });

  for (let i = 0; i < 80; i++) {
    if (output.includes('Fallen Empire game server listening')) return;
    if (proc.exitCode != null) throw new Error(`server exited early:\n${output}`);
    await delay(100);
  }
  throw new Error(`server did not start:\n${output}`);
}

async function verifyLiveRoomSlots(): Promise<void> {
  assert(typeof WebSocket !== 'undefined', 'Node runtime must provide WebSocket for live room test');
  const port = 36000 + Math.floor(Math.random() * 1000);
  const proc = spawn('npm', ['start'], {
    cwd: 'game-server',
    env: { ...process.env, PORT: String(port), MULTIPLAYER_TICK_MS: '60000' },
  });

  try {
    await waitForServer(proc);
    const roomId = `verify-${Date.now()}`;

    const host = await openClient(port);
    host.send(JSON.stringify({ type: 'join', roomId, role: 'host' }));
    await onceMessage(host, msg => msg.type === 'joined' && msg.role === 'host');

    const duplicateHost = await openClient(port);
    duplicateHost.send(JSON.stringify({ type: 'join', roomId, role: 'host' }));
    await onceMessage(duplicateHost, msg => msg.type === 'error' && /Host slot/.test(msg.message));

    const guest = await openClient(port);
    guest.send(JSON.stringify({ type: 'join', roomId, role: 'guest' }));
    await onceMessage(guest, msg => msg.type === 'joined' && msg.role === 'guest');

    const duplicateGuest = await openClient(port);
    duplicateGuest.send(JSON.stringify({ type: 'join', roomId, role: 'guest' }));
    await onceMessage(duplicateGuest, msg => msg.type === 'error' && /Guest slot/.test(msg.message));

    host.close();
    duplicateHost.close();
    guest.close();
    duplicateGuest.close();
  } finally {
    proc.kill();
  }
}

async function main(): Promise<void> {
  verifySharedSimulationAuthority();
  verifyServerPlanSanitizer();
  verifyMoraleRemap();
  verifyFogAndCameraSourceGuards();
  await verifyLiveRoomSlots();
  console.log('multiplayer authority/fog regression checks passed');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
