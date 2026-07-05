/**
 * Regression checks for multiplayer authority and WebSocket input hardening.
 *
 * Run with: npm exec -- tsx scripts/verify-multiplayer-authority.ts
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import WebSocket from 'ws';
import { initMultiplayerGame, stepSimulation, DEFAULT_AI_PARAMS } from '../src/core/gameCore';
import { emptyAiActions } from '../src/lib/ai';
import type { City, Unit } from '../src/types/game';

const P1 = 'player_ai';
const P2 = 'player_ai_2';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function testUnit(id: string, ownerId: string, city: City): Unit {
  return {
    id,
    ownerId,
    type: 'infantry',
    q: city.q,
    r: city.r,
    hp: 100,
    maxHp: 100,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
  };
}

function verifyDirectSimulationAuthority(): void {
  const base = initMultiplayerGame(424242);
  const p1City = base.cities.find(c => c.ownerId === P1);
  const p2City = base.cities.find(c => c.ownerId === P2);
  assert(p1City && p2City, 'multiplayer seed should create cities for both players');
  const p1Unit = testUnit('verify-p1-unit', P1, p1City);
  const p2Unit = testUnit('verify-p2-unit', P2, p2City);
  const state = { ...base, units: [p1Unit, p2Unit] };

  const rejected = stepSimulation(
    state,
    DEFAULT_AI_PARAMS,
    DEFAULT_AI_PARAMS,
    undefined,
    undefined,
    {
      humanPlansByPlayerId: {
        [P1]: emptyAiActions(),
        [P2]: {
          ...emptyAiActions(),
          moveTargets: [{ unitId: p1Unit.id, toQ: p2City.q, toR: p2City.r }],
        },
      },
    },
  );
  const rejectedP1Unit = rejected.units.find(u => u.id === p1Unit.id);
  assert(rejectedP1Unit, 'P1 unit should remain in state');
  assert(
    rejectedP1Unit.targetQ !== p2City.q || rejectedP1Unit.targetR !== p2City.r,
    'P2 plan must not retarget a P1 unit',
  );

  const accepted = stepSimulation(
    state,
    DEFAULT_AI_PARAMS,
    DEFAULT_AI_PARAMS,
    undefined,
    undefined,
    {
      humanPlansByPlayerId: {
        [P1]: emptyAiActions(),
        [P2]: {
          ...emptyAiActions(),
          moveTargets: [{ unitId: p2Unit.id, toQ: p1City.q, toR: p1City.r }],
        },
      },
    },
  );
  const acceptedP2Unit = accepted.units.find(u => u.id === p2Unit.id);
  assert(acceptedP2Unit, 'P2 unit should remain in state');
  assert(
    acceptedP2Unit.targetQ === p1City.q && acceptedP2Unit.targetR === p1City.r,
    'P2 should still be able to move its own unit',
  );
}

function waitForServerReady(child: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 10_000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('Fallen Empire game server listening')) {
        clearTimeout(timeout);
        resolve(output);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`server exited before ready (${code ?? signal}):\n${output}`));
    });
  });
}

function openSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('websocket connect timed out'));
    }, 3_000);
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

function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('timed out waiting for websocket message'));
    }, 3_000);
    const cleanup = () => {
      clearTimeout(timeout);
      ws.off('message', onMessage);
      ws.off('error', onError);
      ws.off('close', onClose);
    };
    const onMessage = (data: WebSocket.RawData) => {
      cleanup();
      resolve(JSON.parse(String(data)) as Record<string, unknown>);
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onClose = () => {
      cleanup();
      reject(new Error('websocket closed before message'));
    };
    ws.on('message', onMessage);
    ws.on('error', onError);
    ws.on('close', onClose);
  });
}

async function join(url: string, roomId: string, role: 'host' | 'guest'): Promise<WebSocket> {
  const ws = await openSocket(url);
  ws.send(JSON.stringify({ type: 'join', roomId, role }));
  const msg = await nextMessage(ws);
  assert(msg.type === 'joined', `expected ${role} to join, got ${JSON.stringify(msg)}`);
  return ws;
}

async function verifyLiveServerHardening(): Promise<void> {
  const port = 39241 + Math.floor(Math.random() * 1000);
  const server = spawn('npm', ['run', 'game-server'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), MULTIPLAYER_TICK_MS: '100000' },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const sockets: WebSocket[] = [];
  try {
    await waitForServerReady(server);
    const url = `ws://127.0.0.1:${port}`;
    const roomId = `verify-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const host = await join(url, roomId, 'host');
    sockets.push(host);
    host.send(JSON.stringify({ type: 'plan', plan: { moveTargets: 123, builds: null, recruits: null } }));
    await delay(250);
    assert(server.exitCode === null, 'malformed plan payload must not crash the server process');

    const guest = await join(url, roomId, 'guest');
    sockets.push(guest);

    const duplicateHost = await openSocket(url);
    sockets.push(duplicateHost);
    duplicateHost.send(JSON.stringify({ type: 'join', roomId, role: 'host' }));
    const duplicateHostMsg = await nextMessage(duplicateHost);
    assert(duplicateHostMsg.type === 'error', `duplicate host should be rejected, got ${JSON.stringify(duplicateHostMsg)}`);
  } finally {
    for (const ws of sockets) ws.close();
    if (server.pid) {
      try {
        process.kill(-server.pid, 'SIGTERM');
      } catch {
        server.kill('SIGTERM');
      }
    }
  }
}

async function main(): Promise<void> {
  verifyDirectSimulationAuthority();
  await verifyLiveServerHardening();
  console.log('verify-multiplayer-authority: ok');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
