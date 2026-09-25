/**
 * L1 sawmills must still yield refined wood at starting morale, and must not
 * delete raw wood for output that is not stored.
 * Run: npx tsx scripts/verify-sawmill-morale.ts
 */
import { processEconomyTurn, computeSawmillBuildingPreview } from '../src/lib/gameLoop';
import {
  CITY_CENTER_STORAGE,
  SAWMILL_WOOD_PER_REFINED,
  type City,
  type CityBuilding,
  type Player,
} from '../src/types/game';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function mill(): CityBuilding {
  return { type: 'sawmill', q: 1, r: 0, level: 1, assignedWorkers: 2 };
}

function city(over: Partial<City> = {}): City {
  return {
    id: 'c1',
    name: 'Milltown',
    q: 0,
    r: 0,
    ownerId: 'player_human',
    population: 20,
    morale: 75,
    storage: {
      food: 500,
      goods: 0,
      guns: 0,
      gunsL2: 0,
      iron: 0,
      stone: 0,
      wood: 10,
      refinedWood: 0,
    },
    storageCap: { ...CITY_CENTER_STORAGE },
    buildings: [mill()],
    ...over,
  };
}

function player(): Player {
  return {
    id: 'player_human',
    name: 'You',
    color: '#fff',
    gold: 100,
    taxRate: 0.3,
    foodPriority: 'civilian',
    isHuman: true,
  };
}

function tick(c: City) {
  return processEconomyTurn([c], [], [player()], new Map(), new Map(), 1, 1);
}

// Starting morale is 75. One fully staffed L1 mill must convert 2 wood into 1 refined.
{
  const out = tick(city());
  const next = out.cities[0];
  assert(next.storage.refinedWood === 1, `morale 75 should yield 1 refined, got ${next.storage.refinedWood}`);
  assert(
    next.storage.wood === 10 - SAWMILL_WOOD_PER_REFINED,
    `morale 75 should spend ${SAWMILL_WOOD_PER_REFINED} wood, got ${next.storage.wood}`,
  );
}

// Below the rounding threshold the mill idles and keeps the stockpile.
{
  const out = tick(city({ morale: 40 }));
  const next = out.cities[0];
  assert(next.storage.refinedWood === 0, `morale 40 should yield 0, got ${next.storage.refinedWood}`);
  assert(next.storage.wood === 10, `morale 40 must not burn wood, got ${next.storage.wood}`);
}

// Full refined bin: do not burn wood.
{
  const out = tick(
    city({
      storage: { ...city().storage, wood: 10, refinedWood: CITY_CENTER_STORAGE.refinedWood },
    }),
  );
  const next = out.cities[0];
  assert(next.storage.refinedWood === CITY_CENTER_STORAGE.refinedWood, 'refined stays at cap');
  assert(next.storage.wood === 10, `full bin must not burn wood, got ${next.storage.wood}`);
}

// Two mills sharing one batch of wood must not mint a second refined unit.
{
  const out = tick(
    city({
      morale: 100,
      storage: { ...city().storage, wood: 2, refinedWood: 0 },
      buildings: [mill(), { ...mill(), q: 2 }],
    }),
  );
  const next = out.cities[0];
  assert(next.storage.refinedWood === 1, `shared pile should yield 1, got ${next.storage.refinedWood}`);
  assert(next.storage.wood === 0, `shared pile should spend 2 wood, got ${next.storage.wood}`);
}

// HUD preview matches the conversion.
{
  const c = city();
  const preview = computeSawmillBuildingPreview(c, mill());
  assert(preview !== null, 'preview');
  assert(preview!.refinedPerCycle === 1, `preview refined ${preview!.refinedPerCycle}`);
  assert(preview!.rawWoodConsumedPerCycle === SAWMILL_WOOD_PER_REFINED, `preview wood ${preview!.rawWoodConsumedPerCycle}`);
}

console.log('verify-sawmill-morale: ok');
