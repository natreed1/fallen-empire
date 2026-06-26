/**
 * Critical multiplayer authority checks.
 * Run from repo root after installing game-server deps:
 *   npm exec --yes tsx -- scripts/verify-multiplayer-authority.ts
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_AI_PARAMS,
  initMultiplayerGame,
  stepSimulation,
  type SimState,
} from '../src/core/gameCore';
import { emptyAiActions } from '../src/lib/ai';
import type { Unit } from '../src/types/game';
import { sanitizeClientPlanPatch } from '../game-server/src/clientPlans';

const P1 = 'player_ai';
const P2 = 'player_ai_2';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gameServerRoot = path.join(repoRoot, 'game-server');
const gameServerRequire = createRequire(path.join(gameServerRoot, 'package.json'));
const { WebSocket } = gameServerRequire('ws') as { WebSocket: WebSocketCtor };

type WebSocketCtor = new (url: string) => TestWebSocket;

type TestWebSocket = {
  on(event: 'open' | 'message' | 'error' | 'close', listener: (...args: unknown[]) => void): void;
  once(event: 'open' | 'message' | 'error' | 'close', listener: (...args: unknown[]) => void): void;
  off(event: 'open' | 'message' | 'error' | 'close', listener: (...args: unknown[]) => void): void;
  send(data: string): void;
  close(): void;
};

type ServerMessage = {
  type?: string;
  message?: string;
  playerSlot?: string;
};

function makeUnit(id: string, ownerId: string, q: number, r: number): Unit {
  return {
    id,
    type: 'infantry',
    q,
    r,
    ownerId,
    hp: 100,
    maxHp: 100,
    xp: 0,
    level: 0,
    armsLevel: 1,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
  };
}

function makeStateWithUnits(): { state: SimState; p1Unit: Unit; p2Unit: Unit } {
  const state = initMultiplayerGame(424242);
  const p1City = state.cities.find(city => city.ownerId === P1);
  const p2City = state.cities.find(city => city.ownerId === P2);
  assert(p1City, 'expected player 1 city');
  assert(p2City, 'expected player 2 city');

  const p1Unit = makeUnit('p1-infantry', P1, p1City.q, p1City.r);
  const p2Unit = makeUnit('p2-infantry', P2, p2City.q, p2City.r);
  return { state: { ...state, units: [p1Unit, p2Unit] }, p1Unit, p2Unit };
}

function verifyPlanSanitizer(): void {
  const { state, p1Unit, p2Unit } = makeStateWithUnits();
  const p2City = state.cities.find(city => city.ownerId === P2);
  assert(p2City, 'expected player 2 city');

  const sanitized = sanitizeClientPlanPatch(
    {
      moveTargets: [
        { unitId: p2Unit.id, toQ: p2City.q, toR: p2City.r },
        { unitId: p1Unit.id, toQ: p2City.q, toR: p2City.r },
        { unitId: p1Unit.id, toQ: Number.POSITIVE_INFINITY, toR: p2City.r },
        { unitId: p1Unit.id, toQ: p2City.q, toR: 999999 },
      ],
      builds: [{ cityId: 'enemy-city', type: 'barracks', q: p2City.q, r: p2City.r }],
    },
    state,
    P1,
  );

  assert.deepEqual(sanitized, {
    moveTargets: [{ unitId: p1Unit.id, toQ: p2City.q, toR: p2City.r }],
  });
}

function verifyStepSimulationAuthority(): void {
  const { state, p1Unit, p2Unit } = makeStateWithUnits();
  const p2City = state.cities.find(city => city.ownerId === P2);
  const p1City = state.cities.find(city => city.ownerId === P1);
  assert(p1City, 'expected player 1 city');
  assert(p2City, 'expected player 2 city');

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
            { unitId: p1Unit.id, toQ: p2City.q, toR: p2City.r },
            { unitId: p2Unit.id, toQ: p1City.q, toR: p1City.r },
          ],
        },
        [P2]: emptyAiActions(),
      },
    },
  );

  const p1After = next.units.find(unit => unit.id === p1Unit.id);
  const p2After = next.units.find(unit => unit.id === p2Unit.id);
  assert(p1After, 'expected player 1 unit after step');
  assert(p2After, 'expected player 2 unit after step');

  assert.equal(p1After.status, 'moving', 'owner move should still apply');
  assert.equal(p1After.targetQ, p2City.q, 'owner move target q should be retained');
  assert.equal(p1After.targetR, p2City.r, 'owner move target r should be retained');
  assert.equal(p2After.status, 'idle', 'cross-owner move must be ignored');
  assert.equal(p2After.targetQ, undefined, 'cross-owner target q must not be set');
  assert.equal(p2After.targetR, undefined, 'cross-owner target r must not be set');
}

function waitForServerReady(server: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const stdout = server.stdout;
    if (!stdout) {
      reject(new Error('game server stdout is not available'));
      return;
    }

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('timed out waiting for game server to listen'));
    }, 8000);

    const onStdout = (chunk: Buffer) => {
      if (chunk.toString().includes('Fallen Empire game server listening')) {
        cleanup();
        resolve();
      }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(new Error(`game server exited before ready (code ${code}, signal ${signal})`));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      stdout.off('data', onStdout);
      server.off('exit', onExit);
    };

    stdout.on('data', onStdout);
    server.once('exit', onExit);
  });
}

function connect(url: string): Promise<TestWebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const onOpen = () => {
      cleanup();
      resolve(socket);
    };
    const onError = (err: unknown) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      socket.off('open', onOpen);
      socket.off('error', onError);
    };

    socket.once('open', onOpen);
    socket.once('error', onError);
  });
}

function waitForMessage(
  socket: TestWebSocket,
  predicate: (msg: ServerMessage) => boolean,
  label: string,
): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${label}`));
    }, 5000);

    const onMessage = (data: unknown) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(data)) as ServerMessage;
      } catch {
        return;
      }
      if (!predicate(msg)) return;
      cleanup();
      resolve(msg);
    };
    const onError = (err: unknown) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off('message', onMessage);
      socket.off('error', onError);
    };

    socket.on('message', onMessage);
    socket.once('error', onError);
  });
}

async function verifyLiveRoomAuthority(): Promise<void> {
  const port = 34800 + Math.floor(Math.random() * 1000);
  const server = spawn(path.join(gameServerRoot, 'node_modules', '.bin', 'tsx'), ['--tsconfig', 'tsconfig.json', 'src/index.ts'], {
    cwd: gameServerRoot,
    env: {
      ...process.env,
      PORT: String(port),
      MULTIPLAYER_TICK_MS: '60000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  server.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });

  const sockets: TestWebSocket[] = [];
  try {
    await waitForServerReady(server);
    const url = `ws://127.0.0.1:${port}`;
    const roomId = `authority-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const host = await connect(url);
    sockets.push(host);
    host.send(JSON.stringify({ type: 'join', roomId, role: 'host' }));
    const hostJoined = await waitForMessage(host, msg => msg.type === 'joined', 'host joined');
    assert.equal(hostJoined.playerSlot, P1);

    const duplicateHost = await connect(url);
    sockets.push(duplicateHost);
    duplicateHost.send(JSON.stringify({ type: 'join', roomId, role: 'host' }));
    const duplicateError = await waitForMessage(
      duplicateHost,
      msg => msg.type === 'error' && typeof msg.message === 'string',
      'duplicate host rejection',
    );
    assert.match(duplicateError.message ?? '', /host slot is already occupied/i);

    const invalidRole = await connect(url);
    sockets.push(invalidRole);
    invalidRole.send(JSON.stringify({ type: 'join', roomId, role: 'spectator' }));
    const invalidRoleError = await waitForMessage(
      invalidRole,
      msg => msg.type === 'error' && typeof msg.message === 'string',
      'invalid role rejection',
    );
    assert.match(invalidRoleError.message ?? '', /invalid multiplayer role/i);

    const guest = await connect(url);
    sockets.push(guest);
    guest.send(JSON.stringify({ type: 'join', roomId, role: 'guest' }));
    const guestJoined = await waitForMessage(guest, msg => msg.type === 'joined', 'guest joined');
    assert.equal(guestJoined.playerSlot, P2);

    guest.send(JSON.stringify({
      type: 'plan',
      plan: {
        moveTargets: [
          { unitId: 'not-owned', toQ: Number.POSITIVE_INFINITY, toR: 0 },
        ],
        builds: [{ cityId: 'forged', type: 'city_center', q: 0, r: 0 }],
      },
    }));
    await delay(100);
    assert.equal(server.exitCode, null, `server should ignore malformed plans without exiting: ${stderr}`);
  } finally {
    for (const socket of sockets) socket.close();
    if (server.exitCode === null) {
      server.kill('SIGTERM');
      await Promise.race([
        new Promise<void>(resolve => server.once('close', () => resolve())),
        delay(1000),
      ]);
    }
    if (server.exitCode === null) server.kill('SIGKILL');
  }
}

async function main(): Promise<void> {
  verifyPlanSanitizer();
  verifyStepSimulationAuthority();
  await verifyLiveRoomAuthority();
  console.log('verify-multiplayer-authority: ok');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
