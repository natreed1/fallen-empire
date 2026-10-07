/**
 * AI instant quarry/mine/gold mine must not delete population.
 * Run: npx tsx scripts/verify-ai-instant-build-pop.ts
 */
import { applyAiInstantBuilds } from '../src/lib/applyAiPlan';
import {
  BUILDING_COSTS,
  BUILDING_IRON_COSTS,
  BUILDING_JOBS,
  STARTING_TECHS,
  VILLAGE_CITY_TEMPLATE,
  type City,
  type Player,
  type TechId,
} from '../src/types/game';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function makeCity(population: number, iron = 0): City {
  return {
    id: 'c1',
    name: 'Outpost',
    q: 4,
    r: 4,
    ownerId: 'player_ai',
    ...structuredClone(VILLAGE_CITY_TEMPLATE),
    population,
    storage: { ...VILLAGE_CITY_TEMPLATE.storage, iron },
    buildings: [{ type: 'city_center', q: 4, r: 4, level: 1, assignedWorkers: 1 }],
  };
}

function makePlayer(techs: TechId[]): Player {
  return {
    id: 'player_ai',
    name: 'North',
    color: '#888',
    gold: 200,
    taxRate: 0.2,
    foodPriority: 'civilian',
    isHuman: false,
    researchedTechs: techs,
  };
}

const popBefore = 10;
const city = makeCity(popBefore);
const player = makePlayer(STARTING_TECHS);
let spent = 0;

applyAiInstantBuilds(
  [
    { cityId: city.id, type: 'quarry', q: 5, r: 4 },
    { cityId: city.id, type: 'mine', q: 5, r: 5 },
  ],
  {
    aiPlayerId: player.id,
    cities: [city],
    getPlayer: () => player,
    onSpendGold: d => {
      spent += d;
      player.gold -= d;
    },
  },
);

assert(city.population === popBefore, `quarry+mine deleted population (now ${city.population}, was ${popBefore})`);
assert(city.buildings.some(b => b.type === 'quarry'), 'quarry was not built');
assert(city.buildings.some(b => b.type === 'mine'), 'mine was not built');
for (const b of city.buildings) {
  if (b.type !== 'quarry' && b.type !== 'mine') continue;
  const jobs = BUILDING_JOBS[b.type];
  const assigned = b.assignedWorkers ?? 0;
  assert(assigned <= jobs, `${b.type} assigned ${assigned} workers but only has ${jobs} jobs`);
}
assert(spent === BUILDING_COSTS.quarry + BUILDING_COSTS.mine, `gold spend ${spent}`);

const goldCity = makeCity(10, 20);
const goldPlayer = makePlayer([...STARTING_TECHS, 'mining_2']);
applyAiInstantBuilds([{ cityId: goldCity.id, type: 'gold_mine', q: 3, r: 4 }], {
  aiPlayerId: goldPlayer.id,
  cities: [goldCity],
  getPlayer: () => goldPlayer,
  onSpendGold: d => {
    goldPlayer.gold -= d;
  },
});
assert(goldCity.population === 10, `gold mine deleted population (now ${goldCity.population})`);
assert(
  (goldCity.storage.iron ?? 0) === 20 - (BUILDING_IRON_COSTS.gold_mine ?? 0),
  'gold mine did not pay its iron cost',
);
const goldMine = goldCity.buildings.find(b => b.type === 'gold_mine');
assert(!!goldMine, 'gold mine was not built');
assert(
  (goldMine?.assignedWorkers ?? 0) <= BUILDING_JOBS.gold_mine,
  'gold mine over-assigned workers',
);

console.log('verify-ai-instant-build-pop: ok');
