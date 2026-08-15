/**
 * Wall stone must be charged only when construction BP actually ran.
 * Live BP gates on pre-economy stone; quarry income must not unlock a fee
 * for a stalled (or newly queued) wall.
 */
import {
  applyWallStoneCharges,
  cityCanPayWallConstruction,
  wallConstructionStoneCost,
  wallStoneChargesForCycle,
} from '../src/lib/wallBuilding';
import {
  WALL_BUILDER_STONE_PER_CYCLE_PER_SLOT,
  type City,
  type ConstructionSite,
} from '../src/types/game';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function city(partial: Partial<City> & Pick<City, 'id' | 'storage'>): City {
  return {
    name: partial.name ?? 'Test',
    q: 0,
    r: 0,
    ownerId: 'p1',
    population: 150,
    morale: 75,
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
    buildings: partial.buildings ?? [
      { type: 'academy', q: 0, r: 1, level: 1 },
    ],
    universityBuilderTask: 'city_defenses',
    universityBuilderSlotTasks: ['city_defenses'],
    ...partial,
  };
}

const wallSite: ConstructionSite = {
  id: 'con1',
  type: 'wall_section',
  q: 1,
  r: 0,
  cityId: 'c1',
  ownerId: 'p1',
  bpRequired: 38,
  bpAccumulated: 0,
  wallBuildRing: 1,
};

assert(WALL_BUILDER_STONE_PER_CYCLE_PER_SLOT === 3, 'slot cost is 3');

// ── Stall: 0 stone at cycle start (starting city + 1 quarry later) ──
const broke = city({
  id: 'c1',
  storage: { food: 0, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 0, wood: 0, refinedWood: 0 },
});
assert(wallConstructionStoneCost(broke) === 3, 'L1 academy / 1 Walls slot costs 3');
assert(!cityCanPayWallConstruction(broke), '0 stone cannot pay');
const stalledCharges = wallStoneChargesForCycle([broke], [wallSite]);
assert(stalledCharges.size === 0, 'stalled wall must not be billed');

// Quarry income after the gate must not create a charge from that snapshot
const afterQuarry = {
  ...broke,
  storage: { ...broke.storage, stone: 3 },
};
const billedFromStallSnapshot = applyWallStoneCharges([afterQuarry], stalledCharges);
assert(billedFromStallSnapshot[0].storage.stone === 3, 'post-economy 3 stone kept when BP stalled');

// Old (buggy) predicate: has site + post-economy stone >= cost → would drain forever
assert(afterQuarry.storage.stone >= 3, 'buggy path would have deducted');

// ── Pay: stockpile already covers the gate ──
const funded = city({
  id: 'c1',
  storage: { food: 0, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 10, wood: 0, refinedWood: 0 },
});
assert(cityCanPayWallConstruction(funded), '10 stone pays 3');
const fundedCharges = wallStoneChargesForCycle([funded], [wallSite]);
assert(fundedCharges.get('c1') === 3, 'funded wall billed 3');
const afterPay = applyWallStoneCharges(
  [{ ...funded, storage: { ...funded.storage, stone: 13 } }],
  fundedCharges,
);
assert(afterPay[0].storage.stone === 10, 'deduct 3 after quarry, leftover 10');

// ── Newly queued wall (AI / auto-build during runCycle) is not in the snapshot ──
const emptyConstructions: ConstructionSite[] = [];
const newQueueCharges = wallStoneChargesForCycle([funded], emptyConstructions);
assert(newQueueCharges.size === 0, 'wall queued after movement ticks is not billed this cycle');
const afterNewQueue = applyWallStoneCharges([funded], newQueueCharges);
assert(afterNewQueue[0].storage.stone === 10, 'new queue keeps stone');

// ── 2 Walls slots, 1 quarry: start 5 < 6, produce 3 → 8; must not deduct ──
const twoSlot = city({
  id: 'c1',
  buildings: [{ type: 'academy', q: 0, r: 1, level: 2 }],
  universityBuilderSlotTasks: ['city_defenses', 'city_defenses'],
  storage: { food: 0, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 5, wood: 0, refinedWood: 0 },
});
assert(wallConstructionStoneCost(twoSlot) === 6, '2 slots cost 6');
assert(!cityCanPayWallConstruction(twoSlot), '5 < 6 stalls BP');
const twoSlotCharges = wallStoneChargesForCycle([twoSlot], [wallSite]);
assert(twoSlotCharges.size === 0, '2-slot stall not billed');
const twoSlotAfterEcon = applyWallStoneCharges(
  [{ ...twoSlot, storage: { ...twoSlot.storage, stone: 8 } }],
  twoSlotCharges,
);
assert(twoSlotAfterEcon[0].storage.stone === 8, 'stone accumulates until start-of-cycle >= 6');

// ── Morale-75 quarry (floor(3*0.75)=2): start 2, produce 2 → 4 ──
const morale75 = city({
  id: 'c1',
  storage: { food: 0, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 2, wood: 0, refinedWood: 0 },
});
assert(!cityCanPayWallConstruction(morale75), '2 < 3 stalls');
const m75Charges = wallStoneChargesForCycle([morale75], [wallSite]);
const m75After = applyWallStoneCharges(
  [{ ...morale75, storage: { ...morale75.storage, stone: 4 } }],
  m75Charges,
);
assert(m75After[0].storage.stone === 4, 'morale-75 quarry stockpile grows instead of looping 4→1');

// ── No academy / no Walls slots: never bill ──
const noSlots = city({
  id: 'c1',
  buildings: [],
  universityBuilderSlotTasks: [],
  storage: { food: 0, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 20, wood: 0, refinedWood: 0 },
});
assert(wallConstructionStoneCost(noSlots) === 0, 'no slots → 0 cost');
assert(wallStoneChargesForCycle([noSlots], [wallSite]).size === 0, 'no slots → no charge');

console.log('verify-wall-stone-charge: ok');
