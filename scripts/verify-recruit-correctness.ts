/**
 * Regression guards for recruit correctness bugs:
 * 1) Pending land recruits must not spawn after the training city is captured.
 * 2) gunsL2 upkeep must be deducted across owned cities (not only from a single city
 *    that already holds the full amount), and army replenishment must not overwrite
 *    a home-city gunsL2 deduction.
 *
 * Run: npx tsx scripts/verify-recruit-correctness.ts
 */
import { spawnUnitFromPendingLand, type PendingLandRecruit } from '../src/lib/pendingLandRecruit';
import { deductGunsL2AcrossCities, totalGunsL2ForOwner } from '../src/lib/gunsL2';
import { computeArmyReplenishment } from '../src/lib/armyReplenishment';
import type { City, Player, Unit, UnitStack } from '../src/types/game';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function baseCity(partial: Partial<City> & Pick<City, 'id' | 'ownerId' | 'storage'> & { storage: City['storage'] }): City {
  return {
    id: partial.id,
    name: partial.name ?? partial.id,
    q: partial.q ?? 0,
    r: partial.r ?? 0,
    ownerId: partial.ownerId,
    population: partial.population ?? 20,
    morale: partial.morale ?? 80,
    storage: { ...partial.storage },
    storageCap: {
      food: 1000,
      goods: 100,
      guns: 100,
      gunsL2: 100,
      iron: 50,
      stone: 50,
      wood: 50,
      refinedWood: 50,
    },
    buildings: partial.buildings ?? [{ type: 'barracks', q: 0, r: 1, level: 2 }],
  };
}

const emptyStorage = (): City['storage'] => ({
  food: 0,
  goods: 0,
  guns: 0,
  gunsL2: 0,
  iron: 0,
  stone: 0,
  wood: 0,
  refinedWood: 0,
});

// ── 1. Capture cancels pending land spawn ───────────────────────────
const pending: PendingLandRecruit = {
  id: 'pr1',
  playerId: 'p1',
  cityId: 'c1',
  type: 'infantry',
  effectiveArmsLevel: 1,
  spawnQ: 0,
  spawnR: 0,
  completesAtCycle: 3,
};

const owned = [baseCity({ id: 'c1', ownerId: 'p1', storage: emptyStorage() })];
const spawned = spawnUnitFromPendingLand(pending, owned);
assert(!!spawned && spawned.ownerId === 'p1', 'owned city should spawn pending recruit');

const captured = [baseCity({ id: 'c1', ownerId: 'p2', storage: emptyStorage() })];
assert(spawnUnitFromPendingLand(pending, captured) === null, 'captured city must cancel pending land recruit');

const missing = [baseCity({ id: 'other', ownerId: 'p1', storage: emptyStorage() })];
assert(spawnUnitFromPendingLand(pending, missing) === null, 'missing city must cancel pending land recruit');

// ── 2. gunsL2 empire-wide deduction ─────────────────────────────────
const splitOk = [
  baseCity({ id: 'a', ownerId: 'p1', storage: { ...emptyStorage(), gunsL2: 1 } }),
  baseCity({ id: 'b', ownerId: 'p1', storage: { ...emptyStorage(), gunsL2: 1 } }),
];
assert(totalGunsL2ForOwner(splitOk, 'p1') === 2, 'total gunsL2 across cities');
const after = deductGunsL2AcrossCities(splitOk, 'p1', 2);
assert(!!after, 'split cities must cover upkeep 2');
assert(totalGunsL2ForOwner(after!, 'p1') === 0, 'full upkeep deducted across cities');
assert(deductGunsL2AcrossCities(splitOk, 'p1', 3) === null, 'insufficient empire gunsL2 rejected');

// ── 3. Army replenishment must actually consume home-city gunsL2 ────
const home = baseCity({
  id: 'home',
  ownerId: 'p1',
  population: 50,
  storage: { ...emptyStorage(), gunsL2: 2, stone: 5 },
  buildings: [{ type: 'barracks', q: 0, r: 1, level: 2 }],
});
const player: Player = {
  id: 'p1',
  name: 'H',
  color: '#fff',
  gold: 500,
  taxRate: 0.3,
  foodPriority: 'military',
  isHuman: true,
  kingdomId: 'crusaders',
};
const stack: UnitStack = {
  id: 'stack1',
  ownerId: 'p1',
  homeCityId: 'home',
  name: 'A',
  composition: [{ unitType: 'ranged', armsLevel: 2, count: 1 }],
  autoReplenish: true,
  rallyQ: 1,
  rallyR: 0,
};
const units: Unit[] = [];

const replen = computeArmyReplenishment({
  unitStacks: [stack],
  units,
  cities: [home],
  players: [player],
  cycle: 4,
  pendingRecruits: [],
});
assert(replen.newPending.length === 1, 'replenishment should queue missing L2 ranged');
assert(
  totalGunsL2ForOwner(replen.cities, 'p1') === 0,
  `replenishment must deduct gunsL2 from home city (got ${totalGunsL2ForOwner(replen.cities, 'p1')})`,
);

console.log('verify-recruit-correctness: ok');
