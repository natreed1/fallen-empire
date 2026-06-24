import assert from 'assert/strict';
import { spawn, type ChildProcess } from 'child_process';
import WebSocket from 'ws';

import {
  DEFAULT_AI_PARAMS,
  initMultiplayerGame,
  stepSimulation,
  type SimState,
} from '../src/core/gameCore';
import { emptyAiActions } from '../src/lib/ai';
import { remapSimStateForClient } from '../src/lib/multiplayerRemap';
import { mergeClientPlan, sanitizeClientPlanPatch } from '../game-server/src/clientPlans';
import type { Unit } from '../src/types/game';

const P1 = 'player_ai';
const P2 = 'player_ai_2';
const LOCAL = 'player_human';

function makeUnit(id: string, ownerId: string, q: number, r: number): Unit {
  return {
    id,
    type: 'infantry',
    q,
    r,
    ownerId,
    hp: 10,
    maxHp: 10,
    xp: 0,
    level: 1,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
  };
}

function seededStateWithUnits(): SimState {
  const state = initMultiplayerGame(12345, { width: 38, height: 38, ensureCornerLand: true });
  const p1City = state.cities.find(c => c.ownerId === P1);
  const p2City = state.cities.find(c => c.ownerId === P2);
  assert.ok(p1City, 'expected P1 city');
  assert.ok(p2City, 'expected P2 city');
  return {
    ...state,
    units: [
      makeUnit('p1-unit', P1, p1City.q, p1City.r),
      makeUnit('p2-unit', P2, p2City.q, p2City.r),
    ],
  };
}

function testCoreMoveAuthority(): void {
  const state = seededStateWithUnits();
  const p1City = state.cities.find(c => c.ownerId === P1)!;
  const plans = {
    [P1]: {
      ...emptyAiActions(),
      moveTargets: [{ unitId: 'p2-unit', toQ: p1City.q, toR: p1City.r }],
    },
    [P2]: emptyAiActions(),
  };

  const next = stepSimulation(state, DEFAULT_AI_PARAMS, DEFAULT_AI_PARAMS, undefined, undefined, {
    humanPlansByPlayerId: plans,
  });
  const p2Unit = next.units.find(u => u.id === 'p2-unit');
  assert.ok(p2Unit, 'expected P2 unit after simulation step');
  assert.equal(p2Unit.ownerId, P2);
  assert.notEqual(p2Unit.targetQ, p1City.q, 'P1 plan must not retarget a P2 unit');
  assert.notEqual(p2Unit.targetR, p1City.r, 'P1 plan must not retarget a P2 unit');
}

function testClientPlanSanitizer(): void {
  const state = seededStateWithUnits();
  const p1City = state.cities.find(c => c.ownerId === P1)!;
  const p2City = state.cities.find(c => c.ownerId === P2)!;
  const patch = sanitizeClientPlanPatch(
    {
      moveTargets: [
        { unitId: 'p2-unit', toQ: p1City.q, toR: p1City.r },
        { unitId: 'p1-unit', toQ: 9999, toR: 9999 },
        { unitId: 'p1-unit', toQ: p2City.q, toR: p2City.r },
        { unitId: 'p1-unit', toQ: 1.25, toR: p2City.r },
      ],
      recruits: [{ cityId: state.cities[0].id, type: 'defender' }],
    },
    state,
    P1,
  );

  assert.deepEqual(patch.moveTargets, [{ unitId: 'p1-unit', toQ: p2City.q, toR: p2City.r }]);
  assert.deepEqual(patch.recruits, [], 'client patches must not smuggle recruit actions');

  const merged = mergeClientPlan(
    { ...emptyAiActions(), moveTargets: [{ unitId: 'p1-unit', toQ: p1City.q, toR: p1City.r }] },
    patch,
  );
  assert.deepEqual(merged.moveTargets, [{ unitId: 'p1-unit', toQ: p2City.q, toR: p2City.r }]);
  assert.deepEqual(merged.builds, []);
  assert.deepEqual(merged.recruits, []);
}

function testGuestRemap(): void {
  const state = {
    ...seededStateWithUnits(),
    scoutTowers: [{ id: 'tower-p2', ownerId: P2, q: 10, r: 10 }],
    combatMoraleState: new Map([['stack-p2', { ownerId: P2, morale: 0.75 }]]),
  };

  const guestView = remapSimStateForClient(state, 'guest');
  assert.equal(guestView.scoutTowers[0].ownerId, LOCAL, 'guest scout tower vision must remap to local player');
  assert.equal(guestView.combatMoraleState.get('stack-p2')?.ownerId, LOCAL, 'guest morale owner must remap to local player');
}

function waitForServer(proc: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!proc.stdout || !proc.stderr) {
      reject(new Error('game server stdio was not captured'));
      return;
    }
    const timeout = setTimeout(() => reject(new Error('game server did not start')), 15_000);
    const onData = (data: Buffer) => {
      const text = data.toString();
      if (text.includes('Fallen Empire game server listening')) {
        clearTimeout(timeout);
        resolve();
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.once('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`game server exited before startup with code ${code}`));
    });
  });
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('websocket connection timed out'));
    }, 5_000);
    ws.once('open', () => {
      clearTimeout(timeout);
      resolve(ws);
    });
    ws.once('error', err => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function nextMessage(ws: WebSocket, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), 5_000);
    const onMessage = (data: WebSocket.RawData) => {
      const msg = JSON.parse(String(data)) as Record<string, unknown>;
      if (msg.type === type) {
        clearTimeout(timeout);
        ws.off('message', onMessage);
        resolve(msg);
      }
    };
    ws.on('message', onMessage);
  });
}

async function testLiveServerRoleGuards(): Promise<void> {
  const port = 34861 + Math.floor(Math.random() * 1000);
  const proc = spawn('./node_modules/.bin/tsx', ['game-server/src/index.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), MULTIPLAYER_TICK_MS: '60000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const sockets: WebSocket[] = [];
  try {
    await waitForServer(proc);
    const url = `ws://127.0.0.1:${port}`;
    const roomId = `authority-${Date.now()}`;

    const host = await connect(url);
    sockets.push(host);
    host.send(JSON.stringify({ type: 'join', roomId, role: 'host' }));
    assert.equal((await nextMessage(host, 'joined')).playerSlot, P1);

    const duplicateHost = await connect(url);
    sockets.push(duplicateHost);
    duplicateHost.send(JSON.stringify({ type: 'join', roomId, role: 'host' }));
    const duplicateError = await nextMessage(duplicateHost, 'error');
    assert.match(String(duplicateError.message), /Host slot is already occupied/);

    const invalidRole = await connect(url);
    sockets.push(invalidRole);
    invalidRole.send(JSON.stringify({ type: 'join', roomId: `${roomId}-invalid`, role: 'spectator' }));
    const invalidError = await nextMessage(invalidRole, 'error');
    assert.match(String(invalidError.message), /Invalid multiplayer role/);

    const guest = await connect(url);
    sockets.push(guest);
    guest.send(JSON.stringify({ type: 'join', roomId, role: 'guest' }));
    assert.equal((await nextMessage(guest, 'joined')).playerSlot, P2);
  } finally {
    for (const ws of sockets) ws.terminate();
    await stopProcess(proc);
  }
}

function stopProcess(proc: ChildProcess): Promise<void> {
  return new Promise(resolve => {
    if (proc.exitCode !== null || proc.killed) {
      resolve();
      return;
    }
    const killTimer = setTimeout(() => {
      if (proc.exitCode === null) proc.kill('SIGKILL');
    }, 2_000);
    proc.once('close', () => {
      clearTimeout(killTimer);
      resolve();
    });
    proc.kill('SIGTERM');
  });
}

async function main(): Promise<void> {
  testCoreMoveAuthority();
  testClientPlanSanitizer();
  testGuestRemap();
  await testLiveServerRoleGuards();
  console.log('multiplayer authority regression checks passed');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
