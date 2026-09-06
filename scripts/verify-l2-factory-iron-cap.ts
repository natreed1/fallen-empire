/**
 * L2 factory iron must not be consumed when gunsL2 storage cannot accept a full batch.
 * Run: npx tsx scripts/verify-l2-factory-iron-cap.ts
 */
import {
  processEconomyTurn,
  computeEmpireIncomeStatement,
  l2FactoryCitiesThatCanStoreArms,
} from '../src/lib/gameLoop';
import {
  CITY_CENTER_STORAGE,
  FACTORY_L2_ARMS_PER_CYCLE,
  FACTORY_L2_IRON_PER_CYCLE,
  type City,
  type Player,
} from '../src/types/game';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function makeCity(partial: Partial<City> & Pick<City, 'id' | 'storage'>): City {
  const { storage, storageCap, ...rest } = partial;
  return {
    name: partial.name ?? partial.id,
    q: 0,
    r: 0,
    ownerId: 'player_human',
    population: 20,
    morale: 80,
    buildings: [{ type: 'factory', q: 1, r: 0, level: 2, assignedWorkers: 2 }],
    ...rest,
    storage: { ...storage },
    storageCap: { ...CITY_CENTER_STORAGE, ...(storageCap ?? {}) },
  };
}

function makePlayer(): Player {
  return {
    id: 'player_human',
    name: 'Human',
    color: '#fff',
    gold: 100,
    taxRate: 0.3,
    foodPriority: 'military',
    isHuman: true,
  };
}

const emptyTiles = new Map();
const emptyTerritory = new Map();

function runTurn(cities: City[]) {
  return processEconomyTurn(cities, [], [makePlayer()], emptyTiles, emptyTerritory, 1);
}

// 1. Full cap: iron must stay put, no false "+ L2 arms" toast
{
  const city = makeCity({
    id: 'cap-full',
    storage: {
      food: 800, goods: 0, guns: 0, gunsL2: CITY_CENTER_STORAGE.gunsL2, iron: 10,
      stone: 0, wood: 0, refinedWood: 0,
    },
  });
  const result = runTurn([city]);
  const after = result.cities[0]!;
  assert(after.storage.gunsL2 === CITY_CENTER_STORAGE.gunsL2, 'full cap: gunsL2 unchanged');
  assert(after.storage.iron === 10, `full cap: iron must not drain, got ${after.storage.iron}`);
  assert(
    !result.notifications.some(n => /L2 arms/.test(n.message)),
    `full cap: must not toast production, got ${result.notifications.map(n => n.message).join(' | ')}`,
  );
}

// 2. Empty arms store: convert 1 iron → full batch
{
  const city = makeCity({
    id: 'empty-arms',
    storage: {
      food: 800, goods: 0, guns: 0, gunsL2: 0, iron: 10,
      stone: 0, wood: 0, refinedWood: 0,
    },
  });
  const result = runTurn([city]);
  const after = result.cities[0]!;
  assert(after.storage.gunsL2 === FACTORY_L2_ARMS_PER_CYCLE, `empty: expected +${FACTORY_L2_ARMS_PER_CYCLE} arms, got ${after.storage.gunsL2}`);
  assert(after.storage.iron === 10 - FACTORY_L2_IRON_PER_CYCLE, `empty: expected iron 9, got ${after.storage.iron}`);
  assert(
    result.notifications.some(n => n.message.includes(`+${FACTORY_L2_ARMS_PER_CYCLE} L2 arms`)),
    'empty: should toast real production',
  );
}

// 3. Two L2 cities, one full: only the city with room consumes iron
{
  const full = makeCity({
    id: 'full',
    q: 0,
    r: 0,
    storage: {
      food: 800, goods: 0, guns: 0, gunsL2: CITY_CENTER_STORAGE.gunsL2, iron: 0,
      stone: 0, wood: 0, refinedWood: 0,
    },
  });
  const empty = makeCity({
    id: 'room',
    q: 2,
    r: 0,
    storage: {
      food: 800, goods: 0, guns: 0, gunsL2: 0, iron: 5,
      stone: 0, wood: 0, refinedWood: 0,
    },
  });
  const result = runTurn([full, empty]);
  const afterFull = result.cities.find(c => c.id === 'full')!;
  const afterRoom = result.cities.find(c => c.id === 'room')!;
  assert(afterFull.storage.gunsL2 === CITY_CENTER_STORAGE.gunsL2, 'mixed: full city stays full');
  assert(afterRoom.storage.gunsL2 === FACTORY_L2_ARMS_PER_CYCLE, `mixed: room city gets batch, got ${afterRoom.storage.gunsL2}`);
  const totalIron = afterFull.storage.iron + afterRoom.storage.iron;
  assert(totalIron === 4, `mixed: only 1 iron for the city with room, got ${totalIron}`);
}

// 4. Partial headroom below one batch: do not spend iron
{
  const city = makeCity({
    id: 'partial',
    storage: {
      food: 800, goods: 0, guns: 0,
      gunsL2: CITY_CENTER_STORAGE.gunsL2 - (FACTORY_L2_ARMS_PER_CYCLE - 1),
      iron: 8, stone: 0, wood: 0, refinedWood: 0,
    },
  });
  const result = runTurn([city]);
  const after = result.cities[0]!;
  assert(after.storage.iron === 8, `partial headroom: iron must stay, got ${after.storage.iron}`);
  assert(
    after.storage.gunsL2 === CITY_CENTER_STORAGE.gunsL2 - (FACTORY_L2_ARMS_PER_CYCLE - 1),
    'partial headroom: gunsL2 unchanged',
  );
}

// 5. HUD / income statement agrees: no iron expense at cap
{
  const city = makeCity({
    id: 'hud',
    storage: {
      food: 800, goods: 0, guns: 0, gunsL2: CITY_CENTER_STORAGE.gunsL2, iron: 10,
      stone: 0, wood: 0, refinedWood: 0,
    },
  });
  assert(l2FactoryCitiesThatCanStoreArms([city]).length === 0, 'helper: full cap excluded');
  const stmt = computeEmpireIncomeStatement([city], [], emptyTiles, emptyTerritory, [], 'player_human');
  assert(stmt.iron.expense === 0, `income statement expense at cap must be 0, got ${stmt.iron.expense}`);
}

console.log('verify-l2-factory-iron-cap: ok');
