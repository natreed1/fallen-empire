import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';

import {
  DEFAULT_AI_PARAMS,
  initMultiplayerGame,
  stepSimulation,
  type SimState,
} from '../src/core/gameCore.ts';
import { emptyAiActions } from '../src/lib/ai.ts';
import { remapSimStateForClient } from '../src/lib/multiplayerRemap.ts';
import { sanitizeClientPlan } from '../game-server/src/clientPlans.ts';
import { tileKey } from '../src/types/game.ts';

const P1 = 'player_ai';
const P2 = 'player_ai_2';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function findDifferentTile(state: SimState, q: number, r: number): { q: number; r: number } {
  for (const tile of state.tiles.values()) {
    if (tile.q !== q || tile.r !== r) return { q: tile.q, r: tile.r };
  }
  throw new Error('No alternate map tile found');
}

function verifyDirectSimulationAuthority(): void {
  const state = initMultiplayerGame(424242);
  const p1Unit = state.units.find(unit => unit.ownerId === P1 && unit.hp > 0);
  const p2Unit = state.units.find(unit => unit.ownerId === P2 && unit.hp > 0);
  assert(p1Unit, 'Expected a P1 unit in multiplayer seed');
  assert(p2Unit, 'Expected a P2 unit in multiplayer seed');

  const hostileDestination = findDifferentTile(state, p2Unit.q, p2Unit.r);
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
          moveTargets: [{ unitId: p2Unit.id, toQ: hostileDestination.q, toR: hostileDestination.r }],
        },
        [P2]: emptyAiActions(),
      },
    },
  );

  const p2After = next.units.find(unit => unit.id === p2Unit.id);
  assert(p2After, 'Expected P2 unit to remain after simulation step');
  assert(
    p2After.targetQ !== hostileDestination.q || p2After.targetR !== hostileDestination.r,
    'P1 plan retargeted a P2 unit',
  );

  const ownDestination = findDifferentTile(state, p1Unit.q, p1Unit.r);
  const ownMove = stepSimulation(
    state,
    DEFAULT_AI_PARAMS,
    DEFAULT_AI_PARAMS,
    undefined,
    undefined,
    {
      humanPlansByPlayerId: {
        [P1]: {
          ...emptyAiActions(),
          moveTargets: [{ unitId: p1Unit.id, toQ: ownDestination.q, toR: ownDestination.r }],
        },
        [P2]: emptyAiActions(),
      },
    },
  );
  const p1After = ownMove.units.find(unit => unit.id === p1Unit.id);
  assert(p1After, 'Expected P1 unit to remain after simulation step');
  assert(
    p1After.targetQ === ownDestination.q && p1After.targetR === ownDestination.r,
    'P1 owned move target was not applied',
  );
}

function verifyPlanSanitizer(): void {
  const state = initMultiplayerGame(777777);
  const p1Unit = state.units.find(unit => unit.ownerId === P1 && unit.hp > 0);
  const p2Unit = state.units.find(unit => unit.ownerId === P2 && unit.hp > 0);
  assert(p1Unit, 'Expected P1 unit for sanitizer test');
  assert(p2Unit, 'Expected P2 unit for sanitizer test');

  const dest = findDifferentTile(state, p1Unit.q, p1Unit.r);
  const sanitized = sanitizeClientPlan(state, P1, {
    builds: [{ cityId: 'enemy-city', type: 'city_center', q: 0, r: 0 }],
    moveTargets: [
      { unitId: p2Unit.id, toQ: dest.q, toR: dest.r },
      { unitId: p1Unit.id, toQ: 999999, toR: 999999 },
      { unitId: p1Unit.id, toQ: dest.q, toR: dest.r },
    ],
  });

  assert(sanitized.builds.length === 0, 'Sanitizer allowed non-move AI actions');
  assert(sanitized.moveTargets.length === 1, 'Sanitizer did not keep exactly one valid owned move');
  assert(sanitized.moveTargets[0].unitId === p1Unit.id, 'Sanitizer kept a foreign unit move');
  assert(sanitized.moveTargets[0].toQ === dest.q && sanitized.moveTargets[0].toR === dest.r, 'Sanitizer changed valid destination');

  const malformed = sanitizeClientPlan(state, P1, { moveTargets: {} });
  assert(malformed.moveTargets.length === 0, 'Malformed moveTargets payload should be ignored');
}

function verifyGuestRemap(): void {
  const state = initMultiplayerGame(24680);
  const towerHex = Array.from(state.tiles.values())[0];
  state.scoutTowers = [{ id: 'tower-p2', q: towerHex.q, r: towerHex.r, ownerId: P2 }];
  state.combatMoraleState = new Map([
    [`${tileKey(towerHex.q, towerHex.r)}:${P2}`, { ownerId: P2, morale: 42 }],
  ]);

  const remapped = remapSimStateForClient(state, 'guest');
  assert(remapped.scoutTowers[0]?.ownerId === 'player_human', 'Guest scout tower owner was not remapped to local human');
  const morale = remapped.combatMoraleState.get(`${tileKey(towerHex.q, towerHex.r)}:player_human`);
  assert(morale?.ownerId === 'player_human' && morale.morale === 42, 'Guest morale state was not remapped to local human');
}

function waitForServerReady(proc: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Timed out waiting for game server startup'));
      }
    }, 10_000);

    proc.stdout.on('data', chunk => {
      if (String(chunk).includes('Fallen Empire game server listening') && !settled) {
        settled = true;
        clearTimeout(timeout);
        resolve();
      }
    });
    proc.stderr.on('data', chunk => {
      const text = String(chunk);
      if (/Error|ERR_|Cannot find module/.test(text) && !settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(text.trim()));
      }
    });
    proc.on('exit', code => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`Game server exited before startup with code ${code}`));
      }
    });
  });
}

function openSocket(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function sendJson(socket: WebSocket, value: unknown): void {
  socket.send(JSON.stringify(value));
}

function waitForMessage(socket: WebSocket, predicate: (msg: any) => boolean, label: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${label}`));
    }, 10_000);

    const onMessage = (data: WebSocket.RawData) => {
      let parsed: any;
      try {
        parsed = JSON.parse(String(data));
      } catch {
        return;
      }
      if (predicate(parsed)) {
        cleanup();
        resolve(parsed);
      }
    };
    const onClose = () => {
      cleanup();
      reject(new Error(`Socket closed while waiting for ${label}`));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off('message', onMessage);
      socket.off('close', onClose);
    };

    socket.on('message', onMessage);
    socket.once('close', onClose);
  });
}

async function verifyLiveServerRoleAndMalformedPlan(): Promise<void> {
  const port = 38000 + Math.floor(Math.random() * 1000);
  const proc = spawn('node_modules/.bin/tsx', ['game-server/src/index.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), MULTIPLAYER_TICK_MS: '250' },
  });

  try {
    await waitForServerReady(proc);
    const roomId = `regression-${Date.now()}`;
    const host = await openSocket(port);
    const duplicateHost = await openSocket(port);
    sendJson(host, { type: 'join', roomId, role: 'host' });
    await waitForMessage(host, msg => msg.type === 'joined' && msg.role === 'host', 'host join');

    sendJson(duplicateHost, { type: 'join', roomId, role: 'host' });
    await waitForMessage(
      duplicateHost,
      msg => msg.type === 'error' && /host slot/i.test(String(msg.message)),
      'duplicate-host rejection',
    );
    duplicateHost.close();

    const guest = await openSocket(port);
    sendJson(guest, { type: 'join', roomId, role: 'guest' });
    await waitForMessage(guest, msg => msg.type === 'joined' && msg.role === 'guest', 'guest join');

    sendJson(guest, { type: 'plan', plan: { moveTargets: {} } });
    await delay(400);
    assert(proc.exitCode === null, 'Malformed client plan crashed the live game server');

    host.close();
    guest.close();
  } finally {
    proc.kill('SIGTERM');
    await delay(100);
    if (proc.exitCode === null) proc.kill('SIGKILL');
  }
}

function verifyStaticFogGuards(): void {
  const hexGrid = readFileSync('src/components/game/HexGrid.tsx', 'utf8');
  assert(hexGrid.includes('opacity: 0.93'), 'Unknown fog overlay opacity guard is missing');
  assert(
    /for \(const tile of discoveredTilesMap\.values\(\)\)/.test(hexGrid),
    'Terrain biome groups are not sourced from discovered tiles',
  );
  assert(
    /for \(const t of discoveredTilesMap\.values\(\)\)/.test(hexGrid),
    'Terrain shoreline is not sourced from discovered tiles',
  );
  assert(
    /<MountainSnowLayer tiles=\{terrainBiomeGroups\.mountain\} tilesMap=\{discoveredTilesMap\} \/>/.test(hexGrid),
    'Mountain snow still receives the full tile map',
  );

  const store = readFileSync('src/store/useGameStore.ts', 'utf8');
  assert(store.includes('visibleHexes: new Set(),'), 'Multiplayer snapshot does not reset visible hexes');
  assert(store.includes('exploredHexes: new Set(),'), 'Multiplayer snapshot does not reset explored hexes');

  const hud = readFileSync('src/components/ui/GameHUD.tsx', 'utf8');
  assert(hud.includes('Unknown terrain'), 'Side panel unknown terrain placeholder is missing');
  assert(hud.includes('const canSeeTileInfo = hexVisible || hexScouted || hexExplored;'), 'Side panel tile visibility guard is missing');
}

async function main(): Promise<void> {
  verifyDirectSimulationAuthority();
  verifyPlanSanitizer();
  verifyGuestRemap();
  verifyStaticFogGuards();
  await verifyLiveServerRoleAndMalformedPlan();
  console.log('Multiplayer authority and fog regression checks passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
