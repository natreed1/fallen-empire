import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync } from 'node:fs';
import WebSocket from 'ws';
import { emptyAiActions } from '../src/lib/ai.ts';
import { DEFAULT_AI_PARAMS, initMultiplayerGame, stepSimulation } from '../src/core/gameCore.ts';
import { sanitizeClientPlan } from '../game-server/src/clientPlans.ts';
import type { Unit } from '../src/types/game.ts';

const P1 = 'player_ai';
const P2 = 'player_ai_2';

function assertStaticGuards() {
  const core = readFileSync('src/core/gameCore.ts', 'utf8');
  assert.match(
    core,
    /unit && unit\.ownerId === aiPlayerId && unit\.hp > 0 && unit\.status !== 'fighting'/,
    'shared simulation must reject cross-owner move targets',
  );

  const store = readFileSync('src/store/useGameStore.ts', 'utf8');
  assert.match(
    store,
    /unit && unit\.ownerId === aiPlayerId && unit\.hp > 0 && unit\.status !== 'fighting'/,
    'client/store simulation mirror must reject cross-owner move targets',
  );
  assert.match(
    store,
    /shouldResetVision[\s\S]*visibleHexes: new Set<string>\(\), exploredHexes: new Set<string>\(\)/,
    'multiplayer snapshots must clear stale fog when entering a new map',
  );

  const hexGrid = readFileSync('src/components/game/HexGrid.tsx', 'utf8');
  assert.match(hexGrid, /opacity: 0\.93/, 'unknown fog must hide undiscovered terrain');
  assert.match(
    hexGrid,
    /for \(const tile of discoveredTilesMap\.values\(\)\)[\s\S]*return groups;/,
    'terrain biome groups must be built from discovered tiles',
  );
  assert.match(
    hexGrid,
    /<MountainSnowLayer tiles=\{terrainBiomeGroups\.mountain\} tilesMap=\{discoveredTilesMap\} \/>/,
    'mountain snow must not use undiscovered tiles',
  );

  const gameScene = readFileSync('src/components/game/GameScene.tsx', 'utf8');
  assert.doesNotMatch(
    gameScene,
    /if \(isPlayableCameraMode\) \{\s*prevPhaseForCameraRef\.current = phase;\s*return;\s*\}/,
    'playable camera must not skip the first playing target sync',
  );

  const mapController = readFileSync('src/components/game/MapController.tsx', 'utf8');
  assert.match(
    mapController,
    /currentTarget\.distanceToSquared\(nextTarget\) < 0\.0001/,
    'map controller must accept changed initial targets before user panning',
  );
}

function firstTileAwayFrom(state: ReturnType<typeof initMultiplayerGame>, q: number, r: number) {
  for (const tile of state.tiles.values()) {
    if (tile.q !== q || tile.r !== r) return tile;
  }
  throw new Error('Expected at least one alternate tile');
}

function assertPlanSanitizerAndSimulationAuthority() {
  const baseState = initMultiplayerGame(24681357, { width: 24, height: 24 });
  const p1City = baseState.cities.find(c => c.ownerId === P1);
  const p2City = baseState.cities.find(c => c.ownerId === P2);
  assert.ok(p1City, 'expected a P1 city in multiplayer seed');
  assert.ok(p2City, 'expected a P2 city in multiplayer seed');
  const p1Unit: Unit = {
    id: 'verify_p1_unit',
    type: 'infantry',
    ownerId: P1,
    q: p1City.q,
    r: p1City.r,
    hp: 100,
    maxHp: 100,
    xp: 0,
    level: 1,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
  };
  const p2Unit: Unit = {
    ...p1Unit,
    id: 'verify_p2_unit',
    ownerId: P2,
    q: p2City.q,
    r: p2City.r,
  };
  const state = { ...baseState, units: [p1Unit, p2Unit] };

  const p2Target = firstTileAwayFrom(state, p2Unit.q, p2Unit.r);
  const p1Target = firstTileAwayFrom(state, p1Unit.q, p1Unit.r);
  const sanitized = sanitizeClientPlan(
    {
      builds: [{ cityId: 'enemy-city', type: 'barracks', q: 1, r: 1 }],
      moveTargets: [
        { unitId: p1Unit.id, toQ: p1Target.q, toR: p1Target.r },
        { unitId: p2Unit.id, toQ: Infinity, toR: p2Target.r },
        { unitId: p2Unit.id, toQ: p2Target.q, toR: p2Target.r },
      ],
    },
    state,
    P2,
  );

  assert.deepEqual(sanitized.builds, [], 'client plans must not smuggle build actions');
  assert.deepEqual(sanitized.moveTargets, [
    { unitId: p2Unit.id, toQ: p2Target.q, toR: p2Target.r },
  ], 'client plans must allow only finite in-map owned move targets');

  const next = stepSimulation(
    state,
    DEFAULT_AI_PARAMS,
    DEFAULT_AI_PARAMS,
    undefined,
    undefined,
    {
      humanPlansByPlayerId: {
        [P1]: emptyAiActions(),
        [P2]: {
          ...emptyAiActions(),
          moveTargets: [{ unitId: p1Unit.id, toQ: p1Target.q, toR: p1Target.r }],
        },
      },
    },
  );
  const p1After = next.units.find(u => u.id === p1Unit.id);
  assert.ok(p1After, 'expected P1 unit after step');
  assert.notEqual(p1After.targetQ, p1Target.q, 'P2 plan must not retarget P1 unit targetQ');
  assert.notEqual(p1After.targetR, p1Target.r, 'P2 plan must not retarget P1 unit targetR');
}

function waitForServerReady(proc: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for server start. Output:\n${output}`));
    }, 15_000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('Fallen Empire game server listening')) {
        clearTimeout(timeout);
        resolve();
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.once('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`Server exited before ready with code ${code}. Output:\n${output}`));
    });
  });
}

function openSocket(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function waitForMessage(ws: WebSocket, predicate: (msg: any) => boolean): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for WebSocket message'));
    }, 5_000);
    const onMessage = (data: WebSocket.RawData) => {
      const msg = JSON.parse(String(data));
      if (predicate(msg)) {
        cleanup();
        resolve(msg);
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      ws.off('message', onMessage);
      ws.off('error', onError);
    };
    ws.on('message', onMessage);
    ws.on('error', onError);
  });
}

async function assertDuplicateRolesRejected() {
  const port = 35_173;
  const proc = spawn('./node_modules/.bin/tsx', ['game-server/src/index.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), MULTIPLAYER_TICK_MS: '10000' },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForServerReady(proc);
    const roomId = `authority-${Date.now()}`;

    const host = await openSocket(port);
    host.send(JSON.stringify({ type: 'join', roomId, role: 'host' }));
    await waitForMessage(host, msg => msg.type === 'joined' && msg.role === 'host');

    const duplicateHost = await openSocket(port);
    duplicateHost.send(JSON.stringify({ type: 'join', roomId, role: 'host' }));
    const hostError = await waitForMessage(duplicateHost, msg => msg.type === 'error');
    assert.match(hostError.message, /Host slot is already occupied/);
    duplicateHost.close();

    const guest = await openSocket(port);
    guest.send(JSON.stringify({ type: 'join', roomId, role: 'guest' }));
    await waitForMessage(guest, msg => msg.type === 'joined' && msg.role === 'guest');

    const duplicateGuest = await openSocket(port);
    duplicateGuest.send(JSON.stringify({ type: 'join', roomId, role: 'guest' }));
    const guestError = await waitForMessage(duplicateGuest, msg => msg.type === 'error');
    assert.match(guestError.message, /Room is full/);
    duplicateGuest.close();
    guest.close();
    host.close();
  } finally {
    await stopProcessGroup(proc);
  }
}

async function stopProcessGroup(proc: ChildProcessWithoutNullStreams): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  const exited = new Promise<void>(resolve => proc.once('exit', () => resolve()));
  if (proc.pid) {
    try {
      process.kill(-proc.pid, 'SIGTERM');
    } catch {
      proc.kill('SIGTERM');
    }
  } else {
    proc.kill('SIGTERM');
  }
  await Promise.race([
    exited,
    new Promise<void>(resolve => {
      setTimeout(() => {
        if (proc.exitCode === null && proc.signalCode === null) {
          if (proc.pid) {
            try {
              process.kill(-proc.pid, 'SIGKILL');
            } catch {
              proc.kill('SIGKILL');
            }
          } else {
            proc.kill('SIGKILL');
          }
        }
        resolve();
      }, 2_000);
    }),
  ]);
}

async function main() {
  assertStaticGuards();
  assertPlanSanitizerAndSimulationAuthority();
  await assertDuplicateRolesRejected();
  console.log('verify-multiplayer-authority: ok');
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
