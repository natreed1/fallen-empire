import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import WebSocket from 'ws';
import { initMultiplayerGame, stepSimulation, DEFAULT_AI_PARAMS, type SimState } from '../src/core/gameCore';
import { emptyAiActions, type AiActions } from '../src/lib/ai';
import type { Unit } from '../src/types/game';
import { sanitizeClientPlan } from '../game-server/src/clientPlans';

const P1 = 'player_ai';
const P2 = 'player_ai_2';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function makeUnit(id: string, ownerId: string, q: number, r: number): Unit {
  return {
    id,
    ownerId,
    type: 'infantry',
    q,
    r,
    hp: 20,
    maxHp: 20,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
  };
}

function testStateWithUnits(): SimState {
  const state = initMultiplayerGame(12345);
  const p1City = state.cities.find(city => city.ownerId === P1);
  const p2City = state.cities.find(city => city.ownerId === P2);
  assert(Boolean(p1City && p2City), 'expected both multiplayer capitals');

  return {
    ...state,
    units: [
      makeUnit('p1-unit', P1, p1City!.q, p1City!.r),
      makeUnit('p2-unit', P2, p2City!.q, p2City!.r),
    ],
  };
}

function testClientPlanSanitizer(): void {
  const state = testStateWithUnits();
  const p1Unit = state.units.find(unit => unit.ownerId === P1)!;
  const p2Unit = state.units.find(unit => unit.ownerId === P2)!;

  const sanitized = sanitizeClientPlan(
    {
      moveTargets: [
        { unitId: p2Unit.id, toQ: p1Unit.q, toR: p1Unit.r },
        { unitId: p1Unit.id, toQ: 9999, toR: 9999 },
        { unitId: p1Unit.id, toQ: p1Unit.q + 0.5, toR: p1Unit.r },
        { unitId: p1Unit.id, toQ: p1Unit.q + 1, toR: p1Unit.r },
      ],
      builds: [{ cityId: state.cities[0].id, type: 'barracks', q: p1Unit.q, r: p1Unit.r }],
    },
    state,
    P1,
  );

  assert(sanitized.moveTargets?.length === 1, 'sanitizer should keep only one legal owned move');
  assert(sanitized.moveTargets[0].unitId === p1Unit.id, 'sanitizer should drop opponent unit moves');
  assert(!('builds' in sanitized), 'sanitizer should drop non-move AI actions from clients');
}

function testStepSimulationOwnershipGuard(): void {
  const state = testStateWithUnits();
  const p1Unit = state.units.find(unit => unit.ownerId === P1)!;
  const p2Unit = state.units.find(unit => unit.ownerId === P2)!;

  const p1Plan: AiActions = {
    ...emptyAiActions(),
    moveTargets: [
      { unitId: p2Unit.id, toQ: p1Unit.q, toR: p1Unit.r },
      { unitId: p1Unit.id, toQ: p1Unit.q + 1, toR: p1Unit.r },
    ],
  };

  const next = stepSimulation(
    state,
    DEFAULT_AI_PARAMS,
    DEFAULT_AI_PARAMS,
    undefined,
    undefined,
    { humanPlansByPlayerId: { [P1]: p1Plan, [P2]: emptyAiActions() } },
  );
  const movedP1 = next.units.find(unit => unit.id === p1Unit.id)!;
  const protectedP2 = next.units.find(unit => unit.id === p2Unit.id)!;

  assert(movedP1.targetQ === p1Unit.q + 1 && movedP1.targetR === p1Unit.r, 'owned move should still apply');
  assert(protectedP2.targetQ == null && protectedP2.targetR == null, 'cross-owner move should be ignored');
  assert(protectedP2.status === 'idle', 'cross-owner move should not change unit status');
}

function waitForServerReady(proc: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      reject(new Error(`server did not become ready; output:\n${output}`));
    }, 10_000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('Fallen Empire game server listening')) {
        clearTimeout(timer);
        proc.stdout.off('data', onData);
        proc.stderr.off('data', onData);
        resolve();
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`server exited before ready with code ${code}; output:\n${output}`));
    });
  });
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function waitForMessage(ws: WebSocket, predicate: (msg: any) => boolean): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error('timed out waiting for WebSocket message'));
    }, 5_000);
    const onMessage = (raw: WebSocket.RawData) => {
      const msg = JSON.parse(raw.toString());
      if (!predicate(msg)) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(msg);
    };
    ws.on('message', onMessage);
  });
}

async function join(url: string, roomId: string, role: 'host' | 'guest'): Promise<{ ws: WebSocket; msg: any }> {
  const ws = await connect(url);
  const next = waitForMessage(ws, msg => msg.type === 'joined' || msg.type === 'error');
  ws.send(JSON.stringify({ type: 'join', roomId, role }));
  return { ws, msg: await next };
}

async function testDuplicateRoleRejection(): Promise<void> {
  const port = 35_111;
  const proc = spawn('./node_modules/.bin/tsx', ['game-server/src/index.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), MULTIPLAYER_TICK_MS: '100000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const sockets: WebSocket[] = [];
  try {
    await waitForServerReady(proc);
    const url = `ws://127.0.0.1:${port}`;
    const roomId = `authority-${Date.now()}`;

    const host = await join(url, roomId, 'host');
    sockets.push(host.ws);
    assert(host.msg.type === 'joined', 'first host should join');

    const duplicateHost = await join(url, roomId, 'host');
    sockets.push(duplicateHost.ws);
    assert(duplicateHost.msg.type === 'error', 'duplicate host should be rejected');

    const guest = await join(url, roomId, 'guest');
    sockets.push(guest.ws);
    assert(guest.msg.type === 'joined', 'first guest should join');

    const duplicateGuest = await join(url, roomId, 'guest');
    sockets.push(duplicateGuest.ws);
    assert(duplicateGuest.msg.type === 'error', 'duplicate guest should be rejected');
  } finally {
    for (const ws of sockets) ws.close();
    proc.kill('SIGTERM');
    await new Promise<void>(resolve => {
      if (proc.exitCode != null) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        resolve();
      }, 1_000);
      proc.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

async function main(): Promise<void> {
  testClientPlanSanitizer();
  testStepSimulationOwnershipGuard();
  await testDuplicateRoleRejection();
  console.log('verify-multiplayer-authority: ok');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
