/**
 * Regression guards for critical economy/combat bugs (run with npx tsx).
 */
import { applyAiInstantBuilds } from '../src/lib/applyAiPlan';
import { processEconomyTurn } from '../src/lib/gameLoop';
import { combatTick } from '../src/lib/military';
import type { City, Player, Tile, Unit } from '../src/types/game';
import { CITY_CENTER_STORAGE, getUnitStats, tileKey } from '../src/types/game';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function baseCity(overrides: Partial<City> & Pick<City, 'id' | 'ownerId'>): City {
  return {
    name: overrides.name ?? 'City',
    q: overrides.q ?? 0,
    r: overrides.r ?? 0,
    population: overrides.population ?? 20,
    morale: overrides.morale ?? 100,
    storage: {
      food: 50,
      goods: 0,
      guns: 0,
      gunsL2: 0,
      iron: 10,
      stone: 0,
      wood: 10,
      refinedWood: 0,
      ...(overrides.storage ?? {}),
    },
    storageCap: { ...CITY_CENTER_STORAGE },
    buildings: overrides.buildings ?? [{ type: 'city_center', q: 0, r: 0, assignedWorkers: 0 }],
    ...overrides,
  };
}

function basePlayer(id: string, isHuman = true): Player {
  return {
    id,
    name: id,
    color: '#fff',
    gold: 100,
    taxRate: 0,
    foodPriority: 'military',
    isHuman,
    kingdomId: 'crusaders',
  };
}

// ─── 1. AI mine/quarry must not subtract population ─────────────────
{
  const city = baseCity({
    id: 'c1',
    ownerId: 'ai',
    population: 12,
    buildings: [{ type: 'city_center', q: 0, r: 0, assignedWorkers: 0 }],
  });
  let gold = 200;
  applyAiInstantBuilds(
    [{ type: 'quarry', cityId: 'c1', q: 1, r: 0 }],
    {
      aiPlayerId: 'ai',
      cities: [city],
      getPlayer: () => ({ gold, researchedTechs: undefined }),
      onSpendGold: (d) => {
        gold -= d;
      },
    },
  );
  const quarry = city.buildings.find(b => b.type === 'quarry');
  assert(!!quarry, 'AI quarry built');
  assert(city.population === 12, `AI quarry must not reduce population (got ${city.population})`);
  assert(
    (quarry!.assignedWorkers ?? 0) === 2,
    `AI quarry workers should be job slots (2), got ${quarry!.assignedWorkers}`,
  );
}

// ─── 2. Ruined gold mine must not mint gold ─────────────────────────
{
  const city = baseCity({
    id: 'c1',
    ownerId: 'p1',
    population: 10,
    buildings: [
      { type: 'city_center', q: 0, r: 0, assignedWorkers: 0 },
      {
        type: 'gold_mine',
        q: 1,
        r: 0,
        level: 1,
        assignedWorkers: 2,
        buildingState: 'ruins',
        hp: 0,
        maxHp: 90,
      },
    ],
  });
  const player = basePlayer('p1');
  player.gold = 0;
  player.taxRate = 0;
  const before = player.gold;
  const result = processEconomyTurn([city], [], [player], new Map(), new Map(), 1);
  assert(result.players[0].gold === before, `ruined gold mine paid ${result.players[0].gold - before} gold`);
}

// ─── 3. Unstaffed / ruined L2 factory must not burn iron ────────────
{
  const city = baseCity({
    id: 'c1',
    ownerId: 'p1',
    population: 0, // prevent auto-assign from staffing the factory
    storage: { food: 50, goods: 0, guns: 0, gunsL2: 0, iron: 5, stone: 0, wood: 0, refinedWood: 0 },
    buildings: [
      { type: 'city_center', q: 0, r: 0, assignedWorkers: 0 },
      {
        type: 'factory',
        q: 1,
        r: 0,
        level: 2,
        assignedWorkers: 0,
      },
    ],
  });
  const player = basePlayer('p1');
  const result = processEconomyTurn([city], [], [player], new Map(), new Map(), 1);
  assert(result.cities[0].storage.iron === 5, `unstaffed L2 burned iron to ${result.cities[0].storage.iron}`);
  assert(result.cities[0].storage.gunsL2 === 0, `unstaffed L2 produced gunsL2=${result.cities[0].storage.gunsL2}`);
}
{
  const city = baseCity({
    id: 'c1',
    ownerId: 'p1',
    population: 10,
    storage: { food: 50, goods: 0, guns: 0, gunsL2: 0, iron: 5, stone: 0, wood: 0, refinedWood: 0 },
    buildings: [
      { type: 'city_center', q: 0, r: 0, assignedWorkers: 0 },
      {
        type: 'factory',
        q: 1,
        r: 0,
        level: 2,
        assignedWorkers: 2,
        buildingState: 'ruins',
        hp: 0,
        maxHp: 75,
      },
    ],
  });
  const player = basePlayer('p1');
  const result = processEconomyTurn([city], [], [player], new Map(), new Map(), 1);
  assert(result.cities[0].storage.iron === 5, `ruined L2 burned iron to ${result.cities[0].storage.iron}`);
  assert(result.cities[0].storage.gunsL2 === 0, `ruined L2 produced gunsL2=${result.cities[0].storage.gunsL2}`);
}

// ─── 4. Partial-staff sawmill must not burn wood for 0 refined ──────
{
  const city = baseCity({
    id: 'c1',
    ownerId: 'p1',
    population: 1, // auto-assign at most 1 worker → staffRatio 0.5
    storage: { food: 50, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 0, wood: 4, refinedWood: 0 },
    buildings: [
      { type: 'city_center', q: 0, r: 0, assignedWorkers: 0 },
      { type: 'sawmill', q: 1, r: 0, level: 1, assignedWorkers: 0 },
    ],
  });
  const player = basePlayer('p1');
  const result = processEconomyTurn([city], [], [player], new Map(), new Map(), 1);
  const wood = result.cities[0].storage.wood ?? 0;
  const refined = result.cities[0].storage.refinedWood ?? 0;
  assert(wood === 4, `half-staff sawmill burned wood (${wood} left, expected 4)`);
  assert(refined === 0, `half-staff sawmill should make 0 refined, got ${refined}`);
}

// ─── 5. Coastal Phase B must not burn attack on incompatible hex ───
{
  const mkUnit = (
    id: string,
    type: Unit['type'],
    q: number,
    r: number,
    ownerId: string,
    extras: Partial<Unit> = {},
  ): Unit => {
    const stats = getUnitStats({ type } as Unit);
    return {
      id,
      type,
      q,
      r,
      ownerId,
      hp: stats.maxHp,
      maxHp: stats.maxHp,
      xp: 0,
      level: 0,
      status: 'idle',
      stance: 'aggressive',
      nextMoveAt: 0,
      ...extras,
    };
  };

  // Insertion order makes water hex visited before the land foe hex.
  const units: Unit[] = [
    mkUnit('archer', 'ranged', 0, 0, 'p1'),
    mkUnit('ship', 'warship', 1, 0, 'p2'),
    mkUnit('inf', 'infantry', 0, 1, 'p2'),
  ];
  const mkTile = (q: number, r: number, biome: Tile['biome']): Tile => ({
    q,
    r,
    biome,
    elevation: 0,
    height: 0,
    hasRoad: false,
    hasRuins: false,
    hasVillage: false,
    isProvinceCenter: false,
    hasQuarryDeposit: false,
    hasMineDeposit: false,
    hasAncientCity: false,
    hasGoldMineDeposit: false,
    hasWoodDeposit: false,
    isIsland: false,
  });
  const tiles = new Map<string, Tile>([
    [tileKey(0, 0), mkTile(0, 0, 'plains')],
    [tileKey(1, 0), mkTile(1, 0, 'water')],
    [tileKey(0, 1), mkTile(0, 1, 'plains')],
  ]);
  const infHpBefore = units[2].hp;
  combatTick(units, [], 1, [], tiles, 1_000_000);
  assert(units[2].hp < infHpBefore, `archer should damage land infantry after skipping ship (hp ${units[2].hp})`);
  assert(units[1].hp === getUnitStats(units[1]).maxHp, 'warship should not take land ranged damage');
}

console.log('verify-critical-economy-combat: ok');
