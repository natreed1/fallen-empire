/**
 * Regression checks for authoritative multiplayer room access and move ownership.
 * Run with: npm exec --yes tsx -- scripts/verify-multiplayer-authority.ts
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import WebSocket from 'ws';
import { initMultiplayerGame, stepSimulation, DEFAULT_AI_PARAMS, type SimState } from '../src/core/gameCore';
import { emptyAiActions, type AiActions } from '../src/lib/ai';
import type { Unit } from '../src/types/game';
import { mergeClientPlan } from '../game-server/src/clientPlans';

const P1 = 'player_ai';
const P2 = 'player_ai_2';

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function testUnit(id: string, ownerId: string, q: number, r: number): Unit {
  return {
    id,
    type: 'infantry',
    q,
    r,
    ownerId,
    hp: 10,
    maxHp: 10,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
  };
}

function stateWithUnits(): SimState {
  const state = initMultiplayerGame(424242, { width: 38, height: 38 });
  const p1City = state.cities.find(c => c.ownerId === P1);
  const p2City = state.cities.find(c => c.ownerId === P2);
  assert(p1City && p2City, 'expected both multiplayer capitals');
  return {
    ...state,
    units: [
      testUnit('p1-unit', P1, p1City.q, p1City.r),
      testUnit('p2-unit', P2, p2City.q, p2City.r),
    ],
  };
}

function withMoves(moveTargets: AiActions['moveTargets']): AiActions {
  return { ...emptyAiActions(), moveTargets };
}

function verifyStepSimulationOwnership(): void {
  const state = stateWithUnits();
  const p2City = state.cities.find(c => c.ownerId === P2)!;
  const next = stepSimulation(
    state,
    DEFAULT_AI_PARAMS,
    DEFAULT_AI_PARAMS,
    undefined,
    undefined,
    {
      humanPlansByPlayerId: {
        [P1]: emptyAiActions(),
        [P2]: withMoves([{ unitId: 'p1-unit', toQ: p2City.q, toR: p2City.r }]),
      },
    },
  );
  const p1Unit = next.units.find(u => u.id === 'p1-unit');
  assert(p1Unit?.ownerId === P1, 'expected P1 unit to survive step');
  assert(p1Unit.status === 'idle', 'opponent plan must not move P1 unit');
  assert(p1Unit.targetQ == null && p1Unit.targetR == null, 'opponent plan must not assign P1 target');
}

function verifyClientPlanSanitizer(): void {
  const state = stateWithUnits();
  const p2City = state.cities.find(c => c.ownerId === P2)!;
  const merged = mergeClientPlan(
    emptyAiActions(),
    {
      builds: [{ cityId: state.cities[0].id, type: 'barracks' }],
      moveTargets: [
        { unitId: 'p1-unit', toQ: p2City.q, toR: p2City.r },
        { unitId: 'p2-unit', toQ: Number.NaN, toR: p2City.r },
        { unitId: 'p2-unit', toQ: -1, toR: -1 },
        { unitId: 'p2-unit', toQ: p2City.q, toR: p2City.r },
      ],
    },
    state,
    P2,
  );
  assert(merged.builds.length === 0, 'client plans must not smuggle non-move actions');
  assert(merged.moveTargets.length === 1, 'only one owned valid move target should remain');
  assert(merged.moveTargets[0].unitId === 'p2-unit', 'sanitizer must keep only player-owned moves');
}

function waitForServerReady(proc: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`server did not become ready:\n${output}`)), 10000);
    const onData = (buf: Buffer) => {
      output += buf.toString();
      if (output.includes('Fallen Empire game server listening')) {
        clearTimeout(timeout);
        resolve();
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.once('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`server exited before ready (${code}):\n${output}`));
    });
  });
}

function waitForMessage(
  ws: WebSocket,
  predicate: (msg: any) => boolean,
  label: string,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${label}`));
    }, 5000);
    const onMessage = (raw: WebSocket.RawData) => {
      const msg = JSON.parse(raw.toString());
      if (predicate(msg)) {
        cleanup();
        resolve(msg);
      }
    };
    const onClose = () => {
      cleanup();
      reject(new Error(`socket closed waiting for ${label}`));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      ws.off('message', onMessage);
      ws.off('close', onClose);
    };
    ws.on('message', onMessage);
    ws.once('close', onClose);
  });
}

async function connectAndJoin(port: number, roomId: string, role: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  ws.send(JSON.stringify({ type: 'join', roomId, role }));
  return ws;
}

async function verifyLiveRoomGuards(): Promise<void> {
  const port = 35000 + Math.floor(Math.random() * 1000);
  const proc = spawn('npm', ['run', 'game-server'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), MULTIPLAYER_TICK_MS: '1000000' },
  });
  const sockets: WebSocket[] = [];
  try {
    await waitForServerReady(proc);
    const roomId = `verify-${Date.now()}`;
    const host = await connectAndJoin(port, roomId, 'host');
    sockets.push(host);
    await waitForMessage(host, msg => msg.type === 'joined' && msg.role === 'host', 'host join');

    const duplicateHost = await connectAndJoin(port, roomId, 'host');
    sockets.push(duplicateHost);
    await waitForMessage(
      duplicateHost,
      msg => msg.type === 'error' && String(msg.message).includes('already occupied'),
      'duplicate host rejection',
    );

    const invalidRole = await connectAndJoin(port, roomId, 'spectator');
    sockets.push(invalidRole);
    await waitForMessage(
      invalidRole,
      msg => msg.type === 'error' && String(msg.message).includes('Invalid room role'),
      'invalid role rejection',
    );

    const guest = await connectAndJoin(port, roomId, 'guest');
    sockets.push(guest);
    await waitForMessage(guest, msg => msg.type === 'joined' && msg.role === 'guest', 'guest join');
    guest.send(JSON.stringify({ type: 'plan', plan: { moveTargets: [{ unitId: 'p1-unit', toQ: null, toR: 'bad' }] } }));
    assert(guest.readyState === WebSocket.OPEN, 'malformed plan should not close guest socket');
  } finally {
    for (const ws of sockets) ws.close();
    proc.kill();
  }
}

async function main(): Promise<void> {
  verifyStepSimulationOwnership();
  verifyClientPlanSanitizer();
  await verifyLiveRoomGuards();
  console.log('verify-multiplayer-authority: ok');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
