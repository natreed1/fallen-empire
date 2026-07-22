import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolve } from 'node:path';
import { WebSocket } from 'ws';
import {
  DEFAULT_AI_PARAMS,
  initMultiplayerGame,
  stepSimulation,
} from '../src/core/gameCore';
import { emptyAiActions } from '../src/lib/ai';
import type { Unit } from '../src/types/game';
import { sanitizeClientPlan } from '../game-server/src/clientPlans';

function waitForServer(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolveReady, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`Server startup timed out:\n${output}`)), 20_000);
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
      reject(new Error(`Server exited with ${code}:\n${output}`));
    });
  });
}

function openSocket(url: string): Promise<WebSocket> {
  return new Promise((resolveSocket, reject) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolveSocket(socket));
    socket.once('error', reject);
  });
}

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolveMessage, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for WebSocket response')), 20_000);
    socket.once('message', data => {
      clearTimeout(timeout);
      resolveMessage(JSON.parse(String(data)) as Record<string, unknown>);
    });
  });
}

async function sendAndReceive(
  socket: WebSocket,
  message: string | Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = nextMessage(socket);
  socket.send(typeof message === 'string' ? message : JSON.stringify(message));
  return response;
}

function verifyPlanAuthority(): void {
  const state = initMultiplayerGame(731_991);
  const playerOneCity = state.cities.find(city => city.ownerId === 'player_ai');
  const playerTwoCity = state.cities.find(city => city.ownerId === 'player_ai_2');
  assert.ok(playerOneCity);
  assert.ok(playerTwoCity);
  const makeUnit = (id: string, ownerId: string, q: number, r: number): Unit => ({
    id,
    ownerId,
    q,
    r,
    type: 'infantry',
    hp: 100,
    maxHp: 100,
    xp: 0,
    level: 1,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
  });
  state.units = [
    makeUnit('player-one-unit', 'player_ai', playerOneCity.q, playerOneCity.r),
    makeUnit('player-two-unit', 'player_ai_2', playerTwoCity.q, playerTwoCity.r),
  ];
  const ownUnit = state.units.find(unit => unit.ownerId === 'player_ai' && unit.hp > 0);
  const opponentUnit = state.units.find(unit => unit.ownerId === 'player_ai_2' && unit.hp > 0);
  assert.ok(ownUnit, 'expected a living player-one unit');
  assert.ok(opponentUnit, 'expected a living player-two unit');

  const destination = Array.from(state.tiles.values()).find(
    tile => tile.q !== opponentUnit.q || tile.r !== opponentUnit.r,
  );
  assert.ok(destination, 'expected a valid destination');

  const sanitized = sanitizeClientPlan(
    {
      moveTargets: [
        { unitId: ownUnit.id, toQ: destination.q, toR: destination.r },
        { unitId: opponentUnit.id, toQ: destination.q, toR: destination.r },
        { unitId: ownUnit.id, toQ: Number.NaN, toR: destination.r },
      ],
      builds: [{ type: 'barracks', cityId: 'forged' }],
    },
    state,
    'player_ai',
  );
  assert.deepEqual(sanitized.moveTargets, [
    { unitId: ownUnit.id, toQ: destination.q, toR: destination.r },
  ]);
  assert.equal(sanitized.builds.length, 0, 'client must not submit economy actions');

  const beforeTarget = [opponentUnit.targetQ, opponentUnit.targetR, opponentUnit.status];
  const malicious = emptyAiActions();
  malicious.moveTargets = [
    { unitId: opponentUnit.id, toQ: destination.q, toR: destination.r },
  ];
  const after = stepSimulation(
    state,
    DEFAULT_AI_PARAMS,
    DEFAULT_AI_PARAMS,
    undefined,
    undefined,
    {
      humanPlansByPlayerId: {
        player_ai: malicious,
        player_ai_2: emptyAiActions(),
      },
    },
  );
  const protectedUnit = after.units.find(unit => unit.id === opponentUnit.id);
  assert.ok(protectedUnit);
  assert.deepEqual(
    [protectedUnit.targetQ, protectedUnit.targetR, protectedUnit.status],
    beforeTarget,
    'player-one plan changed a player-two unit',
  );
}

async function verifyLiveAdmission(): Promise<void> {
  const port = 35_000 + Math.floor(Math.random() * 1_000);
  const server = spawn(
    resolve('node_modules/.bin/tsx'),
    ['--tsconfig', 'tsconfig.json', 'src/index.ts'],
    {
      cwd: resolve('game-server'),
      env: { ...process.env, PORT: String(port), MULTIPLAYER_TICK_MS: '60000' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const sockets: WebSocket[] = [];
  try {
    await waitForServer(server);
    const url = `ws://127.0.0.1:${port}`;
    const host = await openSocket(url);
    sockets.push(host);
    const roomId = `authority-${Date.now()}`;
    const hostReply = await sendAndReceive(host, { type: 'join', roomId, role: 'host' });
    assert.equal(hostReply.type, 'joined');

    const attacker = await openSocket(url);
    sockets.push(attacker);
    const nullReply = await sendAndReceive(attacker, 'null');
    assert.equal(nullReply.type, 'error', 'non-object JSON should be rejected without crashing');
    const invalidRoleReply = await sendAndReceive(attacker, {
      type: 'join',
      roomId,
      role: 'spectator',
    });
    assert.equal(invalidRoleReply.type, 'error');
    const duplicateHostReply = await sendAndReceive(attacker, {
      type: 'join',
      roomId,
      role: 'host',
    });
    assert.equal(duplicateHostReply.type, 'error', 'duplicate host occupied player-one slot');
  } finally {
    for (const socket of sockets) socket.close();
    server.kill('SIGTERM');
  }
}

async function main(): Promise<void> {
  verifyPlanAuthority();
  await verifyLiveAdmission();
  console.log('Multiplayer authority regression checks passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
