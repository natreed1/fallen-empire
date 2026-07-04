import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { DEFAULT_AI_PARAMS, initMultiplayerGame, stepSimulation, type SimState } from '../src/core/gameCore';
import { emptyAiActions, type AiActions } from '../src/lib/ai';
import type { Unit } from '../src/types/game';
import { mergePlans, sanitizeClientPlan } from '../game-server/src/clientPlans';

const P1 = 'player_ai';
const P2 = 'player_ai_2';

function destinationAwayFrom(state: SimState, unit: { q: number; r: number; targetQ?: number; targetR?: number }) {
  for (const tile of state.tiles.values()) {
    if (tile.q === unit.q && tile.r === unit.r) continue;
    if (tile.q === unit.targetQ && tile.r === unit.targetR) continue;
    return { toQ: tile.q, toR: tile.r };
  }
  throw new Error('No alternate destination found');
}

function emptyPlanWithMoves(moveTargets: AiActions['moveTargets']): AiActions {
  return { ...emptyAiActions(), moveTargets };
}

function stateWithTestUnits(seed: number): SimState {
  const state = initMultiplayerGame(seed);
  const p1City = state.cities.find(c => c.ownerId === P1);
  const p2City = state.cities.find(c => c.ownerId === P2);
  assert.ok(p1City, 'expected a P1 city in initial multiplayer state');
  assert.ok(p2City, 'expected a P2 city in initial multiplayer state');

  const mkUnit = (id: string, ownerId: string, q: number, r: number, originCityId: string): Unit => ({
    id,
    ownerId,
    q,
    r,
    originCityId,
    type: 'infantry',
    hp: 100,
    maxHp: 100,
    xp: 0,
    level: 1,
    armsLevel: 1,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
  });

  return {
    ...state,
    units: [
      mkUnit('p1-test-unit', P1, p1City.q, p1City.r, p1City.id),
      mkUnit('p2-test-unit', P2, p2City.q, p2City.r, p2City.id),
    ],
  };
}

function verifyDirectSimulationAuthority(): void {
  const state = stateWithTestUnits(12345);
  const p1Unit = state.units.find(u => u.ownerId === P1 && u.hp > 0);
  const p2Unit = state.units.find(u => u.ownerId === P2 && u.hp > 0);
  assert.ok(p1Unit, 'expected a P1 unit in initial multiplayer state');
  assert.ok(p2Unit, 'expected a P2 unit in initial multiplayer state');

  const ownDest = destinationAwayFrom(state, p1Unit);
  const enemyDest = destinationAwayFrom(state, p2Unit);
  const next = stepSimulation(
    state,
    DEFAULT_AI_PARAMS,
    DEFAULT_AI_PARAMS,
    undefined,
    undefined,
    {
      humanPlansByPlayerId: {
        [P1]: emptyPlanWithMoves([
          { unitId: p1Unit.id, ...ownDest },
          { unitId: p2Unit.id, ...enemyDest },
        ]),
        [P2]: emptyAiActions(),
      },
    },
  );

  const movedOwn = next.units.find(u => u.id === p1Unit.id);
  const protectedEnemy = next.units.find(u => u.id === p2Unit.id);
  assert.equal(movedOwn?.targetQ, ownDest.toQ, 'owned unit should accept its move order');
  assert.equal(movedOwn?.targetR, ownDest.toR, 'owned unit should accept its move order');
  assert.notEqual(
    `${protectedEnemy?.targetQ},${protectedEnemy?.targetR}`,
    `${enemyDest.toQ},${enemyDest.toR}`,
    'opponent unit must ignore move targets from another player plan',
  );
}

function verifyPlanSanitizer(): void {
  const state = stateWithTestUnits(67890);
  const p1Unit = state.units.find(u => u.ownerId === P1 && u.hp > 0);
  const p2Unit = state.units.find(u => u.ownerId === P2 && u.hp > 0);
  assert.ok(p1Unit, 'expected a P1 unit for sanitizer test');
  assert.ok(p2Unit, 'expected a P2 unit for sanitizer test');
  const ownDest = destinationAwayFrom(state, p1Unit);
  const enemyDest = destinationAwayFrom(state, p2Unit);

  const sanitized = sanitizeClientPlan(
    {
      builds: null,
      recruits: null,
      moveTargets: [
        { unitId: p1Unit.id, ...ownDest },
        { unitId: p2Unit.id, ...enemyDest },
        { unitId: p1Unit.id, toQ: Number.NaN, toR: ownDest.toR },
        { unitId: p1Unit.id, toQ: ownDest.toQ, toR: 0.5 },
        { unitId: 'missing-unit', ...ownDest },
        { unitId: p1Unit.id, toQ: 99999, toR: 99999 },
      ],
    },
    state,
    P1,
  );

  assert.deepEqual(sanitized.moveTargets, [{ unitId: p1Unit.id, ...ownDest }]);
  assert.equal(sanitized.builds.length, 0, 'unsupported fields should be dropped');
  assert.equal(sanitizeClientPlan({ moveTargets: 1 }, state, P1).moveTargets.length, 0);
  assert.equal(sanitizeClientPlan(null, state, P1).moveTargets.length, 0);

  const merged = mergePlans(
    emptyPlanWithMoves([{ unitId: p1Unit.id, toQ: p1Unit.q, toR: p1Unit.r }]),
    sanitized,
  );
  assert.deepEqual(merged.moveTargets, [{ unitId: p1Unit.id, ...ownDest }]);
}

async function waitForServerReady(server: ChildProcessWithoutNullStreams): Promise<void> {
  let output = '';
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 10_000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('Fallen Empire game server listening')) {
        clearTimeout(timer);
        resolve();
      }
    };
    server.stdout.on('data', onData);
    server.stderr.on('data', onData);
    server.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`server exited with code ${code}:\n${output}`));
    });
  });
}

async function connect(port: number): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  return socket;
}

async function waitForMessage(
  socket: WebSocket,
  predicate: (msg: Record<string, unknown>) => boolean,
  label: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error(`timed out waiting for ${label}`));
    }, 5_000);
    const onMessage = (raw: WebSocket.RawData) => {
      const msg = JSON.parse(String(raw)) as Record<string, unknown>;
      if (!predicate(msg)) return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(msg);
    };
    socket.on('message', onMessage);
  });
}

async function verifyLiveServerGuards(): Promise<void> {
  const port = 39000 + Math.floor(Math.random() * 1000);
  const server = spawn('npm', ['run', 'game-server'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const sockets: WebSocket[] = [];
  try {
    await waitForServerReady(server);

    const host = await connect(port);
    sockets.push(host);
    host.send(JSON.stringify({ type: 'join', roomId: 'authority-test', role: 'host' }));
    await waitForMessage(host, msg => msg.type === 'joined' && msg.playerSlot === P1, 'host join');

    const duplicateHost = await connect(port);
    sockets.push(duplicateHost);
    duplicateHost.send(JSON.stringify({ type: 'join', roomId: 'authority-test', role: 'host' }));
    const duplicateHostResponse = await waitForMessage(
      duplicateHost,
      msg => msg.type === 'error',
      'duplicate host rejection',
    );
    assert.match(String(duplicateHostResponse.message), /Host slot/i);

    const guest = await connect(port);
    sockets.push(guest);
    guest.send(JSON.stringify({ type: 'join', roomId: 'authority-test', role: 'guest' }));
    await waitForMessage(guest, msg => msg.type === 'joined' && msg.playerSlot === P2, 'guest join');

    guest.send(JSON.stringify({ type: 'plan', plan: { moveTargets: 1, builds: null, recruits: null } }));
    await delay(500);
    assert.equal(server.exitCode, null, 'malformed plan payload should not crash the server');
  } finally {
    for (const socket of sockets) socket.close();
    server.kill('SIGTERM');
    await delay(100);
  }
}

async function main(): Promise<void> {
  verifyDirectSimulationAuthority();
  verifyPlanSanitizer();
  await verifyLiveServerGuards();
  console.log('multiplayer authority regression checks passed');
  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
