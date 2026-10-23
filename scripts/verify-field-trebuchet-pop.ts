/**
 * Field trebuchets obey the 1-troop-per-population cap and do not drain a city on death.
 * Run: npx tsx scripts/verify-field-trebuchet-pop.ts
 */
import type { City, Unit } from '../src/types/game';
import {
  canReserveAnotherTroop,
  fieldTrebuchetCompletionAction,
  makeFieldTrebuchetUnit,
  refundRefinedWoodToNearestCity,
  reservedTroopSlots,
} from '../src/lib/troopCap';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(!canReserveAnotherTroop(reservedTroopSlots(10, 0, 0), 10), 'living at pop is full');
assert(!canReserveAnotherTroop(reservedTroopSlots(8, 1, 1), 10), 'pending recruit + in-progress trebuchet fill the cap');
assert(canReserveAnotherTroop(reservedTroopSlots(8, 0, 1), 10), 'one slot remains under the cap');

let living = 9;
const population = 10;
const first = fieldTrebuchetCompletionAction(living, population);
assert(first === 'spawn', 'first same-tick engine spawns under the cap');
if (first === 'spawn') living += 1;
const second = fieldTrebuchetCompletionAction(living, population);
assert(second === 'refund', 'second same-tick engine refunds once the cap is filled');

const engine = makeFieldTrebuchetUnit({ id: 't1', q: 4, r: 0, ownerId: 'p1', maxHp: 40 });
assert(engine.originCityId === undefined, 'field trebuchet has no origin city');
assert(engine.type === 'trebuchet' && engine.hp === 40, 'spawned engine stats');

function deductPopOnDeath(units: Unit[], killedIds: Set<string>, cities: { id: string; population: number }[]) {
  const popDeductByCityId: Record<string, number> = {};
  for (const u of units) {
    if (killedIds.has(u.id) && u.originCityId) {
      popDeductByCityId[u.originCityId] = (popDeductByCityId[u.originCityId] ?? 0) + 1;
    }
  }
  return cities.map(c => ({
    ...c,
    population: Math.max(0, c.population - (popDeductByCityId[c.id] ?? 0)),
  }));
}

const village = { id: 'village', population: 10 };
const afterDeath = deductPopOnDeath([engine], new Set(['t1']), [village]);
assert(afterDeath[0].population === 10, 'killing a field trebuchet does not delete village population');

const drafted: Unit = { ...engine, id: 'drafted', originCityId: 'village' };
const afterDraftedDeath = deductPopOnDeath([drafted], new Set(['drafted']), [village]);
assert(afterDraftedDeath[0].population === 9, 'a recruited unit still deducts its origin city');

const storage = { food: 0, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 0, wood: 0, refinedWood: 0 };
const cities: Pick<City, 'id' | 'ownerId' | 'q' | 'r' | 'storage'>[] = [
  { id: 'capital', ownerId: 'p1', q: 0, r: 0, storage: { ...storage, refinedWood: 1 } },
  { id: 'village', ownerId: 'p1', q: 5, r: 0, storage: { ...storage, refinedWood: 0 } },
  { id: 'enemy', ownerId: 'p2', q: 4, r: 0, storage: { ...storage, refinedWood: 0 } },
];
const refunded = refundRefinedWoodToNearestCity(cities, 'p1', 4, 0, 4);
assert(refunded.find(c => c.id === 'village')!.storage.refinedWood === 4, 'refined wood returns to the nearest owned city');
assert(refunded.find(c => c.id === 'capital')!.storage.refinedWood === 1, 'farther city is unchanged');
assert(refunded.find(c => c.id === 'enemy')!.storage.refinedWood === 0, 'enemy city is unchanged');

const capped: typeof cities = [
  { id: 'village', ownerId: 'p1', q: 5, r: 0, storage: { ...storage, refinedWood: 100 } },
];
const overCap = refundRefinedWoodToNearestCity(capped, 'p1', 5, 0, 4);
assert(overCap[0].storage.refinedWood === 104, 'refund is not truncated by storage cap');

console.log('verify-field-trebuchet-pop: ok');
