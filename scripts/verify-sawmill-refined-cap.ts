/**
 * Sawmills must not burn raw wood when refined-wood storage cannot accept output.
 * Run: npx tsx scripts/verify-sawmill-refined-cap.ts
 */
import {
  processEconomyTurn,
  computeCityProductionRate,
  computeSawmillBuildingPreview,
  sawmillRefinedStorageHeadroom,
} from '../src/lib/gameLoop';
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

function mill(over: Partial<CityBuilding> = {}): CityBuilding {
  return { type: 'sawmill', q: 1, r: 0, level: 1, assignedWorkers: 2, ...over };
}

function hut(q: number, r: number): CityBuilding {
  return { type: 'logging_hut', q, r, level: 1, assignedWorkers: 2 };
}

function city(over: Partial<City> = {}): City {
  return {
    id: 'c1',
    name: 'Milltown',
    q: 0,
    r: 0,
    ownerId: 'player_human',
    population: 20,
    morale: 100,
    storage: {
      food: 500,
      goods: 0,
      guns: 0,
      gunsL2: 0,
      iron: 0,
      stone: 0,
      wood: 40,
      refinedWood: 50,
    },
    storageCap: { ...CITY_CENTER_STORAGE },
    buildings: [mill(), hut(2, 0), hut(3, 0)],
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

// 1) Two logging huts + sawmill, both bins at cap: wood must not drain.
{
  const start = city({
    storage: { ...city().storage, wood: 50, refinedWood: 50 },
  });
  assert(sawmillRefinedStorageHeadroom(start) === 0, 'headroom at cap is 0');
  const out = tick(start);
  const next = out.cities[0];
  assert(next.storage.refinedWood === 50, `refined stayed 50, got ${next.storage.refinedWood}`);
  assert(next.storage.wood === 50, `wood must stay at cap, got ${next.storage.wood}`);
  const lied = out.notifications.some(n => /refined wood/.test(n.message));
  assert(!lied, `toast must not claim refined wood at cap: ${out.notifications.map(n => n.message).join(' | ')}`);
}

// 2) Stockpiled wood + full refined: conversion idles, logging still adds wood.
{
  const start = city({
    storage: { ...city().storage, wood: 40, refinedWood: 50 },
  });
  const out = tick(start);
  const next = out.cities[0];
  assert(next.storage.refinedWood === 50, 'refined stays capped');
  assert(next.storage.wood === 44, `logging +4, no mill burn; got wood=${next.storage.wood}`);
}

// 3) Empty refined bin still converts.
{
  const start = city({
    storage: { ...city().storage, wood: 10, refinedWood: 0 },
    buildings: [mill()],
  });
  const out = tick(start);
  const next = out.cities[0];
  assert(next.storage.refinedWood === 1, `expected +1 refined, got ${next.storage.refinedWood}`);
  assert(next.storage.wood === 10 - SAWMILL_WOOD_PER_REFINED, `wood ${next.storage.wood}`);
}

// 4) One slot of headroom: convert once, then stop.
{
  const start = city({
    storage: { ...city().storage, wood: 10, refinedWood: 49 },
    buildings: [mill()],
  });
  const out = tick(start);
  const next = out.cities[0];
  assert(next.storage.refinedWood === 50, `fill last slot, got ${next.storage.refinedWood}`);
  assert(next.storage.wood === 8, `one batch of wood, got ${next.storage.wood}`);
}

// 5) HUD / income preview idle at cap.
{
  const full = city({
    storage: { ...city().storage, wood: 40, refinedWood: 50 },
    buildings: [mill()],
  });
  const preview = computeSawmillBuildingPreview(full, mill());
  assert(preview !== null, 'preview');
  assert(preview!.refinedPerCycle === 0, `preview refined ${preview!.refinedPerCycle}`);
  assert(preview!.rawWoodConsumedPerCycle === 0, `preview wood ${preview!.rawWoodConsumedPerCycle}`);
  const rate = computeCityProductionRate(full, new Map(), new Map(), 1);
  assert(rate.refinedWood === 0, `rate refined ${rate.refinedWood}`);
}

console.log('verify-sawmill-refined-cap: ok');
