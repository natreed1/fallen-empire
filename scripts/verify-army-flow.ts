/**
 * Sanity checks for army composition merge + building operational helpers (run with npx tsx).
 */
import {
  mergeCompositionEntry,
  computeArmyReplenishment,
  updateArmyRallyFromUnits,
} from '../src/lib/armyReplenishment';
import { isCityBuildingOperational, ensureCityBuildingHp } from '../src/types/game';
import type { UnitStack, City, Player, Unit } from '../src/types/game';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const a: UnitStack = {
  id: 'a1',
  ownerId: 'p1',
  homeCityId: 'c1',
  name: 'Test',
  composition: [{ unitType: 'infantry', armsLevel: 1, count: 2 }],
  autoReplenish: true,
  rallyQ: 0,
  rallyR: 0,
};

let comp = mergeCompositionEntry(a.composition, 'infantry', 1, 1);
assert(comp.find(e => e.unitType === 'infantry')!.count === 3, 'merge +1');
comp = mergeCompositionEntry(comp, 'infantry', 1, -3);
assert(comp.length === 0, 'merge to zero removes');

const city: City = {
  id: 'c1',
  name: 'X',
  q: 0,
  r: 0,
  ownerId: 'p1',
  population: 100,
  morale: 80,
  storage: { food: 0, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 0, wood: 0, refinedWood: 0 },
  storageCap: { food: 0, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 0, wood: 0, refinedWood: 0 },
  buildings: [{ type: 'barracks', q: 0, r: 1, level: 2 }],
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

const replen = computeArmyReplenishment({
  unitStacks: [a],
  units,
  cities: [city],
  players: [player],
  cycle: 5,
  pendingRecruits: [],
});
assert(replen.newPending.length <= 1, 'at most one queued');

const rallied = updateArmyRallyFromUnits([a], [
  { id: 'u1', type: 'infantry', q: 3, r: -1, ownerId: 'p1', hp: 10, maxHp: 10, xp: 0, level: 0, status: 'idle', stance: 'aggressive', nextMoveAt: 0, stackId: 'a1' } as Unit,
]);
assert(rallied[0].rallyQ === 3 && rallied[0].rallyR === -1, 'rally centroid');

const b = ensureCityBuildingHp({ type: 'farm', q: 0, r: 2, level: 1 });
assert(isCityBuildingOperational(b), 'operational');
const ruins = ensureCityBuildingHp({ type: 'farm', q: 0, r: 2, level: 1, buildingState: 'ruins', hp: 0 });
assert(!isCityBuildingOperational(ruins), 'ruins not operational');

console.log('verify-army-flow: ok');
