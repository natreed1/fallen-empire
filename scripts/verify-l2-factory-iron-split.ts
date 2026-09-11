/**
 * L2 factory short-iron split: produced arms must be stored, not floor-divided to 0.
 * Run: npx tsx scripts/verify-l2-factory-iron-split.ts
 */
import { processEconomyTurn, l2FactoryArmsShares } from '../src/lib/gameLoop';
import {
  CITY_CENTER_STORAGE,
  FACTORY_L2_ARMS_PER_CYCLE,
  FACTORY_L2_IRON_PER_CYCLE,
  type City,
  type Player,
} from '../src/types/game';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function sum(xs: number[]): number {
  return xs.reduce((s, n) => s + n, 0);
}

assert(l2FactoryArmsShares(6, 7).join(',') === '1,1,1,1,1,1,0', '7 cities / 6 arms');
assert(sum(l2FactoryArmsShares(6, 7)) === 6, '7-city shares sum to produced');
assert(l2FactoryArmsShares(6, 4).join(',') === '2,2,1,1', '4 cities / 6 arms');
assert(sum(l2FactoryArmsShares(6, 4)) === 6, '4-city shares sum to produced');
assert(l2FactoryArmsShares(6, 3).join(',') === '2,2,2', 'even split unchanged');
assert(l2FactoryArmsShares(6, 1).join(',') === '6', 'single factory gets the batch');
assert(l2FactoryArmsShares(0, 7).every(n => n === 0), 'zero produced');
assert(l2FactoryArmsShares(6, 0).length === 0, 'no factories');

function makeCity(id: string, iron: number): City {
  return {
    id,
    name: id,
    q: 0,
    r: 0,
    ownerId: 'p1',
    population: 80,
    morale: 100,
    storage: {
      food: 400,
      goods: 0,
      guns: 0,
      gunsL2: 0,
      iron,
      stone: 0,
      wood: 0,
      refinedWood: 0,
    },
    storageCap: { ...CITY_CENTER_STORAGE },
    buildings: [{ type: 'factory', q: 1, r: 0, level: 2, assignedWorkers: 0 }],
  };
}

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

function runFactories(cityCount: number, startingIron: number) {
  const cities = Array.from({ length: cityCount }, (_, i) =>
    makeCity(`c${i}`, i === 0 ? startingIron : 0),
  );
  const result = processEconomyTurn(
    cities,
    [],
    [player],
    new Map(),
    new Map(),
    1,
    1,
  );
  const ironAfter = result.cities.reduce((s, c) => s + (c.storage.iron ?? 0), 0);
  const gunsL2 = result.cities.reduce((s, c) => s + (c.storage.gunsL2 ?? 0), 0);
  const toast = result.notifications.find(n => n.message.includes('L2 arms'));
  return { ironAfter, gunsL2, toast: toast?.message ?? '' };
}

const seven = runFactories(7, 1);
assert(seven.ironAfter === 0, `7 factories / 1 iron: iron should be spent, got ${seven.ironAfter}`);
assert(
  seven.gunsL2 === FACTORY_L2_ARMS_PER_CYCLE,
  `7 factories / 1 iron: expected ${FACTORY_L2_ARMS_PER_CYCLE} L2 arms stored, got ${seven.gunsL2}`,
);
assert(
  seven.toast.includes(`+${FACTORY_L2_ARMS_PER_CYCLE} L2 arms`) && seven.toast.includes(`${FACTORY_L2_IRON_PER_CYCLE} iron`),
  `7 factories toast should match stored arms, got "${seven.toast}"`,
);

const four = runFactories(4, 1);
assert(four.ironAfter === 0, `4 factories / 1 iron: iron should be spent, got ${four.ironAfter}`);
assert(
  four.gunsL2 === FACTORY_L2_ARMS_PER_CYCLE,
  `4 factories / 1 iron: expected ${FACTORY_L2_ARMS_PER_CYCLE} L2 arms stored, got ${four.gunsL2}`,
);

const one = runFactories(1, 1);
assert(one.ironAfter === 0, 'single factory spends the iron');
assert(one.gunsL2 === FACTORY_L2_ARMS_PER_CYCLE, 'single factory stores the full batch');

const plenty = runFactories(2, 2);
assert(plenty.ironAfter === 0, '2 factories / 2 iron: both batches run');
assert(plenty.gunsL2 === FACTORY_L2_ARMS_PER_CYCLE * 2, '2 factories / 2 iron: 12 arms');

console.log('verify-l2-factory-iron-split: ok');
