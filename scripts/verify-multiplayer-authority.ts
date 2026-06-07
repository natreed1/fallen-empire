import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { setTimeout as delay } from 'timers/promises';
import {
  DEFAULT_AI_PARAMS,
  initMultiplayerGame,
  stepSimulation,
} from '../src/core/gameCore';
import { emptyAiActions } from '../src/lib/ai';
import { getUnitStats, tileKey, type Tile, type Unit } from '../src/types/game';

const P1 = 'player_ai';
const P2 = 'player_ai_2';
const ROOT = resolve(__dirname, '..');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function makeInfantry(id: string, ownerId: string, tile: Tile): Unit {
  const stats = getUnitStats({ type: 'infantry', armsLevel: 1 });
  return {
    id,
    type: 'infantry',
    q: tile.q,
    r: tile.r,
    ownerId,
    hp: stats.maxHp,
    maxHp: stats.maxHp,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
  };
}

function landTileAwayFrom(tiles: Map<string, Tile>, avoid: Tile, minDistance: number): Tile {
  for (const tile of tiles.values()) {
    if (tile.biome === 'water' || tile.biome === 'mountain') continue;
    if (Math.abs(tile.q - avoid.q) + Math.abs(tile.r - avoid.r) >= minDistance) return tile;
  }
  throw new Error('Could not find a suitable land tile for the regression test');
}

function verifyMoveTargetsCannotCrossOwners(): void {
  const base = initMultiplayerGame(24681357, { width: 38, height: 38 });
  const p1City = base.cities.find(c => c.ownerId === P1);
  const p2City = base.cities.find(c => c.ownerId === P2);
  assert(p1City && p2City, 'Expected multiplayer capitals for both players');

  const p1Start = base.tiles.get(tileKey(p1City.q, p1City.r));
  const p2Start = base.tiles.get(tileKey(p2City.q, p2City.r));
  assert(p1Start && p2Start, 'Expected capital tiles');

  const p1Dest = landTileAwayFrom(base.tiles, p1Start, 5);
  const p2Dest = landTileAwayFrom(base.tiles, p2Start, 5);
  const p1Unit = makeInfantry('verify-p1-unit', P1, p1Start);
  const p2Unit = makeInfantry('verify-p2-unit', P2, p2Start);

  const malicious = stepSimulation(
    { ...base, units: [p1Unit, p2Unit] },
    DEFAULT_AI_PARAMS,
    DEFAULT_AI_PARAMS,
    undefined,
    undefined,
    {
      humanPlansByPlayerId: {
        [P1]: {
          ...emptyAiActions(),
          moveTargets: [{ unitId: p2Unit.id, toQ: p2Dest.q, toR: p2Dest.r }],
        },
        [P2]: emptyAiActions(),
      },
    },
  );
  const protectedEnemy = malicious.units.find(u => u.id === p2Unit.id);
  assert(protectedEnemy, 'Expected P2 unit after malicious step');
  assert(
    protectedEnemy.status === 'idle' && protectedEnemy.targetQ === undefined && protectedEnemy.targetR === undefined,
    'P1 plan must not be able to retarget a P2 unit',
  );

  const allowed = stepSimulation(
    { ...base, units: [p1Unit, p2Unit] },
    DEFAULT_AI_PARAMS,
    DEFAULT_AI_PARAMS,
    undefined,
    undefined,
    {
      humanPlansByPlayerId: {
        [P1]: {
          ...emptyAiActions(),
          moveTargets: [{ unitId: p1Unit.id, toQ: p1Dest.q, toR: p1Dest.r }],
        },
        [P2]: emptyAiActions(),
      },
    },
  );
  const movedOwnUnit = allowed.units.find(u => u.id === p1Unit.id);
  assert(movedOwnUnit, 'Expected P1 unit after allowed step');
  assert(
    movedOwnUnit.targetQ === p1Dest.q && movedOwnUnit.targetR === p1Dest.r,
    'P1 plan should still be able to move a P1 unit',
  );
}

function waitForServerReady(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolveReady, rejectReady) => {
    let output = '';
    const timeout = setTimeout(() => {
      rejectReady(new Error(`Timed out waiting for game server startup. Output:\n${output}`));
    }, 15000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('Fallen Empire game server listening')) {
        clearTimeout(timeout);
        resolveReady();
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', code => {
      clearTimeout(timeout);
      rejectReady(new Error(`Game server exited before startup with code ${code}. Output:\n${output}`));
    });
  });
}

async function openSocket(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolveOpen, rejectOpen) => {
    const timeout = setTimeout(() => rejectOpen(new Error('Timed out opening WebSocket')), 5000);
    ws.addEventListener('open', () => {
      clearTimeout(timeout);
      resolveOpen();
    }, { once: true });
    ws.addEventListener('error', () => {
      clearTimeout(timeout);
      rejectOpen(new Error('WebSocket connection failed'));
    }, { once: true });
  });
  return ws;
}

async function waitForMessage(
  ws: WebSocket,
  predicate: (message: any) => boolean,
  label: string,
): Promise<any> {
  return new Promise((resolveMessage, rejectMessage) => {
    const timeout = setTimeout(() => rejectMessage(new Error(`Timed out waiting for ${label}`)), 7000);
    ws.addEventListener('message', event => {
      const text = typeof event.data === 'string' ? event.data : String(event.data);
      const parsed = JSON.parse(text);
      if (predicate(parsed)) {
        clearTimeout(timeout);
        resolveMessage(parsed);
      }
    });
  });
}

async function verifyRoomSlotsRejectDuplicates(): Promise<void> {
  const port = 34620 + Math.floor(Math.random() * 1000);
  const child = spawn('npm', ['run', 'game-server'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), MULTIPLAYER_TICK_MS: '250' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForServerReady(child);
    const roomId = `verify-${Date.now()}`;
    const host = await openSocket(port);
    host.send(JSON.stringify({ type: 'join', roomId, role: 'host' }));
    await waitForMessage(host, msg => msg.type === 'joined' && msg.role === 'host', 'host join');

    const duplicateHost = await openSocket(port);
    duplicateHost.send(JSON.stringify({ type: 'join', roomId, role: 'host' }));
    const duplicateHostError = await waitForMessage(
      duplicateHost,
      msg => msg.type === 'error' && /Host slot is already taken/.test(msg.message),
      'duplicate host rejection',
    );
    assert(duplicateHostError, 'Expected duplicate host rejection');

    const guest = await openSocket(port);
    guest.send(JSON.stringify({ type: 'join', roomId, role: 'guest' }));
    await waitForMessage(guest, msg => msg.type === 'joined' && msg.role === 'guest', 'guest join');

    const extraGuest = await openSocket(port);
    extraGuest.send(JSON.stringify({ type: 'join', roomId, role: 'guest' }));
    const extraGuestError = await waitForMessage(
      extraGuest,
      msg => msg.type === 'error' && /Room is full/.test(msg.message),
      'full room rejection',
    );
    assert(extraGuestError, 'Expected full room rejection');

    const stateBeforeMalformedPlan = await waitForMessage(host, msg => msg.type === 'state', 'state before malformed plan');
    assert(stateBeforeMalformedPlan.payload, 'Expected authoritative state before malformed plan');
    host.send(JSON.stringify({ type: 'plan', plan: { builds: 'crash', moveTargets: 'crash' } }));
    await waitForMessage(host, msg => msg.type === 'state' && msg.payload.cycle > stateBeforeMalformedPlan.payload.cycle, 'state after malformed plan');

    host.close();
    guest.close();
    duplicateHost.close();
    extraGuest.close();
  } finally {
    child.kill();
    await delay(100);
  }
}

function verifyFogAndCameraSourceInvariants(): void {
  const hexGrid = readFileSync(resolve(ROOT, 'src/components/game/HexGrid.tsx'), 'utf8');
  const gameScene = readFileSync(resolve(ROOT, 'src/components/game/GameScene.tsx'), 'utf8');
  const mapController = readFileSync(resolve(ROOT, 'src/components/game/MapController.tsx'), 'utf8');

  assert(!hexGrid.includes('opacity: 0.62'), 'Unknown fog opacity must not expose hidden terrain');
  assert(hexGrid.includes('opacity: 0.93'), 'Unknown fog overlay should be opaque');
  assert(
    (hexGrid.match(/for \(const tile of discoveredTilesMap\.values\(\)\)/g) ?? []).length >= 2,
    'Terrain and shoreline layers should render from discovered tiles only',
  );
  assert(hexGrid.includes('if (!tile) return null;'), 'City markers must skip undiscovered city tiles');
  assert(hexGrid.includes('if (!tile) continue;'), 'Building markers must skip undiscovered building tiles');
  assert(hexGrid.includes('tilesMap={discoveredTilesMap}'), 'Mountain snow should use discovered tile heights only');
  assert(
    gameScene.includes("if (phase !== 'playing' || enteredPlaying)") &&
      gameScene.includes('setMapTarget(liveTarget);'),
    'Playable camera should sync to the first playing target',
  );
  assert(mapController.includes('alreadyAtTarget'), 'MapController should reapply a corrected initial target');
}

async function main(): Promise<void> {
  verifyMoveTargetsCannotCrossOwners();
  await verifyRoomSlotsRejectDuplicates();
  verifyFogAndCameraSourceInvariants();
  console.log('Multiplayer authority and fog/camera regressions passed.');
}

void main().catch(err => {
  console.error(err);
  process.exit(1);
});
