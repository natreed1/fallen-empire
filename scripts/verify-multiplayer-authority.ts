import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import WebSocket from 'ws';
import {
  DEFAULT_AI_PARAMS,
  initMultiplayerGame,
  stepSimulation,
  type SimState,
} from '../src/core/gameCore.ts';
import { emptyAiActions, type AiActions } from '../src/lib/ai.ts';
import { sanitizeClientPlan } from '../game-server/src/clientPlans.ts';
import { type Unit } from '../src/types/game.ts';

const P1 = 'player_ai';
const P2 = 'player_ai_2';

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
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
  };
}

function testDirectSimulationAuthority(): void {
  const state = initMultiplayerGame(12345);
  const [city1, city2] = state.cities;
  assert(city1 && city2, 'expected multiplayer capitals');
  const hostUnit = makeUnit('host-unit', P1, city1.q, city1.r);
  const guestUnit = makeUnit('guest-unit', P2, city2.q, city2.r);
  const targetQ = city1.q;
  const targetR = city1.r;

  const attackPlan = emptyAiActions();
  attackPlan.moveTargets = [
    { unitId: guestUnit.id, toQ: targetQ, toR: targetR },
    { unitId: hostUnit.id, toQ: city2.q, toR: city2.r },
  ];

  const next = stepSimulation(
    { ...state, units: [hostUnit, guestUnit] },
    DEFAULT_AI_PARAMS,
    DEFAULT_AI_PARAMS,
    undefined,
    undefined,
    { humanPlansByPlayerId: { [P1]: attackPlan, [P2]: emptyAiActions() } },
  );

  const hostAfter = next.units.find(unit => unit.id === hostUnit.id);
  const guestAfter = next.units.find(unit => unit.id === guestUnit.id);
  assert(hostAfter, 'expected host unit to survive simulation step');
  assert(guestAfter, 'expected guest unit to survive simulation step');
  assert.equal(hostAfter.targetQ, city2.q, 'own unit should still accept valid move target');
  assert.equal(hostAfter.targetR, city2.r, 'own unit should still accept valid move target');
  assert.notEqual(guestAfter.targetQ, targetQ, 'P1 plan must not retarget P2 unit');
  assert.notEqual(guestAfter.targetR, targetR, 'P1 plan must not retarget P2 unit');
}

function testPlanSanitizer(): void {
  const state = initMultiplayerGame(67890);
  const [city1, city2] = state.cities;
  assert(city1 && city2, 'expected multiplayer capitals');
  const hostUnit = makeUnit('host-unit', P1, city1.q, city1.r);
  const guestUnit = makeUnit('guest-unit', P2, city2.q, city2.r);
  const withUnits: SimState = { ...state, units: [hostUnit, guestUnit] };

  const sanitized = sanitizeClientPlan(
    {
      builds: null,
      moveTargets: [
        { unitId: hostUnit.id, toQ: city2.q, toR: city2.r },
        { unitId: guestUnit.id, toQ: city1.q, toR: city1.r },
        { unitId: hostUnit.id, toQ: Number.NaN, toR: city2.r },
        { unitId: hostUnit.id, toQ: 999999, toR: 999999 },
        42,
      ],
    },
    P1,
    withUnits.units,
    withUnits.tiles,
  );

  assert.deepEqual(sanitized.moveTargets, [
    { unitId: hostUnit.id, toQ: city2.q, toR: city2.r },
  ]);

  const malformed = sanitizeClientPlan(
    { moveTargets: 123, recruits: null } satisfies Record<string, unknown>,
    P1,
    withUnits.units,
    withUnits.tiles,
  );
  assert.deepEqual(malformed, emptyAiActions(), 'malformed plan fields should be dropped');
}

function waitForMessage(ws: WebSocket, predicate: (msg: any) => boolean, timeoutMs = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for WebSocket message'));
    }, timeoutMs);
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
      reject(new Error('WebSocket closed before expected message'));
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      ws.off('message', onMessage);
      ws.off('close', onClose);
      ws.off('error', onError);
    };
    ws.on('message', onMessage);
    ws.on('close', onClose);
    ws.on('error', onError);
  });
}

async function connect(url: string): Promise<WebSocket> {
  const ws = new WebSocket(url);
  await once(ws, 'open');
  return ws;
}

async function waitForServerReady(proc: ChildProcessWithoutNullStreams): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for game server startup'));
    }, 10000);
    const onData = (chunk: Buffer) => {
      if (chunk.toString().includes('Fallen Empire game server listening')) {
        cleanup();
        resolve();
      }
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Game server exited before startup with code ${code}`));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      proc.stdout.off('data', onData);
      proc.stderr.off('data', onData);
      proc.off('exit', onExit);
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', onExit);
  });
}

async function closeSocket(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.CLOSED) return;
  ws.close();
  await Promise.race([
    once(ws, 'close'),
    new Promise(resolve => setTimeout(resolve, 1000)),
  ]);
}

async function testLiveServerGuards(): Promise<void> {
  const port = 39871;
  const server = spawn('node_modules/.bin/tsx', ['game-server/src/index.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      MULTIPLAYER_TICK_MS: '250',
    },
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const sockets: WebSocket[] = [];
  try {
    await waitForServerReady(server);
    const url = `ws://127.0.0.1:${port}`;
    const roomId = `authority-${Date.now()}`;

    const host = await connect(url);
    sockets.push(host);
    host.send(JSON.stringify({ type: 'join', roomId, role: 'host' }));
    await waitForMessage(host, msg => msg.type === 'joined' && msg.role === 'host');

    const duplicateHost = await connect(url);
    sockets.push(duplicateHost);
    duplicateHost.send(JSON.stringify({ type: 'join', roomId, role: 'host' }));
    await waitForMessage(duplicateHost, msg => msg.type === 'error' && /host slot/i.test(msg.message));

    const guest = await connect(url);
    sockets.push(guest);
    guest.send(JSON.stringify({ type: 'join', roomId, role: 'guest' }));
    await waitForMessage(guest, msg => msg.type === 'joined' && msg.role === 'guest');

    host.send(JSON.stringify({ type: 'plan', plan: { moveTargets: 123, builds: null } }));
    guest.send(JSON.stringify({
      type: 'plan',
      plan: {
        moveTargets: [
          { unitId: 'non-owned-or-missing', toQ: 0, toR: 0 },
          { unitId: 'bad', toQ: Number.NaN, toR: 0 },
        ],
      },
    }));
    await waitForMessage(host, msg => msg.type === 'state', 5000);
    assert.equal(server.exitCode, null, 'server should survive malformed client plans');
  } finally {
    await Promise.allSettled(sockets.map(closeSocket));
    if (server.pid && process.platform !== 'win32') {
      try {
        process.kill(-server.pid, 'SIGTERM');
      } catch {
        server.kill('SIGTERM');
      }
    } else {
      server.kill('SIGTERM');
    }
    await Promise.race([
      once(server, 'exit'),
      new Promise(resolve => setTimeout(resolve, 1000)),
    ]);
  }
}

async function main(): Promise<void> {
  testDirectSimulationAuthority();
  testPlanSanitizer();
  await testLiveServerGuards();
  console.log('multiplayer authority regression checks passed');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
