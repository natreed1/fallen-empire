import assert from 'assert';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';
import { initMultiplayerGame, stepSimulation, DEFAULT_AI_PARAMS, type SimState } from '../src/core/gameCore';
import { emptyAiActions } from '../src/lib/ai';
import { remapSimStateForClient } from '../src/lib/multiplayerRemap';
import { sanitizeClientPlan } from '../game-server/src/clientPlans';
import { getUnitStats, type Unit } from '../src/types/game';

const P1 = 'player_ai';
const P2 = 'player_ai_2';
const LOCAL = 'player_human';

function makeInfantry(id: string, ownerId: string, q: number, r: number): Unit {
  const stats = getUnitStats({ type: 'infantry' });
  return {
    id,
    type: 'infantry',
    q,
    r,
    ownerId,
    hp: stats.maxHp,
    maxHp: stats.maxHp,
    xp: 0,
    level: 1,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
  };
}

function stateWithUnits(): SimState {
  const state = initMultiplayerGame(12345);
  const [p1City, p2City] = state.cities;
  return {
    ...state,
    units: [
      makeInfantry('p1_unit', P1, p1City.q, p1City.r),
      makeInfantry('p2_unit', P2, p2City.q, p2City.r),
    ],
  };
}

function verifyPlanSanitizer(): void {
  const state = stateWithUnits();
  const [p1City, p2City] = state.cities;
  const sanitized = sanitizeClientPlan(
    {
      moveTargets: [
        { unitId: 'p2_unit', toQ: p1City.q, toR: p1City.r },
        { unitId: 'p1_unit', toQ: p2City.q, toR: p2City.r },
        { unitId: 'p1_unit', toQ: Number.NaN, toR: p2City.r },
        { unitId: 'missing', toQ: p2City.q, toR: p2City.r },
      ],
      recruits: [{ cityId: state.cities[0].id, type: 'infantry' }],
      builds: [{ cityId: state.cities[0].id, type: 'barracks', q: p1City.q, r: p1City.r }],
    },
    state,
    P1,
  );

  assert.deepStrictEqual(sanitized.moveTargets, [{ unitId: 'p1_unit', toQ: p2City.q, toR: p2City.r }]);
  assert.strictEqual(sanitized.recruits.length, 0);
  assert.strictEqual(sanitized.builds.length, 0);
}

function verifyStepSimulationAuthority(): void {
  const state = stateWithUnits();
  const [p1City, p2City] = state.cities;
  const p1Plan = emptyAiActions();
  p1Plan.moveTargets = [
    { unitId: 'p2_unit', toQ: p1City.q, toR: p1City.r },
    { unitId: 'p1_unit', toQ: p2City.q, toR: p2City.r },
  ];

  const next = stepSimulation(
    state,
    DEFAULT_AI_PARAMS,
    DEFAULT_AI_PARAMS,
    undefined,
    undefined,
    { humanPlansByPlayerId: { [P1]: p1Plan, [P2]: emptyAiActions() } },
  );

  const p1Unit = next.units.find(u => u.id === 'p1_unit');
  const p2Unit = next.units.find(u => u.id === 'p2_unit');
  assert(p1Unit, 'expected P1 unit to exist');
  assert(p2Unit, 'expected P2 unit to exist');
  assert.strictEqual(p1Unit.targetQ, p2City.q);
  assert.strictEqual(p1Unit.targetR, p2City.r);
  assert.strictEqual(p2Unit.targetQ, undefined);
  assert.strictEqual(p2Unit.targetR, undefined);
}

function verifyGuestRemap(): void {
  const state = stateWithUnits();
  const p2City = state.cities[1];
  const remapped = remapSimStateForClient(
    {
      ...state,
      scoutTowers: [{ id: 'tower_p2', ownerId: P2, q: p2City.q, r: p2City.r }],
      combatMoraleState: new Map([['stack', { ownerId: P2, morale: 0.8 }]]),
    },
    'guest',
  );

  assert.strictEqual(remapped.scoutTowers[0]?.ownerId, LOCAL);
  assert.strictEqual(remapped.combatMoraleState.get('stack')?.ownerId, LOCAL);
}

function verifyFogSourceGuards(): void {
  const hexGrid = fs.readFileSync(path.join(process.cwd(), 'src/components/game/HexGrid.tsx'), 'utf8');
  assert(
    hexGrid.includes('for (const tile of discoveredTilesMap.values())'),
    'terrain groups must render only discovered tiles',
  );
  assert(
    hexGrid.includes('for (const t of discoveredTilesMap.values())'),
    'shoreline groups must render only discovered tiles',
  );
  assert(hexGrid.includes('opacity: 0.93'), 'unknown fog must stay opaque enough to hide terrain');
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
}

function waitForMessage(ws: WebSocket, predicate: (msg: any) => boolean): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for WebSocket message'));
    }, 5000);
    const onMessage = (data: WebSocket.RawData) => {
      const msg = JSON.parse(String(data));
      if (!predicate(msg)) return;
      cleanup();
      resolve(msg);
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      clearTimeout(timer);
      ws.off('message', onMessage);
      ws.off('error', onError);
    };
    ws.on('message', onMessage);
    ws.on('error', onError);
  });
}

async function verifyDuplicateRoleRejection(): Promise<void> {
  const port = 36000 + Math.floor(Math.random() * 2000);
  const tsxBin = path.join(process.cwd(), 'node_modules/.bin/tsx');
  const server: ChildProcessWithoutNullStreams = spawn(tsxBin, ['game-server/src/index.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), MULTIPLAYER_TICK_MS: '60000' },
  });

  let output = '';
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 10000);
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
      reject(new Error(`Server exited early with ${code}: ${output}`));
    });
  });

  try {
    await ready;
    const first = new WebSocket(`ws://127.0.0.1:${port}`);
    const second = new WebSocket(`ws://127.0.0.1:${port}`);
    await Promise.all([waitForOpen(first), waitForOpen(second)]);
    first.send(JSON.stringify({ type: 'join', roomId: 'authority-test', role: 'host' }));
    await waitForMessage(first, msg => msg.type === 'joined');
    second.send(JSON.stringify({ type: 'join', roomId: 'authority-test', role: 'host' }));
    const rejection = await waitForMessage(second, msg => msg.type === 'error');
    assert.match(rejection.message, /already has a host/i);
    first.close();
    second.close();
  } finally {
    server.kill();
  }
}

async function main(): Promise<void> {
  verifyPlanSanitizer();
  verifyStepSimulationAuthority();
  verifyGuestRemap();
  verifyFogSourceGuards();
  await verifyDuplicateRoleRejection();
  console.log('Multiplayer authority regression checks passed');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
