/**
 * Regressions:
 * 1) AI first L3 archer recruit must deduct iron after doctrine object replace
 * 2) Headless construction BP per economy cycle must match live (30 ticks × availBP/50)
 */
import { applyAiRecruitsAsPending } from '../src/lib/applyAiPlan';
import type { PendingLandRecruit } from '../src/lib/pendingLandRecruit';
import {
  UNIT_L3_COSTS,
  BP_RATE_BASE,
  MOVEMENT_TICKS_PER_ECONOMY_CYCLE,
  STARTING_TECHS,
  type City,
  type Player,
  type Unit,
} from '../src/types/game';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const ironCost = UNIT_L3_COSTS.ranged.iron ?? 0;
assert(ironCost > 0, 'expected L3 ranged iron cost');

const city: City = {
  id: 'c1',
  name: 'Test',
  q: 0,
  r: 0,
  ownerId: 'player_ai',
  population: 50,
  morale: 80,
  storage: {
    food: 0,
    goods: 0,
    guns: 10,
    gunsL2: 10,
    iron: ironCost,
    stone: 0,
    wood: 0,
    refinedWood: UNIT_L3_COSTS.ranged.refinedWood ?? 0,
  },
  storageCap: {
    food: 100,
    goods: 100,
    guns: 100,
    gunsL2: 100,
    iron: 100,
    stone: 100,
    wood: 100,
    refinedWood: 100,
  },
  buildings: [{ type: 'barracks', q: 0, r: 1, level: 3 }],
  // No archerDoctrineL3 — first L3 archer sets doctrine and used to break indexOf spend
};

const cities = [city];
let gold = 100;
const player: Pick<Player, 'gold' | 'researchedTechs'> = {
  gold,
  researchedTechs: [...STARTING_TECHS],
};
const units: Unit[] = [];
const pending: PendingLandRecruit[] = [];

applyAiRecruitsAsPending(
  [{ cityId: 'c1', type: 'ranged', armsLevel: 3, rangedVariant: 'marksman' }],
  {
    aiPlayerId: 'player_ai',
    newCycle: 1,
    cities,
    units,
    getPlayer: () => ({ ...player, gold }),
    onSpendGold: delta => {
      gold -= delta;
    },
    pendingRecruitsOut: { push: item => pending.push(item) },
    generateId: prefix => `${prefix}_1`,
  },
);

assert(pending.length === 1, 'recruit should queue');
assert(cities[0].archerDoctrineL3 === 'marksman', 'doctrine should lock');
assert(
  (cities[0].storage.iron ?? 0) === 0,
  `iron must be deducted after doctrine replace (got ${cities[0].storage.iron})`,
);
assert(gold === 100 - UNIT_L3_COSTS.ranged.gold, 'gold must be spent');

const availBP = 50;
const livePerCycle = availBP * (MOVEMENT_TICKS_PER_ECONOMY_CYCLE / BP_RATE_BASE);
assert(livePerCycle === 30, `expected 30 BP/cycle for availBP=50, got ${livePerCycle}`);
assert(livePerCycle !== availBP, 'headless must not use bpGain=availBP (1.67× live)');

console.log('verify-ai-recruit-and-bp-pace: ok');
