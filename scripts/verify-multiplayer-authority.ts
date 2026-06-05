import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_AI_PARAMS, initMultiplayerGame, stepSimulation } from '../src/core/gameCore';
import { emptyAiActions } from '../src/lib/ai';
import { getUnitStats, type Unit } from '../src/types/game';
import type { SerializedSimState } from '../src/lib/simStateSerialization';

const P1 = 'player_ai';
const P2 = 'player_ai_2';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');

function makeTestUnit(id: string, ownerId: string, q: number, r: number): Unit {
  const stats = getUnitStats({ type: 'infantry', armsLevel: 1 });
  return {
    id,
    type: 'infantry',
    q,
    r,
    ownerId,
    hp: stats.maxHp,
    maxHp: stats.maxHp,
    xp: 0,
    level: 1,
    armsLevel: 1,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
  };
}

function assertCoreRejectsCrossOwnerMove(): void {
  const state = initMultiplayerGame(424242, { width: 24, height: 24 });
  const p1City = state.cities.find(c => c.ownerId === P1);
  const p2City = state.cities.find(c => c.ownerId === P2);
  assert(p1City, 'expected a player 1 city in multiplayer setup');
  assert(p2City, 'expected a player 2 city in multiplayer setup');
  const p1Unit = makeTestUnit('verify-p1-unit', P1, p1City.q, p1City.r);
  const p2Unit = makeTestUnit('verify-p2-unit', P2, p2City.q, p2City.r);
  const stateWithUnits = { ...state, units: [p1Unit, p2Unit] };

  const next = stepSimulation(
    stateWithUnits,
    DEFAULT_AI_PARAMS,
    DEFAULT_AI_PARAMS,
    undefined,
    undefined,
    {
      humanPlansByPlayerId: {
        [P1]: {
          ...emptyAiActions(),
          moveTargets: [
            { unitId: p2Unit.id, toQ: p1Unit.q, toR: p1Unit.r },
            { unitId: p1Unit.id, toQ: p2Unit.q, toR: p2Unit.r },
          ],
        },
        [P2]: emptyAiActions(),
      },
    },
  );

  const p1After = next.units.find(u => u.id === p1Unit.id);
  const p2After = next.units.find(u => u.id === p2Unit.id);
  assert(p1After, 'expected player 1 unit after simulation step');
  assert(p2After, 'expected player 2 unit after simulation step');
  assert.equal(p1After.targetQ, p2Unit.q, 'owned player 1 unit should accept its move target');
  assert.equal(p1After.targetR, p2Unit.r, 'owned player 1 unit should accept its move target');
  assert.notEqual(p2After.targetQ, p1Unit.q, 'player 1 plan must not retarget player 2 unit');
  assert.notEqual(p2After.targetR, p1Unit.r, 'player 1 plan must not retarget player 2 unit');
}

function assertFogRenderingUsesDiscoveredTiles(): void {
  const hexGrid = fs.readFileSync(path.join(repoRoot, 'src/components/game/HexGrid.tsx'), 'utf8');
  assert.match(hexGrid, /opacity:\s*0\.93/, 'unknown fog should remain near-opaque');
  assert.match(
    hexGrid,
    /for \(const tile of discoveredTilesMap\.values\(\)\) \{\s*groups\[tile\.biome\]\.push\(tile\);/s,
    'terrain biome groups should only include discovered tiles',
  );
  assert.match(
    hexGrid,
    /for \(const t of discoveredTilesMap\.values\(\)\)[\s\S]*isCoastalWaterTile\(t, discoveredTilesMap\)/,
    'shoreline layers should be computed from discovered tiles',
  );
  assert.match(
    hexGrid,
    /<MountainSnowLayer tiles=\{terrainBiomeGroups\.mountain\} tilesMap=\{discoveredTilesMap\} \/>/,
    'mountain snow should not render over undiscovered mountain tiles',
  );
  assert.match(
    hexGrid,
    /<UnknownFogOverlay tiles=\{undiscoveredTiles\} \/>/,
    'unknown fog overlay should cover undiscovered tiles',
  );
}

function assertServerSourceSanitizesPlans(): void {
  const server = fs.readFileSync(path.join(repoRoot, 'game-server/src/index.ts'), 'utf8');
  assert.match(server, /Number\.isInteger\(candidate\.toQ\)/, 'server should reject fractional move target q');
  assert.match(server, /Number\.isInteger\(candidate\.toR\)/, 'server should reject fractional move target r');
  assert.match(server, /unit\.ownerId !== playerId/, 'server should reject move targets for opponent units');
  assert.match(server, /room\.state\.tiles\.has\(tileKey\(raw\.toQ, raw\.toR\)\)/, 'server should reject off-map move targets');
  assert.doesNotMatch(server, /\.\.\.patch,/, 'server should not merge arbitrary client plan fields');
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForServerReady(server: ChildProcessWithoutNullStreams, output: { text: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`game server did not start:\n${output.text}`));
    }, 15_000);

    const onExit = (code: number | null): void => {
      clearTimeout(timeout);
      reject(new Error(`game server exited early with code ${code}:\n${output.text}`));
    };

    const onData = (chunk: Buffer): void => {
      output.text += chunk.toString();
      if (output.text.includes('Fallen Empire game server listening')) {
        clearTimeout(timeout);
        server.off('exit', onExit);
        resolve();
      }
    };

    server.stdout.on('data', onData);
    server.stderr.on('data', onData);
    server.once('exit', onExit);
  });
}

async function openSocket(url: string): Promise<WebSocket> {
  const SocketCtor = globalThis.WebSocket;
  assert(SocketCtor, 'Node global WebSocket is required for this regression script');
  const socket = new SocketCtor(url);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timed out connecting to ${url}`)), 5_000);
    socket.addEventListener('open', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
    socket.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error(`failed to connect to ${url}`));
    }, { once: true });
  });
  return socket;
}

function waitForMessage<T extends { type?: string }>(
  socket: WebSocket,
  predicate: (msg: T) => boolean,
  label: string,
  timeoutMs = 8_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.removeEventListener('message', onMessage);
      reject(new Error(`timed out waiting for ${label}`));
    }, timeoutMs);

    const onMessage = (event: MessageEvent): void => {
      const raw = typeof event.data === 'string' ? event.data : String(event.data);
      const msg = JSON.parse(raw) as T;
      if (!predicate(msg)) return;
      clearTimeout(timeout);
      socket.removeEventListener('message', onMessage);
      resolve(msg);
    };

    socket.addEventListener('message', onMessage);
  });
}

async function joinRoom(url: string, roomId: string, role: 'host' | 'guest'): Promise<WebSocket> {
  const socket = await openSocket(url);
  socket.send(JSON.stringify({ type: 'join', roomId, role }));
  return socket;
}

async function assertLiveServerAuthority(): Promise<void> {
  const port = 35_000 + Math.floor(Math.random() * 1_000);
  const roomId = `verify-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const output = { text: '' };
  const server = spawn('npm', ['run', 'game-server'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      MULTIPLAYER_TICK_MS: '250',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForServerReady(server, output);
    const url = `ws://127.0.0.1:${port}`;

    const host = await joinRoom(url, roomId, 'host');
    await waitForMessage(host, msg => msg.type === 'joined', 'host joined');

    const duplicateHost = await joinRoom(url, roomId, 'host');
    const duplicateHostError = await waitForMessage<{ type?: string; message?: string }>(
      duplicateHost,
      msg => msg.type === 'error',
      'duplicate host rejection',
    );
    assert.match(duplicateHostError.message ?? '', /Host slot is already occupied/);
    duplicateHost.close();

    const guest = await joinRoom(url, roomId, 'guest');
    await waitForMessage(guest, msg => msg.type === 'joined', 'guest joined');

    const duplicateGuest = await joinRoom(url, roomId, 'guest');
    const duplicateGuestError = await waitForMessage<{ type?: string; message?: string }>(
      duplicateGuest,
      msg => msg.type === 'error',
      'duplicate guest rejection',
    );
    assert.match(duplicateGuestError.message ?? '', /Room is full|Guest slot is already occupied/);
    duplicateGuest.close();

    const initialState = await waitForMessage<{ type?: string; payload?: SerializedSimState }>(
      host,
      msg => msg.type === 'state' && !!msg.payload,
      'initial state',
    );
    assert(initialState.payload, 'expected initial state payload');
    const initialCycle = initialState.payload.cycle;

    host.send(JSON.stringify({
      type: 'plan',
      plan: {
        moveTargets: [
          { unitId: 'missing-enemy-unit', toQ: 1, toR: 1 },
          { unitId: 'missing-owned-unit', toQ: 2.5, toR: 2 },
          { unitId: 'missing-owned-unit', toQ: -999, toR: -999 },
        ],
      },
    }));

    const nextState = await waitForMessage<{ type?: string; payload?: SerializedSimState }>(
      host,
      msg => msg.type === 'state' && !!msg.payload && msg.payload.cycle > initialCycle,
      'state after hostile plan',
    );
    assert(nextState.payload, 'expected next state payload');
    assert(nextState.payload.cycle > initialCycle, 'server should keep ticking after malformed hostile plan');

    host.close();
    guest.close();
    await wait(50);
  } finally {
    if (!server.killed && server.exitCode == null) server.kill('SIGTERM');
  }
}

async function main(): Promise<void> {
  assertCoreRejectsCrossOwnerMove();
  assertFogRenderingUsesDiscoveredTiles();
  assertServerSourceSanitizesPlans();
  await assertLiveServerAuthority();
  console.log('multiplayer authority and fog regressions verified');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
