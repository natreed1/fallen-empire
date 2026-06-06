/**
 * Regression checks for multiplayer authority invariants (run with `npx tsx`).
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { once } from 'events';
import { initMultiplayerGame, stepSimulation, DEFAULT_AI_PARAMS, type SimState } from '../src/core/gameCore';
import { emptyAiActions, type AiActions } from '../src/lib/ai';
import type { Unit } from '../src/types/game';

const P1 = 'player_ai';
const P2 = 'player_ai_2';

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function testStepSimulationMoveOwnership(): void {
  const base = initMultiplayerGame(12345, { width: 24, height: 24 });
  const p1City = base.cities.find(c => c.ownerId === P1);
  const p2City = base.cities.find(c => c.ownerId === P2);
  assert(p1City !== undefined, 'expected player 1 multiplayer capital');
  assert(p2City !== undefined, 'expected player 2 multiplayer capital');

  const p1Unit: Unit = {
    id: 'p1-unit',
    type: 'infantry',
    q: p1City.q,
    r: p1City.r,
    ownerId: P1,
    hp: 30,
    maxHp: 30,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
  };
  const p2Unit: Unit = {
    id: 'p2-unit',
    type: 'infantry',
    q: p2City.q,
    r: p2City.r,
    ownerId: P2,
    hp: 30,
    maxHp: 30,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
  };
  const state: SimState = { ...base, units: [p1Unit, p2Unit] };
  const p1Plan: AiActions = {
    ...emptyAiActions(),
    moveTargets: [
      { unitId: p2Unit.id, toQ: p1City.q, toR: p1City.r },
      { unitId: p1Unit.id, toQ: p2City.q, toR: p2City.r },
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

  const p1After = next.units.find(u => u.id === p1Unit.id);
  const p2After = next.units.find(u => u.id === p2Unit.id);
  assert(p1After?.targetQ === p2City.q && p1After?.targetR === p2City.r, 'owned move target should apply');
  assert(
    p2After?.targetQ !== p1City.q || p2After?.targetR !== p1City.r,
    'cross-owner move target must not apply',
  );
}

function waitForServerReady(proc: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`game server did not start. Output:\n${output}`)), 15000);
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
      reject(new Error(`game server exited early with ${code}. Output:\n${output}`));
    });
  });
}

async function openSocket(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', () => reject(new Error('websocket failed to open')), { once: true });
  });
  return ws;
}

function waitForMessage(ws: WebSocket, type: string): Promise<any> {
  return new Promise(resolve => {
    const handler = (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.type === type) {
        ws.removeEventListener('message', handler);
        resolve(msg);
      }
    };
    ws.addEventListener('message', handler);
  });
}

async function testLiveServerRoleAndPlanValidation(): Promise<void> {
  const port = 34583;
  const proc = spawn('npm', ['run', 'game-server'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), MULTIPLAYER_TICK_MS: '200' },
  });
  try {
    await waitForServerReady(proc);
    const roomId = `authority-${Date.now()}`;
    const host = await openSocket(port);
    host.send(JSON.stringify({ type: 'join', roomId, role: 'host' }));
    await waitForMessage(host, 'joined');

    host.send(JSON.stringify({ type: 'plan', plan: { moveTargets: 'not-an-array' } }));

    const duplicateHost = await openSocket(port);
    duplicateHost.send(JSON.stringify({ type: 'join', roomId, role: 'host' }));
    const duplicateHostError = await waitForMessage(duplicateHost, 'error');
    assert(/host slot/i.test(duplicateHostError.message), 'duplicate host should be rejected');
    duplicateHost.close();

    const guest = await openSocket(port);
    guest.send(JSON.stringify({ type: 'join', roomId, role: 'guest' }));
    await waitForMessage(guest, 'joined');

    const duplicateGuest = await openSocket(port);
    duplicateGuest.send(JSON.stringify({ type: 'join', roomId, role: 'guest' }));
    const duplicateGuestError = await waitForMessage(duplicateGuest, 'error');
    assert(/guest slot|full/i.test(duplicateGuestError.message), 'duplicate guest should be rejected');
    duplicateGuest.close();
    guest.close();
    host.close();
  } finally {
    if (!proc.killed) proc.kill('SIGTERM');
    await once(proc, 'exit').catch(() => undefined);
  }
}

async function main(): Promise<void> {
  testStepSimulationMoveOwnership();
  await testLiveServerRoleAndPlanValidation();
  console.log('verify-multiplayer-authority: ok');
}

void main().catch(err => {
  console.error(err);
  process.exit(1);
});
