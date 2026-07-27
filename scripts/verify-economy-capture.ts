/**
 * Regression guards for economy double-spend / worker clamp / instant capture rules.
 * Run: npx tsx --tsconfig tsconfig.json scripts/verify-economy-capture.ts
 */
import { processEconomyTurn } from '../src/lib/gameLoop';
import {
  landMilitaryContestsCityCapture,
  resolveInstantCityCaptureOwner,
} from '../src/lib/military';
import type { City, Player, Tile, TerritoryInfo, Unit, WallSection } from '../src/types/game';
import { CITY_CENTER_STORAGE, SAWMILL_WOOD_PER_REFINED } from '../src/types/game';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function baseCity(overrides: Partial<City> & Pick<City, 'id' | 'ownerId'>): City {
  return {
    name: overrides.id,
    q: 0,
    r: 0,
    population: 20,
    morale: 100,
    storage: { food: 50, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 0, wood: 0, refinedWood: 0 },
    storageCap: { ...CITY_CENTER_STORAGE },
    buildings: [{ type: 'city_center', q: 0, r: 0, assignedWorkers: 0 }],
    ...overrides,
  };
}

function basePlayer(id: string, isHuman = false): Player {
  return {
    id,
    name: id,
    color: '#fff',
    gold: 100,
    taxRate: 0.3,
    foodPriority: 'military',
    isHuman,
  };
}

function baseUnit(overrides: Partial<Unit> & Pick<Unit, 'id' | 'ownerId' | 'type'>): Unit {
  return {
    q: 0,
    r: 0,
    hp: 10,
    maxHp: 10,
    level: 1,
    xp: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
    ...overrides,
  };
}

// ── Sawmill: multiple mills must not double-consume the same raw wood ──
{
  const city = baseCity({
    id: 'c1',
    ownerId: 'p1',
    storage: { food: 50, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 0, wood: 2, refinedWood: 0 },
    buildings: [
      { type: 'city_center', q: 0, r: 0, assignedWorkers: 0 },
      { type: 'sawmill', q: 1, r: 0, level: 1, assignedWorkers: 2 },
      { type: 'sawmill', q: 2, r: 0, level: 1, assignedWorkers: 2 },
    ],
  });
  const players = [basePlayer('p1', true)];
  const tiles = new Map<string, Tile>();
  const territory = new Map<string, TerritoryInfo>();
  const result = processEconomyTurn([city], [], players, tiles, territory, 1, 1);
  const out = result.cities[0];
  // 2 wood → at most 1 refined (SAWMILL_WOOD_PER_REFINED === 2); wood spent exactly.
  assert(SAWMILL_WOOD_PER_REFINED === 2, 'expected wood-per-refined constant');
  assert(out.storage.refinedWood === 1, `sawmill free wood exploit: got refined=${out.storage.refinedWood}`);
  assert(out.storage.wood === 0, `sawmill wood remaining unexpected: ${out.storage.wood}`);
}

// ── Workers: assignedWorkers must clamp down after population loss ──
{
  const city = baseCity({
    id: 'c2',
    ownerId: 'p1',
    population: 2,
    storage: { food: 50, goods: 0, guns: 0, gunsL2: 0, iron: 10, stone: 0, wood: 0, refinedWood: 0 },
    buildings: [
      { type: 'city_center', q: 0, r: 0, assignedWorkers: 0 },
      { type: 'mine', q: 1, r: 0, level: 1, assignedWorkers: 10 },
    ],
  });
  const players = [basePlayer('p1', true)];
  const result = processEconomyTurn([city], [], players, new Map(), new Map(), 1, 1);
  const mine = result.cities[0].buildings.find(b => b.type === 'mine') as { assignedWorkers?: number };
  const assigned = mine.assignedWorkers ?? 0;
  assert(assigned <= result.cities[0].population, `workers exceed pop: assigned=${assigned} pop=${result.cities[0].population}`);
}

// ── L2 arms: remainder must not be silently discarded ──
{
  const mkFactoryCity = (id: string, iron: number): City =>
    baseCity({
      id,
      ownerId: 'p1',
      q: 0,
      r: 0,
      storage: { food: 50, goods: 0, guns: 0, gunsL2: 0, iron, stone: 0, wood: 0, refinedWood: 0 },
      buildings: [
        { type: 'city_center', q: 0, r: 0, assignedWorkers: 0 },
        { type: 'factory', q: 1, r: 0, level: 2, assignedWorkers: 2 },
      ],
    });
  // 7 L2 factories, only 1 iron → 6 arms produced; must all land in storage (not floor-away).
  const cities = Array.from({ length: 7 }, (_, i) => mkFactoryCity(`f${i}`, i === 0 ? 1 : 0));
  const result = processEconomyTurn(cities, [], [basePlayer('p1', true)], new Map(), new Map(), 1, 1);
  const totalL2 = result.cities.reduce((s, c) => s + (c.storage.gunsL2 ?? 0), 0);
  assert(totalL2 === 6, `L2 arms truncated: got ${totalL2}, expected 6`);
  const totalIron = result.cities.reduce((s, c) => s + (c.storage.iron ?? 0), 0);
  assert(totalIron === 0, `iron not deducted: ${totalIron}`);
}

// ── Instant capture: builder alone cannot capture; walls block; multi-hostile contested ──
{
  const city = baseCity({ id: 'enemy', ownerId: 'ai', q: 5, r: 5, population: 20 });
  const walls: WallSection[] = [
    { q: 5, r: 5, ownerId: 'ai', hp: 10, maxHp: 10 },
  ];

  const builderOnly = [
    baseUnit({ id: 'b1', ownerId: 'human', type: 'builder', q: 5, r: 5 }),
  ];
  assert(!landMilitaryContestsCityCapture(builderOnly[0], 5, 5), 'builder must not contest capture');
  assert(
    resolveInstantCityCaptureOwner(city, builderOnly, []) === null,
    'builder-only instant capture must fail',
  );

  const infantry = [
    baseUnit({ id: 'i1', ownerId: 'human', type: 'infantry', q: 5, r: 5 }),
  ];
  assert(
    resolveInstantCityCaptureOwner(city, infantry, walls) === null,
    'intact walls must block instant capture',
  );
  assert(
    resolveInstantCityCaptureOwner(city, infantry, []) === 'human',
    'undefended unwalled city must instant-capture',
  );

  const contested = [
    baseUnit({ id: 'i1', ownerId: 'human', type: 'infantry', q: 5, r: 5 }),
    baseUnit({ id: 'i2', ownerId: 'ai2', type: 'infantry', q: 5, r: 5 }),
  ];
  assert(
    resolveInstantCityCaptureOwner({ ...city, population: 0 }, contested, []) === null,
    'multi-hostile contested city must not award by array order',
  );
}

console.log('verify-economy-capture: all checks passed');
