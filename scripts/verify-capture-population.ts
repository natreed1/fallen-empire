/**
 * Regression checks for capture ownership side-effects and replenishment pop cap.
 * Run: npx tsx scripts/verify-capture-population.ts
 */
import { applyCityCaptureEffects, cityWallHexKeys } from '../src/lib/cityCaptureEffects';
import {
  applyOriginCityPopulationDeath,
  applyOriginCityPopulationReturn,
} from '../src/lib/originCityPopulation';
import { computeArmyReplenishment } from '../src/lib/armyReplenishment';
import type { City, ConstructionSite, Player, Unit, UnitStack, WallSection } from '../src/types/game';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const cityA: City = {
  id: 'c1',
  name: 'Origin',
  q: 0,
  r: 0,
  ownerId: 'p1',
  population: 10,
  morale: 80,
  storage: { food: 0, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 20, wood: 0, refinedWood: 0 },
  storageCap: { food: 0, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 0, wood: 0, refinedWood: 0 },
  buildings: [{ type: 'barracks', q: 0, r: 1, level: 2 }],
};

const fielded: Unit[] = [
  {
    id: 'u1',
    type: 'infantry',
    q: 2,
    r: 0,
    ownerId: 'p1',
    hp: 10,
    maxHp: 10,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
    originCityId: 'c1',
  },
  {
    id: 'u2',
    type: 'infantry',
    q: 3,
    r: 0,
    ownerId: 'p1',
    hp: 10,
    maxHp: 10,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
    originCityId: 'c1',
  },
];

const walls: WallSection[] = [
  { q: 1, r: 0, ownerId: 'p1', hp: 50, maxHp: 50 },
  { q: 0, r: 1, ownerId: 'p1', hp: 50, maxHp: 50 },
  { q: 9, r: 9, ownerId: 'p1', hp: 50, maxHp: 50 }, // far wall — stay with p1
];

const constructions: ConstructionSite[] = [
  {
    id: 'con1',
    type: 'wall_section',
    q: 1,
    r: -1,
    ownerId: 'p1',
    cityId: 'c1',
    bpRequired: 40,
    bpAccumulated: 10,
  },
  {
    id: 'con2',
    type: 'farm',
    q: 5,
    r: 5,
    ownerId: 'p1',
    cityId: 'other',
    bpRequired: 40,
    bpAccumulated: 0,
  },
];

const fx = applyCityCaptureEffects({
  city: cityA,
  previousOwnerId: 'p1',
  newOwnerId: 'p2',
  units: fielded,
  wallSections: walls,
  constructions,
});

assert(fx.city.ownerId === 'p2', 'city owner flips');
assert(fx.city.population === 8, 'strip 2 fielded troop slots from captured pop');
assert(fx.wallSections.find(w => w.q === 1 && w.r === 0)?.ownerId === 'p2', 'near wall transfers');
assert(fx.wallSections.find(w => w.q === 0 && w.r === 1)?.ownerId === 'p2', 'near wall 2 transfers');
assert(fx.wallSections.find(w => w.q === 9 && w.r === 9)?.ownerId === 'p1', 'distant wall stays');
assert(fx.constructions.every(c => c.cityId !== 'c1'), 'city constructions cancelled');
assert(fx.constructions.some(c => c.id === 'con2'), 'unrelated construction kept');
assert(cityWallHexKeys(cityA).has('1,0'), 'ring hex keyed');

const afterDeath = applyOriginCityPopulationDeath(
  [fx.city],
  [{ ...fielded[0], hp: 0 }],
);
assert(afterDeath[0].population === 8, 'death does not drain capturer pop');

const stillOwned = applyOriginCityPopulationDeath(
  [{ ...cityA }],
  [fielded[0]],
);
assert(stillOwned[0].population === 9, 'death drains when origin still owned');

const disbandEnemy = applyOriginCityPopulationReturn([fx.city], fielded);
assert(disbandEnemy[0].population === 8, 'disband does not gift pop to capturer');

const disbandOwn = applyOriginCityPopulationReturn([{ ...cityA }], [fielded[0]]);
assert(disbandOwn[0].population === 11, 'disband returns pop to own city');

const player: Player = {
  id: 'p1',
  name: 'H',
  color: '#fff',
  gold: 5000,
  taxRate: 0.3,
  foodPriority: 'military',
  isHuman: true,
  kingdomId: 'crusaders',
};

const cityCap: City = {
  ...cityA,
  population: 2,
  storage: { ...cityA.storage, stone: 0, iron: 0, refinedWood: 0, gunsL2: 0 },
};

const stacks: UnitStack[] = [
  {
    id: 'a1',
    ownerId: 'p1',
    homeCityId: 'c1',
    name: 'A',
    composition: [{ unitType: 'infantry', armsLevel: 1, count: 2 }],
    autoReplenish: true,
    rallyQ: 0,
    rallyR: 0,
  },
  {
    id: 'a2',
    ownerId: 'p1',
    homeCityId: 'c1',
    name: 'B',
    composition: [{ unitType: 'infantry', armsLevel: 1, count: 2 }],
    autoReplenish: true,
    rallyQ: 1,
    rallyR: 0,
  },
];

const livingOne: Unit[] = [
  {
    id: 'alive',
    type: 'infantry',
    q: 0,
    r: 0,
    ownerId: 'p1',
    hp: 10,
    maxHp: 10,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
    stackId: 'a1',
  },
];

const replen = computeArmyReplenishment({
  unitStacks: stacks,
  units: livingOne,
  cities: [cityCap],
  players: [player],
  cycle: 3,
  pendingRecruits: [],
});
assert(
  replen.newPending.length === 1,
  `pop cap 2 with 1 living => at most 1 pending, got ${replen.newPending.length}`,
);

console.log('verify-capture-population: ok');
