/**
 * Critical multiplayer authority regression checks.
 *
 * Run with:
 *   npm exec --yes tsx -- scripts/verify-multiplayer-authority.ts
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import {
  DEFAULT_AI_PARAMS,
  initMultiplayerGame,
  stepSimulation,
  type SimState,
} from '../src/core/gameCore';
import { emptyAiActions } from '../src/lib/ai';
import type { SerializedSimState } from '../src/lib/simStateSerialization';

const P1 = 'player_ai';
const P2 = 'player_ai_2';

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function pickTarget(state: SimState, q: number, r: number): { toQ: number; toR: number } {
  return {
    toQ: Math.min(state.config.width - 1, q + 1),
    toR: Math.min(state.config.height - 1, r + 1),
  };
}

function verifyDirectSimulationAuthority(): void {
  const state = initMultiplayerGame(424242);
  const p1Unit = state.units.find(u => u.ownerId === P1 && u.hp > 0);
  const p2Unit = state.units.find(u => u.ownerId === P2 && u.hp > 0);
  assert(p1Unit, 'expected a player 1 unit');
  assert(p2Unit, 'expected a player 2 unit');

  const unauthorizedTarget = pickTarget(state, p2Unit.q, p2Unit.r);
  const authorizedTarget = pickTarget(state, p1Unit.q, p1Unit.r);
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
            { unitId: p2Unit.id, ...unauthorizedTarget },
            { unitId: p1Unit.id, ...authorizedTarget },
          ],
        },
        [P2]: emptyAiActions(),
      },
    },
  );

  const p2After = next.units.find(u => u.id === p2Unit.id);
  const p1After = next.units.find(u => u.id === p1Unit.id);
  assert(p2After, 'expected player 2 unit to survive the authority check tick');
  assert(p1After, 'expected player 1 unit to survive the authority check tick');
  assert(
    p2After.targetQ !== unauthorizedTarget.toQ || p2After.targetR !== unauthorizedTarget.toR,
    'player 1 plan was able to retarget a player 2 unit',
  );
  assert(
    p1After.targetQ === authorizedTarget.toQ && p1After.targetR === authorizedTarget.toR,
    'player 1 plan could not retarget its own unit',
  );
}

type WireMessage = {
  type?: string;
  message?: string;
  payload?: SerializedSimState;
};

function waitForServerReady(server: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      reject(new Error(`game server did not start in time:\n${output}`));
    }, 15000);
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
      reject(new Error(`game server exited before ready (${code}):\n${output}`));
    });
  });
}

function waitForMessage(ws: WebSocket, pred: (msg: WireMessage) => boolean, label: string): Promise<WireMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${label}`));
    }, 10000);
    const onMessage = (ev: MessageEvent) => {
      const raw = typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data as ArrayBuffer).toString();
      const msg = JSON.parse(raw) as WireMessage;
      if (pred(msg)) {
        cleanup();
        resolve(msg);
      }
    };
    const onClose = () => {
      cleanup();
      reject(new Error(`socket closed while waiting for ${label}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      ws.removeEventListener('close', onClose);
    };
    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', onClose);
  });
}

async function joinSocket(url: string, roomId: string, role: 'host' | 'guest'): Promise<WebSocket> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out opening ${role} socket`)), 10000);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error(`failed opening ${role} socket`));
    }, { once: true });
  });
  ws.send(JSON.stringify({ type: 'join', roomId, role }));
  return ws;
}

async function closeSocket(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.CLOSED) return;
  const closed = new Promise<void>(resolve => {
    ws.addEventListener('close', () => resolve(), { once: true });
  });
  ws.close();
  await Promise.race([closed, delay(1000)]);
}

async function verifyLiveServerAuthority(): Promise<void> {
  assert(typeof WebSocket !== 'undefined', 'Node WebSocket global is required for this check');

  const port = 34691;
  const server = spawn(
    'npm',
    ['exec', '--yes', 'tsx', '--', 'game-server/src/index.ts'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        MULTIPLAYER_TICK_MS: '250',
      },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  try {
    await waitForServerReady(server);
    const url = `ws://127.0.0.1:${port}`;
    const roomId = `authority-${Date.now()}`;

    const host = await joinSocket(url, roomId, 'host');
    await waitForMessage(host, msg => msg.type === 'joined', 'host joined');
    const initialState = await waitForMessage(host, msg => msg.type === 'state' && Boolean(msg.payload), 'initial host state');
    assert(initialState.payload, 'expected initial state payload');

    const duplicateHost = await joinSocket(url, roomId, 'host');
    const duplicateHostError = await waitForMessage(duplicateHost, msg => msg.type === 'error', 'duplicate host rejection');
    assert(
      duplicateHostError.message?.toLowerCase().includes('host slot') ?? false,
      `expected duplicate host rejection, got ${duplicateHostError.message}`,
    );
    await closeSocket(duplicateHost);

    const guest = await joinSocket(url, roomId, 'guest');
    await waitForMessage(guest, msg => msg.type === 'joined', 'guest joined');

    const p1Unit = initialState.payload.units.find(u => u.ownerId === P1 && u.hp > 0);
    const p2Unit = initialState.payload.units.find(u => u.ownerId === P2 && u.hp > 0);
    assert(p1Unit, 'expected p1 unit in initial wire state');
    assert(p2Unit, 'expected p2 unit in initial wire state');
    const fakeHostTarget = {
      toQ: Math.max(0, Math.min(initialState.payload.config.width - 1, p1Unit.q + 2)),
      toR: Math.max(0, Math.min(initialState.payload.config.height - 1, p1Unit.r + 2)),
    };
    const guestTarget = {
      toQ: Math.max(0, Math.min(initialState.payload.config.width - 1, p2Unit.q + 1)),
      toR: Math.max(0, Math.min(initialState.payload.config.height - 1, p2Unit.r + 1)),
    };

    guest.send(JSON.stringify({ type: 'plan', plan: { moveTargets: { unitId: p2Unit.id, ...guestTarget } } }));
    guest.send(JSON.stringify({
      type: 'plan',
      plan: {
        moveTargets: [
          { unitId: p1Unit.id, ...fakeHostTarget },
          { unitId: p2Unit.id, ...guestTarget },
          { unitId: p2Unit.id, toQ: Infinity, toR: 0 },
        ],
      },
    }));

    const afterPlan = await waitForMessage(
      host,
      msg => msg.type === 'state' && Boolean(msg.payload) &&
        (msg.payload?.globalMovementTick ?? 0) > initialState.payload!.globalMovementTick,
      'post-plan state',
    );
    assert(afterPlan.payload, 'expected post-plan state payload');
    const p1After = afterPlan.payload.units.find(u => u.id === p1Unit.id);
    const p2After = afterPlan.payload.units.find(u => u.id === p2Unit.id);
    assert(p1After, 'expected p1 unit after live plan');
    assert(p2After, 'expected p2 unit after live plan');
    assert(
      p1After.targetQ !== fakeHostTarget.toQ || p1After.targetR !== fakeHostTarget.toR,
      'guest plan was able to retarget a host unit',
    );
    assert(
      p2After.targetQ === guestTarget.toQ && p2After.targetR === guestTarget.toR,
      'guest plan could not retarget its own unit',
    );

    await closeSocket(guest);
    await closeSocket(host);
  } finally {
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
  await verifyLiveServerAuthority();
  verifyDirectSimulationAuthority();
  console.log('verify-multiplayer-authority: ok');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
