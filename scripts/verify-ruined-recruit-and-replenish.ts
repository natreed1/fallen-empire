/**
 * Regression: ruined military buildings must not train units, and auto-replenish
 * must respect L3 barracks gates without charging L2 stone for L3 units.
 */
import { applyAiRecruitsAsPending } from '../src/lib/applyAiPlan';
import { computeArmyReplenishment } from '../src/lib/armyReplenishment';
import {
  ensureCityBuildingHp,
  isCityBuildingOperational,
  UNIT_L2_COSTS,
  UNIT_L3_COSTS,
  type City,
  type Player,
  type Unit,
  type UnitStack,
} from '../src/types/game';
import type { PendingLandRecruit } from '../src/lib/pendingLandRecruit';

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const ruinedBarracks = ensureCityBuildingHp({
  type: 'barracks',
  q: 0,
  r: 1,
  level: 3,
  buildingState: 'ruins',
  hp: 0,
});
assert(!isCityBuildingOperational(ruinedBarracks), 'ruined barracks not operational');

const cityRuined: City = {
  id: 'c1',
  name: 'X',
  q: 0,
  r: 0,
  ownerId: 'ai1',
  population: 100,
  morale: 80,
  storage: { food: 0, goods: 0, guns: 0, gunsL2: 50, iron: 50, stone: 50, wood: 0, refinedWood: 0 },
  storageCap: { food: 0, goods: 0, guns: 0, gunsL2: 100, iron: 100, stone: 100, wood: 0, refinedWood: 0 },
  buildings: [ruinedBarracks],
};

const pendingFromRuins: PendingLandRecruit[] = [];
let gold = 500;
applyAiRecruitsAsPending(
  [{ cityId: 'c1', type: 'infantry', armsLevel: 1 }],
  {
    aiPlayerId: 'ai1',
    newCycle: 1,
    cities: [cityRuined],
    units: [],
    getPlayer: () => ({ gold, researchedTechs: [] as never[] }),
    onSpendGold: (d) => { gold -= d; },
    pendingRecruitsOut: pendingFromRuins,
    generateId: (p) => `${p}_1`,
  },
);
assert(pendingFromRuins.length === 0, 'AI must not recruit from ruined barracks');
assert(gold === 500, 'ruined recruit must not spend gold');

const cityNoBarracks: City = {
  ...cityRuined,
  id: 'c2',
  buildings: [],
};
const pendingNoBarracks: PendingLandRecruit[] = [];
applyAiRecruitsAsPending(
  [{ cityId: 'c2', type: 'infantry', armsLevel: 1 }],
  {
    aiPlayerId: 'ai1',
    newCycle: 1,
    cities: [cityNoBarracks],
    units: [],
    getPlayer: () => ({ gold: 500, researchedTechs: [] as never[] }),
    onSpendGold: () => {},
    pendingRecruitsOut: pendingNoBarracks,
    generateId: (p) => `${p}_2`,
  },
);
assert(pendingNoBarracks.length === 0, 'AI must not recruit L1 infantry without barracks');

const cityRuinedSiege: City = {
  ...cityRuined,
  id: 'c3',
  buildings: [
    ensureCityBuildingHp({
      type: 'siege_workshop',
      q: 0,
      r: 2,
      level: 1,
      buildingState: 'ruins',
      hp: 0,
    }),
  ],
};
const pendingSiege: PendingLandRecruit[] = [];
applyAiRecruitsAsPending(
  [{ cityId: 'c3', type: 'trebuchet', armsLevel: 1 }],
  {
    aiPlayerId: 'ai1',
    newCycle: 1,
    cities: [cityRuinedSiege],
    units: [],
    getPlayer: () => ({ gold: 500, researchedTechs: [] as never[] }),
    onSpendGold: () => {},
    pendingRecruitsOut: pendingSiege,
    generateId: (p) => `${p}_3`,
  },
);
assert(pendingSiege.length === 0, 'AI must not recruit from ruined siege workshop');

const l2BarracksCity: City = {
  id: 'c4',
  name: 'Y',
  q: 1,
  r: 0,
  ownerId: 'p1',
  population: 100,
  morale: 80,
  storage: { food: 0, goods: 0, guns: 0, gunsL2: 50, iron: 50, stone: 50, wood: 0, refinedWood: 20 },
  storageCap: { food: 0, goods: 0, guns: 0, gunsL2: 100, iron: 100, stone: 100, wood: 0, refinedWood: 100 },
  buildings: [{ type: 'barracks', q: 1, r: 1, level: 2 }],
  archerDoctrineL3: 'marksman',
};

const armyL3: UnitStack = {
  id: 'a1',
  ownerId: 'p1',
  homeCityId: 'c4',
  name: 'Iron',
  composition: [{ unitType: 'infantry', armsLevel: 3, count: 2 }],
  autoReplenish: true,
  rallyQ: 1,
  rallyR: 0,
};

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

const units: Unit[] = [];
const replenL3 = computeArmyReplenishment({
  unitStacks: [armyL3],
  units,
  cities: [l2BarracksCity],
  players: [player],
  cycle: 5,
  pendingRecruits: [],
});
assert(replenL3.newPending.length === 0, 'L2 barracks must not auto-replenish L3 infantry');

const l3BarracksCity: City = {
  ...l2BarracksCity,
  id: 'c5',
  buildings: [{ type: 'barracks', q: 1, r: 1, level: 3 }],
  archerDoctrineL3: 'marksman',
};
const armyL3ok: UnitStack = { ...armyL3, homeCityId: 'c5' };
const stoneBefore = l3BarracksCity.storage.stone ?? 0;
const replenOk = computeArmyReplenishment({
  unitStacks: [armyL3ok],
  units,
  cities: [l3BarracksCity],
  players: [{ ...player }],
  cycle: 5,
  pendingRecruits: [],
});
assert(replenOk.newPending.length === 1, 'L3 barracks should queue L3 replenishment');
assert(replenOk.newPending[0].effectiveArmsLevel === 3, 'queued arms level is 3');
const stoneAfter = replenOk.cities.find(c => c.id === 'c5')!.storage.stone ?? 0;
const l2Stone = UNIT_L2_COSTS.infantry.stone ?? 0;
const l3Iron = UNIT_L3_COSTS.infantry.iron ?? 0;
assert(l2Stone > 0, 'fixture expects L2 infantry stone cost');
assert(l3Iron > 0, 'fixture expects L3 infantry iron cost');
assert(stoneAfter === stoneBefore, 'L3 replenishment must not charge L2 stone');

const ruinedHome: City = {
  ...l3BarracksCity,
  id: 'c6',
  buildings: [ruinedBarracks],
};
const replenRuined = computeArmyReplenishment({
  unitStacks: [{ ...armyL3, homeCityId: 'c6', composition: [{ unitType: 'infantry', armsLevel: 1, count: 2 }] }],
  units,
  cities: [ruinedHome],
  players: [{ ...player }],
  cycle: 5,
  pendingRecruits: [],
});
assert(replenRuined.newPending.length === 0, 'auto-replenish must not use ruined barracks');

console.log('verify-ruined-recruit-and-replenish: ok');
