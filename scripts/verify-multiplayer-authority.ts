/**
 * Regression checks for multiplayer room access and cross-player order authority.
 * Run with: npm exec --yes tsx -- scripts/verify-multiplayer-authority.ts
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

import { DEFAULT_AI_PARAMS, initMultiplayerGame, stepSimulation } from '../src/core/gameCore';
import { emptyAiActions } from '../src/lib/ai';
import type { Unit } from '../src/types/game';

const P1 = 'player_ai';
const P2 = 'player_ai_2';

type ServerMessage = {
  type?: string;
  message?: string;
  [key: string]: unknown;
};

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function messageDataToString(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  return String(data);
}

async function waitForServerReady(server: ChildProcessWithoutNullStreams): Promise<void> {
  let output = '';
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`game-server did not start in time. Output:\n${output}`));
    }, 15000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.includes('Fallen Empire game server listening')) {
        cleanup();
        resolve();
      }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(new Error(`game-server exited before ready (${code ?? signal}). Output:\n${output}`));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      server.stdout.off('data', onData);
      server.stderr.off('data', onData);
      server.off('exit', onExit);
    };
    server.stdout.on('data', onData);
    server.stderr.on('data', onData);
    server.once('exit', onExit);
  });
}

async function openSocket(url: string): Promise<WebSocket> {
  assert(typeof WebSocket !== 'undefined', 'global WebSocket is not available in this Node runtime');
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      try {
        socket.close();
      } catch {
        // ignore cleanup failures
      }
      reject(new Error(`Timed out connecting to ${url}`));
    }, 5000);
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Failed to connect to ${url}`));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener('open', onOpen);
      socket.removeEventListener('error', onError);
    };
    socket.addEventListener('open', onOpen);
    socket.addEventListener('error', onError);
  });
  return socket;
}

async function waitForMessage(
  socket: WebSocket,
  predicate: (msg: ServerMessage) => boolean,
  label: string,
): Promise<ServerMessage> {
  return await new Promise<ServerMessage>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${label}`));
    }, 5000);
    const onMessage = (event: MessageEvent) => {
      let parsed: ServerMessage;
      try {
        parsed = JSON.parse(messageDataToString(event.data));
      } catch {
        return;
      }
      if (!predicate(parsed)) return;
      cleanup();
      resolve(parsed);
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Socket error while waiting for ${label}`));
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

async function closeServer(server: ChildProcessWithoutNullStreams): Promise<void> {
  if (server.exitCode != null) return;
  server.kill('SIGTERM');
  const exited = await Promise.race([
    once(server, 'exit').then(() => true),
    delay(1500).then(() => false),
  ]);
  if (!exited && server.exitCode == null) {
    server.kill('SIGKILL');
    await Promise.race([once(server, 'exit'), delay(1500)]);
  }
}

async function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return;
  await new Promise<void>(resolve => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, 1000);
    const onClose = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener('close', onClose);
    };
    socket.addEventListener('close', onClose);
    try {
      socket.close();
    } catch {
      cleanup();
      resolve();
    }
  });
}

function verifyCrossPlayerMoveTargetsAreIgnored(): void {
  const state = initMultiplayerGame(424242);
  const p2City = state.cities.find(c => c.ownerId === P2);
  assert(p2City, 'expected player 2 to start with a city');

  const targetUnit: Unit = {
    id: 'authority-p2-unit',
    type: 'infantry',
    q: p2City.q,
    r: p2City.r,
    ownerId: P2,
    hp: 10,
    maxHp: 10,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
  };
  const controlledState = {
    ...state,
    units: [...state.units, targetUnit],
  };

  const maliciousTarget = { toQ: targetUnit.q + 7, toR: targetUnit.r - 5 };
  const next = stepSimulation(
    controlledState,
    DEFAULT_AI_PARAMS,
    DEFAULT_AI_PARAMS,
    undefined,
    undefined,
    {
      humanPlansByPlayerId: {
        [P1]: {
          ...emptyAiActions(),
          moveTargets: [{ unitId: targetUnit.id, ...maliciousTarget }],
        },
        [P2]: emptyAiActions(),
      },
    },
  );

  const after = next.units.find(u => u.id === targetUnit.id);
  assert(after, 'target unit should still exist after one simulation step');
  assert(
    after.targetQ !== maliciousTarget.toQ || after.targetR !== maliciousTarget.toR,
    'player 1 plan was able to assign a move target to a player 2 unit',
  );
}

async function verifyDuplicateHostIsRejected(): Promise<void> {
  const port = 42000 + Math.floor(Math.random() * 10000);
  const tsxBin = process.platform === 'win32' ? 'node_modules\\.bin\\tsx.cmd' : './node_modules/.bin/tsx';
  const server = spawn(tsxBin, ['--tsconfig', 'tsconfig.json', 'src/index.ts'], {
    cwd: `${process.cwd()}/game-server`,
    env: {
      ...process.env,
      PORT: String(port),
      MULTIPLAYER_TICK_MS: '60000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const sockets: WebSocket[] = [];
  try {
    await waitForServerReady(server);
    const url = `ws://127.0.0.1:${port}`;
    const roomId = randomUUID();

    const host1 = await openSocket(url);
    sockets.push(host1);
    host1.send(JSON.stringify({ type: 'join', roomId, role: 'host' }));
    const hostJoin = await waitForMessage(host1, msg => msg.type === 'joined' || msg.type === 'error', 'initial host join');
    assert(hostJoin.type === 'joined', `initial host should join, got ${JSON.stringify(hostJoin)}`);

    const host2 = await openSocket(url);
    sockets.push(host2);
    host2.send(JSON.stringify({ type: 'join', roomId, role: 'host' }));
    const duplicateHost = await waitForMessage(host2, msg => msg.type === 'joined' || msg.type === 'error', 'duplicate host join');
    assert(duplicateHost.type === 'error', 'duplicate host was allowed to join the same room');
  } finally {
    await Promise.all(sockets.map(closeSocket));
    await closeServer(server);
  }
}

async function main(): Promise<void> {
  verifyCrossPlayerMoveTargetsAreIgnored();
  await verifyDuplicateHostIsRejected();
  console.log('verify-multiplayer-authority: ok');
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
