/**
 * Regression checks for multiplayer authority boundaries.
 *
 * Run with: npm exec -- tsx scripts/verify-multiplayer-authority.ts
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import WebSocket from 'ws';
import { DEFAULT_AI_PARAMS, initMultiplayerGame, stepSimulation, type SimState } from '../src/core/gameCore.ts';
import { emptyAiActions } from '../src/lib/ai.ts';
import { sanitizeClientPlanPatch } from '../game-server/src/clientPlans.ts';

const P1 = 'player_ai';
const P2 = 'player_ai_2';

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function firstUnit(state: SimState, ownerId: string) {
  const unit = state.units.find(u => u.ownerId === ownerId && u.hp > 0);
  assert(unit, `missing live unit for ${ownerId}`);
  return unit;
}

function targetAwayFrom(state: SimState, q: number, r: number) {
  const tile = Array.from(state.tiles.values()).find(t => t.q !== q || t.r !== r);
  assert(tile, 'missing alternate target tile');
  return tile;
}

function verifyDirectStepSimulationAuthority(): void {
  const state = initMultiplayerGame(24681357);
  const victim = firstUnit(state, P2);
  const target = targetAwayFrom(state, victim.q, victim.r);

  const attackerPlan = emptyAiActions();
  attackerPlan.moveTargets = [{ unitId: victim.id, toQ: target.q, toR: target.r }];

  const next = stepSimulation(
    state,
    DEFAULT_AI_PARAMS,
    DEFAULT_AI_PARAMS,
    undefined,
    undefined,
    { humanPlansByPlayerId: { [P1]: attackerPlan, [P2]: emptyAiActions() } },
  );
  const movedVictim = next.units.find(u => u.id === victim.id);
  assert(movedVictim, 'victim unit disappeared during authority regression');
  assert(
    movedVictim.targetQ !== target.q || movedVictim.targetR !== target.r,
    'P1 plan was able to retarget a P2 unit',
  );
}

function verifyClientPlanSanitizer(): void {
  const state = initMultiplayerGame(97531);
  const own = firstUnit(state, P1);
  const enemy = firstUnit(state, P2);
  const validTarget = targetAwayFrom(state, own.q, own.r);

  const sanitized = sanitizeClientPlanPatch(state, P1, {
    builds: [{ cityId: 'enemy-city', type: 'barracks', q: 0, r: 0 }],
    recruits: null,
    moveTargets: [
      { unitId: own.id, toQ: validTarget.q, toR: validTarget.r },
      { unitId: enemy.id, toQ: validTarget.q, toR: validTarget.r },
      { unitId: own.id, toQ: Number.POSITIVE_INFINITY, toR: validTarget.r },
      { unitId: own.id, toQ: validTarget.q + 0.5, toR: validTarget.r },
      { unitId: own.id, toQ: 999999, toR: 999999 },
      null,
    ],
  });

  assert(sanitized.moveTargets.length === 1, 'sanitizer should keep only one owned finite in-map move');
  assert(sanitized.moveTargets[0].unitId === own.id, 'sanitizer kept a move for the wrong unit');
  assert(sanitized.builds.length === 0, 'sanitizer allowed client build actions');
  assert(sanitized.recruits.length === 0, 'sanitizer allowed client recruit actions');
}

function onceOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WebSocket open timeout')), 3000);
    ws.once('open', () => {
      clearTimeout(timeout);
      resolve();
    });
    ws.once('error', err => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function waitForMessage(
  ws: WebSocket,
  predicate: (msg: Record<string, unknown>) => boolean,
  label: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${label}`));
    }, 3000);

    const onMessage = (raw: WebSocket.RawData) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (predicate(msg)) {
        cleanup();
        resolve(msg);
      }
    };

    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    function cleanup() {
      clearTimeout(timeout);
      ws.off('message', onMessage);
      ws.off('error', onError);
    }

    ws.on('message', onMessage);
    ws.on('error', onError);
  });
}

async function joinRoom(port: number, roomId: string, role: 'host' | 'guest') {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await onceOpen(ws);
  ws.send(JSON.stringify({ type: 'join', roomId, role }));
  const reply = await waitForMessage(
    ws,
    msg => msg.type === 'joined' || msg.type === 'error',
    `${role} join response`,
  );
  return { ws, reply };
}

function waitForServerReady(server: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`server did not start:\n${output}`));
    }, 8000);

    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('Fallen Empire game server listening')) {
        cleanup();
        resolve();
      }
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(new Error(`server exited before ready (${code ?? signal}):\n${output}`));
    };

    function cleanup() {
      clearTimeout(timeout);
      server.stdout.off('data', onData);
      server.stderr.off('data', onData);
      server.off('exit', onExit);
    }

    server.stdout.on('data', onData);
    server.stderr.on('data', onData);
    server.once('exit', onExit);
  });
}

async function verifyLiveServerJoinAndPlanSafety(): Promise<void> {
  const port = 39500 + Math.floor(Math.random() * 1000);
  const tsxBin = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
  const server = spawn(
    tsxBin,
    ['--tsconfig', 'game-server/tsconfig.json', 'game-server/src/index.ts'],
    {
      cwd: process.cwd(),
      detached: process.platform !== 'win32',
      env: { ...process.env, PORT: String(port), MULTIPLAYER_TICK_MS: '10000' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const sockets: WebSocket[] = [];
  try {
    await waitForServerReady(server);
    const roomId = `authority-${Date.now()}`;

    const host = await joinRoom(port, roomId, 'host');
    sockets.push(host.ws);
    assert(host.reply.type === 'joined', 'first host should join');

    const duplicateHost = await joinRoom(port, roomId, 'host');
    sockets.push(duplicateHost.ws);
    assert(duplicateHost.reply.type === 'error', 'duplicate host should be rejected');

    const guest = await joinRoom(port, roomId, 'guest');
    sockets.push(guest.ws);
    assert(guest.reply.type === 'joined', 'guest should join after host');

    host.ws.send(JSON.stringify({ type: 'plan', plan: { moveTargets: 123, builds: null } }));
    await new Promise(resolve => setTimeout(resolve, 250));
    assert(server.exitCode === null, 'server crashed after malformed client plan');
  } finally {
    for (const ws of sockets) ws.close();
    if (server.pid && server.exitCode === null) {
      if (process.platform === 'win32') server.kill('SIGTERM');
      else process.kill(-server.pid, 'SIGTERM');
    }
  }
}

async function main(): Promise<void> {
  verifyDirectStepSimulationAuthority();
  verifyClientPlanSanitizer();
  await verifyLiveServerJoinAndPlanSafety();
  console.log('verify-multiplayer-authority: ok');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
