/**
 * Regression: a city's emigration budget must not be sent in full to every destination.
 * Run: npx ts-node --transpile-only -r tsconfig-paths/register --project tsconfig.train.json scripts/verify-migration-budget.ts
 */
import { migrationPhase } from '../src/lib/gameLoop';
import type { City, CityBuilding, Player } from '../src/types/game';
import { CITY_CENTER_STORAGE } from '../src/types/game';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function emptyStorage() {
  return { food: 400, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 0, wood: 0, refinedWood: 0 };
}

function city(partial: {
  id: string;
  name: string;
  q: number;
  r: number;
  population: number;
  morale: number;
  buildings: CityBuilding[];
}): City {
  return {
    ownerId: 'player_human',
    storage: emptyStorage(),
    storageCap: { ...CITY_CENTER_STORAGE },
    ...partial,
  };
}

const source = city({
  id: 'src',
  name: 'Feeder',
  q: 0,
  r: 0,
  population: 30,
  morale: 20,
  buildings: [{ type: 'city_center', q: 0, r: 0, assignedWorkers: 0 }],
});

const destA = city({
  id: 'a',
  name: 'JobsA',
  q: 4,
  r: 0,
  population: 6,
  morale: 90,
  buildings: [
    { type: 'city_center', q: 4, r: 0, assignedWorkers: 1 },
    { type: 'farm', q: 5, r: 0, level: 1, assignedWorkers: 2 },
    { type: 'farm', q: 6, r: 0, level: 1, assignedWorkers: 2 },
    { type: 'farm', q: 7, r: 0, level: 1, assignedWorkers: 1 },
  ],
});

const destB = city({
  id: 'b',
  name: 'JobsB',
  q: 0,
  r: 5,
  population: 6,
  morale: 90,
  buildings: [
    { type: 'city_center', q: 0, r: 5, assignedWorkers: 1 },
    { type: 'farm', q: 0, r: 6, level: 1, assignedWorkers: 2 },
    { type: 'farm', q: 0, r: 7, level: 1, assignedWorkers: 2 },
    { type: 'farm', q: 1, r: 7, level: 1, assignedWorkers: 1 },
  ],
});

const destC = city({
  id: 'c',
  name: 'JobsC',
  q: 8,
  r: 8,
  population: 6,
  morale: 90,
  buildings: [
    { type: 'city_center', q: 8, r: 8, assignedWorkers: 1 },
    { type: 'farm', q: 9, r: 8, level: 1, assignedWorkers: 2 },
    { type: 'farm', q: 9, r: 9, level: 1, assignedWorkers: 2 },
    { type: 'farm', q: 8, r: 9, level: 1, assignedWorkers: 1 },
  ],
});

const player: Player = {
  id: 'player_human',
  name: 'Human',
  color: '#fff',
  gold: 100,
  taxRate: 0.3,
  foodPriority: 'civilian',
  isHuman: true,
};

const cities = [source, destA, destB, destC];
const startPop = cities.reduce((s, c) => s + c.population, 0);
const sourceStart = source.population;

const notifs: string[] = [];
migrationPhase(cities, [player], 12, (msg) => {
  notifs.push(msg);
});

const sourceEnd = cities.find(c => c.id === 'src')!.population;
const left = sourceStart - sourceEnd;
const endPop = cities.reduce((s, c) => s + c.population, 0);
const destGains =
  (cities.find(c => c.id === 'a')!.population - 6) +
  (cities.find(c => c.id === 'b')!.population - 6) +
  (cities.find(c => c.id === 'c')!.population - 6);

assert(endPop === startPop, `empire pop must be conserved (start ${startPop} end ${endPop})`);
assert(left > 0, `feeder with unemployment and 3 job-open destinations should send migrants (left=${left})`);
assert(
  left === 1,
  `emigration budget must be 1 for this setup, not 1 per destination (left=${left}; destGains=${destGains}; notifs=${notifs.join(' | ')})`,
);
assert(destGains === left, `destination gains (${destGains}) must equal source loss (${left})`);

const employedSrc = cities
  .find(c => c.id === 'src')!
  .buildings.reduce((s, b) => s + (b.assignedWorkers ?? 0), 0);
assert(
  sourceEnd >= employedSrc,
  `source pop ${sourceEnd} must not fall below employment ${employedSrc}`,
);

console.log('verify-migration-budget: ok');
