/**
 * Logistics correctness: empire food routing, cutoff HP loss, sequential road BP.
 * Run: npx ts-node -r tsconfig-paths/register --project tsconfig.train.json scripts/verify-logistics-critical.ts
 */
import { processEconomyTurn } from '../src/lib/gameLoop';
import { upkeepTick } from '../src/lib/military';
import {
  deductPooledStorage,
  unitReceivesPassiveHpRegen,
  isUnitInSupplyVicinityOfPlayerCities,
} from '../src/lib/empireEconomy';
import { computeRoadAvailableBp } from '../src/lib/builders';
import {
  STARVATION_DEATHS,
  UNIT_HP_REGEN_FRACTION_PER_CYCLE,
  SUPPLY_VICINITY_RADIUS,
  BUILDER_POWER,
  type City,
  type Player,
  type Unit,
  type Tile,
  type TerritoryInfo,
} from '../src/types/game';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function city(partial: Partial<City> & Pick<City, 'id' | 'name' | 'q' | 'r' | 'ownerId'>): City {
  return {
    population: 150,
    morale: 80,
    storage: { food: 80, goods: 0, guns: 10, gunsL2: 0, iron: 0, stone: 0, wood: 0, refinedWood: 0 },
    storageCap: { food: 1000, goods: 100, guns: 100, gunsL2: 100, iron: 50, stone: 50, wood: 50, refinedWood: 50 },
    buildings: [],
    ...partial,
  };
}

function player(id: string, isHuman = true): Player {
  return { id, name: id, color: '#fff', gold: 100, taxRate: 0.3, foodPriority: 'military', isHuman };
}

function unit(partial: Partial<Unit> & Pick<Unit, 'id' | 'type' | 'q' | 'r' | 'ownerId'>): Unit {
  return {
    hp: 50,
    maxHp: 50,
    xp: 0,
    level: 1,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
    ...partial,
  };
}

// ── 1. Proportional empire deduct does not empty the first city ──
{
  const a = city({ id: 'a', name: 'Capital', q: 0, r: 0, ownerId: 'p1', storage: { food: 50, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 0, wood: 0, refinedWood: 0 } });
  const b = city({ id: 'b', name: 'Second', q: 8, r: 0, ownerId: 'p1', storage: { food: 200, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 0, wood: 0, refinedWood: 0 } });
  deductPooledStorage([a, b], 'food', 80);
  assert(a.storage.food > 0, `capital should keep a share after 80 demand (got ${a.storage.food})`);
  assert(b.storage.food > 0, `second city should keep leftover (got ${b.storage.food})`);
  assert(a.storage.food + b.storage.food === 170, `exact deduct 80 from 250 (left ${a.storage.food + b.storage.food})`);
}

// ── 2. Two-city civilian consumption must not starve the capital while empire has grain ──
{
  const capital = city({
    id: 'cap',
    name: 'Capital',
    q: 0,
    r: 0,
    ownerId: 'p1',
    population: 150,
    storage: { food: 40, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 0, wood: 0, refinedWood: 0 },
  });
  const second = city({
    id: 'sec',
    name: 'Second',
    q: 6,
    r: 0,
    ownerId: 'p1',
    population: 150,
    storage: { food: 200, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 0, wood: 0, refinedWood: 0 },
  });
  const tiles = new Map<string, Tile>();
  const territory = new Map<string, TerritoryInfo>();
  const beforeCap = capital.population;
  const result = processEconomyTurn(
    [capital, second],
    [],
    [player('p1')],
    tiles,
    territory,
    1,
    1,
  );
  const afterCap = result.cities.find(c => c.id === 'cap')!;
  const starveNotifs = result.notifications.filter(n => n.message.includes('starvation'));
  assert(
    starveNotifs.length === 0,
    `capital must not take starvation deaths while empire has grain (notifs=${starveNotifs.map(n => n.message).join('; ')})`,
  );
  assert(
    afterCap.population >= beforeCap - 1,
    `capital pop should only take natural deaths at most (before=${beforeCap} after=${afterCap.population}, starvation would be -${1 + STARVATION_DEATHS})`,
  );
}

// ── 3. Cut-off units do not receive regen (so 5% upkeep HP loss sticks) ──
{
  const home = city({ id: 'c1', name: 'Home', q: 0, r: 0, ownerId: 'p1' });
  const far = unit({
    id: 'u1',
    type: 'ranged',
    q: SUPPLY_VICINITY_RADIUS + 5,
    r: 0,
    ownerId: 'p1',
    hp: 50,
    maxHp: 50,
    status: 'idle',
  });
  assert(!isUnitInSupplyVicinityOfPlayerCities(far, [home]), 'fixture must be out of supply');
  assert(!unitReceivesPassiveHpRegen(far, [home]), 'cut-off unit must not regen');
  const regenWouldAdd = Math.max(1, Math.floor(far.maxHp * UNIT_HP_REGEN_FRACTION_PER_CYCLE));
  const starveLoss = Math.floor(far.maxHp * 0.05);
  assert(regenWouldAdd === starveLoss, `ranged 50 HP: regen ${regenWouldAdd} must equal starve ${starveLoss} (the cancelled-out case)`);

  const clone = { ...far };
  upkeepTick([clone], [home], [], 1, new Map(), new Map());
  assert(clone.status === 'starving', 'cut-off unit marked starving');
  assert(clone.hp === 50 - starveLoss, `cut-off HP should drop by 5% (got ${clone.hp})`);
}

// ── 4. In-supply damaged units still regen ──
{
  const home = city({ id: 'c1', name: 'Home', q: 0, r: 0, ownerId: 'p1' });
  const near = unit({
    id: 'u2',
    type: 'ranged',
    q: 2,
    r: 0,
    ownerId: 'p1',
    hp: 40,
    maxHp: 50,
    status: 'idle',
  });
  assert(unitReceivesPassiveHpRegen(near, [home]), 'in-supply damaged unit should regen');
}

// ── 5. Road BP serializes to the first queued hex in the territory ──
{
  const academyCity = city({
    id: 'c1',
    name: 'Home',
    q: 0,
    r: 0,
    ownerId: 'p1',
    buildings: [{ type: 'academy', q: 0, r: 0, level: 1 }],
  });
  const territory = new Map<string, TerritoryInfo>([
    ['1,0', { cityId: 'c1', playerId: 'p1' }],
    ['2,0', { cityId: 'c1', playerId: 'p1' }],
  ]);
  const sites = [
    { id: 'r1', q: 1, r: 0, ownerId: 'p1' },
    { id: 'r2', q: 2, r: 0, ownerId: 'p1' },
  ];
  const first = computeRoadAvailableBp(sites[0], territory, [academyCity], sites);
  const second = computeRoadAvailableBp(sites[1], territory, [academyCity], sites);
  assert(first === BUILDER_POWER, `first road hex gets university BP (got ${first})`);
  assert(second === 0, `later road hex waits (got ${second})`);
}

console.log('verify-logistics-critical: ok');
