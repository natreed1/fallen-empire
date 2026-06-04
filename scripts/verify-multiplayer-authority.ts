/**
 * Regression checks for multiplayer authority boundaries.
 *
 * Run with: `npm exec --yes tsx -- scripts/verify-multiplayer-authority.ts`
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { initMultiplayerGame, stepSimulation, DEFAULT_AI_PARAMS } from '../src/core/gameCore';
import { emptyAiActions } from '../src/lib/ai';
import type { Unit } from '../src/types/game';

const P1 = 'player_ai';
const P2 = 'player_ai_2';

function makeUnit(id: string, ownerId: string, q: number, r: number): Unit {
  return {
    id,
    ownerId,
    type: 'infantry',
    q,
    r,
    hp: 100,
    maxHp: 100,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
  };
}

function verifySharedSimulationMoveOwnership(): void {
  const state = initMultiplayerGame(12345, { width: 38, height: 38, mapTerrain: 'no_water' });
  const p1City = state.cities.find(city => city.ownerId === P1);
  const p2City = state.cities.find(city => city.ownerId === P2);
  assert(p1City, 'expected player 1 city');
  assert(p2City, 'expected player 2 city');

  const p1Unit = makeUnit('p1-unit', P1, p1City.q, p1City.r);
  const p2Unit = makeUnit('p2-unit', P2, p2City.q, p2City.r);
  const p1Target = { toQ: p2City.q, toR: p2City.r };
  const stolenTarget = { toQ: p1City.q, toR: p1City.r };

  const next = stepSimulation(
    { ...state, units: [p1Unit, p2Unit] },
    DEFAULT_AI_PARAMS,
    DEFAULT_AI_PARAMS,
    undefined,
    undefined,
    {
      humanPlansByPlayerId: {
        [P1]: {
          ...emptyAiActions(),
          moveTargets: [
            { unitId: p2Unit.id, ...stolenTarget },
            { unitId: p1Unit.id, ...p1Target },
          ],
        },
        [P2]: emptyAiActions(),
      },
    },
  );

  const movedOwnUnit = next.units.find(unit => unit.id === p1Unit.id);
  const untouchedEnemyUnit = next.units.find(unit => unit.id === p2Unit.id);
  assert(movedOwnUnit, 'expected player 1 unit after step');
  assert(untouchedEnemyUnit, 'expected player 2 unit after step');
  assert.equal(movedOwnUnit.targetQ, p1Target.toQ, 'owned unit should accept player 1 move target');
  assert.equal(movedOwnUnit.targetR, p1Target.toR, 'owned unit should accept player 1 move target');
  assert.equal(movedOwnUnit.status, 'moving', 'owned unit should begin moving');
  assert.equal(untouchedEnemyUnit.targetQ, undefined, 'player 1 must not retarget player 2 unit');
  assert.equal(untouchedEnemyUnit.targetR, undefined, 'player 1 must not retarget player 2 unit');
  assert.equal(untouchedEnemyUnit.status, 'idle', 'player 2 unit should remain idle');
}

type WsMessage = {
  type?: string;
  message?: string;
  [key: string]: unknown;
};

async function waitForSocketMessage(
  socket: WebSocket,
  predicate: (msg: WsMessage) => boolean,
  timeoutMs = 5000,
): Promise<WsMessage> {
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for WebSocket message'));
    }, timeoutMs);

    const onMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(String(event.data)) as WsMessage;
        if (predicate(msg)) {
          cleanup();
          resolve(msg);
        }
      } catch {
        // Ignore non-JSON messages.
      }
    };
    const onError = () => {
      cleanup();
      reject(new Error('WebSocket error'));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('error', onError);
    };

    socket.addEventListener('message', onMessage);
    socket.addEventListener('error', onError);
  });
}

async function joinRoom(port: number, roomId: string, role: 'host' | 'guest'): Promise<{ socket: WebSocket; first: WsMessage }> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  await once(socket, 'open');
  socket.send(JSON.stringify({ type: 'join', roomId, role }));
  const first = await waitForSocketMessage(socket, msg => msg.type === 'joined' || msg.type === 'error');
  return { socket, first };
}

async function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return;
  await new Promise<void>(resolve => {
    const timeout = setTimeout(resolve, 500);
    const onClose = () => {
      clearTimeout(timeout);
      resolve();
    };
    socket.addEventListener('close', onClose, { once: true });
    socket.close();
  });
}

async function waitForServerReady(child: ChildProcessWithoutNullStreams, port: number): Promise<void> {
  let output = '';
  child.stdout.on('data', chunk => {
    output += String(chunk);
  });
  child.stderr.on('data', chunk => {
    output += String(chunk);
  });

  for (let attempt = 0; attempt < 40; attempt++) {
    if (child.exitCode != null) {
      throw new Error(`game server exited early with ${child.exitCode}: ${output}`);
    }
    if (output.includes(`ws://localhost:${port}`)) return;
    await delay(250);
  }
  throw new Error(`game server did not become ready: ${output}`);
}

async function verifyLiveServerRoomAuthority(): Promise<void> {
  const port = 38000 + Math.floor(Math.random() * 1000);
  const roomId = `authority-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const serverDir = join(process.cwd(), 'game-server');
  const tsxBin = join(serverDir, 'node_modules', '.bin', 'tsx');
  const child = spawn(tsxBin, ['--tsconfig', 'tsconfig.json', 'src/index.ts'], {
    cwd: serverDir,
    env: { ...process.env, PORT: String(port), MULTIPLAYER_TICK_MS: '1000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const sockets: WebSocket[] = [];

  try {
    await waitForServerReady(child, port);

    const host = await joinRoom(port, roomId, 'host');
    sockets.push(host.socket);
    assert.equal(host.first.type, 'joined', 'first host should join');

    const duplicateHost = await joinRoom(port, roomId, 'host');
    sockets.push(duplicateHost.socket);
    assert.equal(duplicateHost.first.type, 'error', 'duplicate host should be rejected');
    assert.match(String(duplicateHost.first.message), /host slot/i);

    const guest = await joinRoom(port, roomId, 'guest');
    sockets.push(guest.socket);
    assert.equal(guest.first.type, 'joined', 'first guest should join');

    const duplicateGuest = await joinRoom(port, roomId, 'guest');
    sockets.push(duplicateGuest.socket);
    assert.equal(duplicateGuest.first.type, 'error', 'duplicate guest should be rejected');
    assert.match(String(duplicateGuest.first.message), /guest slot/i);

    guest.socket.send(JSON.stringify({ type: 'plan', plan: { moveTargets: {} } }));
    await delay(500);
    assert.equal(child.exitCode, null, 'malformed plan payload must not crash the server');
  } finally {
    await Promise.all(sockets.map(socket => closeSocket(socket).catch(() => undefined)));
    if (child.pid && child.exitCode == null) {
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit'), delay(2000)]);
      if (child.exitCode == null) child.kill('SIGKILL');
    }
  }
}

async function main(): Promise<void> {
  verifySharedSimulationMoveOwnership();
  await verifyLiveServerRoomAuthority();
  console.log('verify-multiplayer-authority: ok');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
