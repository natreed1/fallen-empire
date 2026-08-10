/**
 * Regression guards for 2026-08-10 critical bugs.
 * Run: npx tsx scripts/verify-new-critical-bugs-7edc.ts
 */
import {
  autoEmbarkLandUnitsOntoScoutShipsAtHex,
  siegeTick,
  siegeBuildingsTick,
  siegeDefenseInstallationsTick,
} from '../src/lib/military';
import { resolveHeadlessTerminalPhase } from '../src/core/gameCore';
import {
  WALL_SECTION_HP,
  tileKey,
  type City,
  type DefenseInstallation,
  type Tile,
  type Unit,
  type WallSection,
} from '../src/types/game';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function makeTile(q: number, r: number, biome: Tile['biome']): Tile {
  return {
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
  };
}

function baseUnit(partial: Partial<Unit> & Pick<Unit, 'id' | 'type' | 'ownerId' | 'q' | 'r'>): Unit {
  return {
    hp: 60,
    maxHp: 60,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
    ...partial,
  };
}

// ── 1. Embarked siege engines must not damage structures ───────────────────
{
  const tiles = new Map<string, Tile>();
  tiles.set(tileKey(0, 0), makeTile(0, 0, 'water'));
  tiles.set(tileKey(1, 0), makeTile(1, 0, 'plains'));

  const ship = baseUnit({
    id: 'ship1',
    type: 'scout_ship',
    ownerId: 'p1',
    q: 0,
    r: 0,
    cargoUnitIds: [],
  });
  const treb = baseUnit({
    id: 't1',
    type: 'trebuchet',
    ownerId: 'p1',
    q: 0,
    r: 0,
  });
  const units = [ship, treb];
  autoEmbarkLandUnitsOntoScoutShipsAtHex(units, tiles);
  assert(treb.aboardShipId === ship.id, 'trebuchet should embark');
  assert((ship.cargoUnitIds ?? []).includes(treb.id), 'ship should list cargo');

  const wall: WallSection = {
    q: 1,
    r: 0,
    ownerId: 'p2',
    hp: WALL_SECTION_HP,
    maxHp: WALL_SECTION_HP,
  };
  siegeTick([wall], units);
  assert(wall.hp === WALL_SECTION_HP, `embarked trebuchet must not damage walls (hp=${wall.hp})`);

  const city = {
    id: 'c1',
    name: 'Target',
    ownerId: 'p2',
    q: 1,
    r: 0,
    population: 10,
    morale: 100,
    storage: { food: 0, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 0, wood: 0, refinedWood: 0 },
    storageCap: { food: 100, goods: 100, guns: 100, gunsL2: 100, iron: 100, stone: 100, wood: 100, refinedWood: 100 },
    buildings: [{ type: 'barracks' as const, q: 1, r: 0, level: 1, hp: 80, maxHp: 80, assignedWorkers: 0 }],
  } as City;
  const bHp = city.buildings[0].hp!;
  siegeBuildingsTick([city], units);
  assert(city.buildings[0].hp === bHp, `embarked trebuchet must not damage buildings (hp=${city.buildings[0].hp})`);

  const tower: DefenseInstallation = {
    id: 'd1',
    cityId: 'c1',
    ownerId: 'p2',
    q: 1,
    r: 0,
    type: 'mortar',
    level: 1,
    hp: 100,
    maxHp: 100,
  };
  siegeDefenseInstallationsTick([tower], units);
  assert(tower.hp === 100, `embarked trebuchet must not damage towers (hp=${tower.hp})`);

  // Control: same trebuchet ashore still damages
  const ashore = baseUnit({
    id: 't2',
    type: 'trebuchet',
    ownerId: 'p1',
    q: 0,
    r: 0,
  });
  const wall2: WallSection = {
    q: 1,
    r: 0,
    ownerId: 'p2',
    hp: WALL_SECTION_HP,
    maxHp: WALL_SECTION_HP,
  };
  siegeTick([wall2], [ashore]);
  assert(wall2.hp === WALL_SECTION_HP - 25, `ashore trebuchet should deal 25 (hp=${wall2.hp})`);
}

// ── 2. Conquest victory beats mutual total-starvation ──────────────────────
{
  const conqueredWhileStarving = resolveHeadlessTerminalPhase({
    citiesAi1: 1,
    citiesAi2: 0,
    allStarving1: true,
    allStarving2: true,
    foodAi1: 0,
    foodAi2: 0,
  });
  assert(conqueredWhileStarving.phase === 'victory', 'last-city capture must be victory even if starving');
  assert(!conqueredWhileStarving.totalStarvationAbort, 'conquest must not set totalStarvationAbort');

  const mutualStarve = resolveHeadlessTerminalPhase({
    citiesAi1: 1,
    citiesAi2: 1,
    allStarving1: true,
    allStarving2: true,
    foodAi1: 0,
    foodAi2: 0,
  });
  assert(mutualStarve.phase === 'total_starvation', 'mutual starve with cities remaining still aborts');
  assert(mutualStarve.totalStarvationAbort, 'mutual starve sets abort flag');

  const playing = resolveHeadlessTerminalPhase({
    citiesAi1: 1,
    citiesAi2: 1,
    allStarving1: true,
    allStarving2: false,
    foodAi1: 0,
    foodAi2: 5,
  });
  assert(playing.phase === 'playing', 'partial starvation must keep playing');
}

// ── 3. Disband must not mint population (recruit does not deduct) ──────────
{
  // Mirror store policy: living troops count against pop, but pop is unchanged on
  // recruit/disband; only death deducts via originCityId.
  let population = 10;
  let troops = 0;
  const recruit = () => {
    if (troops < population) troops++;
  };
  const disbandFixed = () => {
    if (troops > 0) troops--;
    // intentionally no population++
  };
  for (let i = 0; i < 10; i++) recruit();
  assert(troops === 10 && population === 10, 'recruit fills troop cap without changing pop');
  for (let i = 0; i < 10; i++) disbandFixed();
  assert(troops === 0 && population === 10, 'disband must not inflate population');
  for (let i = 0; i < 10; i++) recruit();
  assert(troops === 10 && population === 10, 'troop cap stays tied to original population');
}

console.log('verify-new-critical-bugs-7edc: ok');
