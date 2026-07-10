/**
 * Critical multiplayer/fog regression checks.
 * Run with: npm exec -- tsx scripts/verify-multiplayer-authority.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { initMultiplayerGame, stepSimulation, DEFAULT_AI_PARAMS } from '../src/core/gameCore';
import { emptyAiActions } from '../src/lib/ai';
import { tileKey } from '../src/types/game';
import type { Unit } from '../src/types/game';
import { sanitizeClientPlan } from '../game-server/src/clientPlans';

const P1 = 'player_ai';
const P2 = 'player_ai_2';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function repoFile(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function makeUnit(id: string, ownerId: string, q: number, r: number): Unit {
  return {
    id,
    type: 'infantry',
    q,
    r,
    ownerId,
    hp: 100,
    maxHp: 100,
    xp: 0,
    level: 1,
    armsLevel: 1,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
  };
}

const baseState = initMultiplayerGame(5047, { width: 38, height: 38 });
const p1City = baseState.cities.find(city => city.ownerId === P1);
const p2City = baseState.cities.find(city => city.ownerId === P2);
assert(p1City, 'seeded multiplayer game should include a P1 city');
assert(p2City, 'seeded multiplayer game should include a P2 city');

const state = {
  ...baseState,
  units: [
    makeUnit('regression-p1-infantry', P1, p1City.q, p1City.r),
    makeUnit('regression-p2-infantry', P2, p2City.q, p2City.r),
  ],
};
const p1Unit = state.units.find(unit => unit.ownerId === P1 && unit.hp > 0);
const p2Unit = state.units.find(unit => unit.ownerId === P2 && unit.hp > 0);
assert(p1Unit, 'seeded multiplayer game should include a P1 unit');
assert(p2Unit, 'seeded multiplayer game should include a P2 unit');

const p1Target = { toQ: p2City.q, toR: p2City.r };
const stolenTarget = { toQ: p1City.q, toR: p1City.r };
assert(state.tiles.has(tileKey(p1Target.toQ, p1Target.toR)), 'P1 test target should be in-map');
assert(state.tiles.has(tileKey(stolenTarget.toQ, stolenTarget.toR)), 'stolen test target should be in-map');

const sanitized = sanitizeClientPlan(
  {
    moveTargets: [
      { unitId: p2Unit.id, ...stolenTarget },
      { unitId: p1Unit.id, ...p1Target },
      { unitId: p1Unit.id, toQ: Number.NaN, toR: p1Target.toR },
      { unitId: p1Unit.id, toQ: p1Target.toQ + 10000, toR: p1Target.toR + 10000 },
    ],
    recruits: [{ cityId: 'not-owned', unitType: 'infantry' }],
  } as any,
  state,
  P1,
);

assert(sanitized.moveTargets.length === 1, 'sanitizer should keep only valid owned move targets');
assert(sanitized.moveTargets[0]?.unitId === p1Unit.id, 'sanitizer should drop opponent unit move targets');
assert(sanitized.recruits.length === 0, 'sanitizer should drop non-move client plan fields');

const malicious = {
  [P1]: { ...emptyAiActions(), moveTargets: [{ unitId: p2Unit.id, ...stolenTarget }] },
  [P2]: emptyAiActions(),
};
const afterMaliciousStep = stepSimulation(
  state,
  DEFAULT_AI_PARAMS,
  DEFAULT_AI_PARAMS,
  undefined,
  undefined,
  { humanPlansByPlayerId: malicious },
);
const p2After = afterMaliciousStep.units.find(unit => unit.id === p2Unit.id);
assert(p2After, 'opponent unit should survive the authority regression step');
assert(
  p2After.targetQ !== stolenTarget.toQ || p2After.targetR !== stolenTarget.toR,
  'P1 must not be able to retarget a P2 unit through moveTargets',
);

const gameCore = repoFile('src/core/gameCore.ts');
assert(
  gameCore.includes('u.id === mt.unitId && u.ownerId === aiPlayerId'),
  'shared simulation move application must check unit ownership',
);

const store = repoFile('src/store/useGameStore.ts');
assert(
  store.includes('u.id === mt.unitId && u.ownerId === aiPlayerId'),
  'live store move application must check unit ownership',
);
assert(
  store.includes("previous.gameMode !== 'multiplayer'") && store.includes('exploredHexes: resetVision'),
  'multiplayer snapshots must reset stale fog when entering or changing maps',
);

const server = repoFile('game-server/src/index.ts');
assert(server.includes('sanitizeClientPlan'), 'game server must sanitize client plans before merging');
assert(server.includes('client.role === msg.role'), 'game server must reject duplicate host/guest roles');

const hexGrid = repoFile('src/components/game/HexGrid.tsx');
assert(
  hexGrid.includes('for (const tile of discoveredTilesMap.values())') &&
    hexGrid.includes('for (const t of discoveredTilesMap.values())') &&
    hexGrid.includes('opacity: 0.93') &&
    hexGrid.includes('tilesMap={discoveredTilesMap}'),
  'fog rendering must derive terrain, shoreline, snow, and opacity from discovered tiles',
);

const remap = repoFile('src/lib/multiplayerRemap.ts');
assert(remap.includes('scoutTowers: state.scoutTowers.map'), 'guest remap must map scout tower owners');
assert(remap.includes('combatMoraleState: new Map'), 'guest remap must map combat morale owners');

const mapController = repoFile('src/components/game/MapController.tsx');
assert(
  mapController.includes('userHasPanned') && mapController.includes('lastAppliedTargetRef'),
  'map controller must accept corrected initial targets before user pan',
);

const gameServerPackage = JSON.parse(repoFile('game-server/package.json')) as { type?: string };
assert(gameServerPackage.type !== 'module', 'game-server package-local ESM marker must stay removed');

console.log('verify-multiplayer-authority: ok');
