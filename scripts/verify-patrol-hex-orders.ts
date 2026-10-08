/**
 * Patrol / city-defense auto-move must not drag co-located stacks that lack the order.
 * Run: npx tsx scripts/verify-patrol-hex-orders.ts
 */
import { movementTick } from '../src/lib/military';
import { tileKey, type City, type TerritoryInfo, type Tile, type Unit } from '../src/types/game';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function land(q: number, r: number): Tile {
  return {
    q,
    r,
    biome: 'plains',
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

function unit(partial: Partial<Unit> & Pick<Unit, 'id' | 'ownerId'>): Unit {
  return {
    type: 'infantry',
    q: 0,
    r: 0,
    hp: 10,
    maxHp: 10,
    xp: 0,
    level: 1,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
    ...partial,
  };
}

const city: City = {
  id: 'c1',
  name: 'Capital',
  q: 0,
  r: 0,
  ownerId: 'human',
  population: 20,
  morale: 80,
  storage: { food: 10, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 0, wood: 0, refinedWood: 0 },
  storageCap: { food: 100, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 0, wood: 0, refinedWood: 0 },
  buildings: [],
};

function tilesAround(): Map<string, Tile> {
  const tiles = new Map<string, Tile>();
  for (let q = -2; q <= 2; q++) {
    for (let r = -2; r <= 2; r++) {
      const t = land(q, r);
      tiles.set(tileKey(q, r), t);
    }
  }
  return tiles;
}

function territoryAround(): Map<string, TerritoryInfo> {
  const territory = new Map<string, TerritoryInfo>();
  for (let q = -2; q <= 2; q++) {
    for (let r = -2; r <= 2; r++) {
      territory.set(tileKey(q, r), { playerId: 'human', cityId: 'c1' });
    }
  }
  return territory;
}

const tiles = tilesAround();
const territory = territoryAround();

// Patrol on the capital hex must not pull the garrison off or delete its orders,
// and must not strip a co-located auto-engage stack.
{
  const units = [
    unit({
      id: 'garrison',
      garrisonCityId: 'c1',
      defendCityId: 'c1',
      cityDefenseMode: 'stagnant',
    }),
    unit({
      id: 'defense',
      defendCityId: 'c1',
      cityDefenseMode: 'auto_engage',
    }),
    unit({
      id: 'patrol',
      patrolCenterQ: 0,
      patrolCenterR: 0,
      patrolRadius: 3,
    }),
    unit({ id: 'enemy', ownerId: 'ai', q: 2, r: 0 }),
  ];
  movementTick(units, [], tiles, [], [city], 0, [], undefined, 1, [], territory);
  const garrison = units.find(u => u.id === 'garrison')!;
  const defense = units.find(u => u.id === 'defense')!;
  const patrol = units.find(u => u.id === 'patrol')!;
  assert(patrol.status === 'moving', 'patrol unit steps toward the enemy');
  assert(garrison.status === 'idle', 'garrison stays idle');
  assert(garrison.garrisonCityId === 'c1', 'garrison flag kept');
  assert(garrison.defendCityId === 'c1', 'garrison defend order kept');
  assert(defense.status === 'idle', 'auto-engage stack is not hijacked by patrol');
  assert(defense.defendCityId === 'c1' && defense.cityDefenseMode === 'auto_engage', 'auto-engage order kept');
}

// Auto-engage chases; a resting garrison on the same hex does not.
{
  const units = [
    unit({
      id: 'garrison',
      garrisonCityId: 'c1',
      defendCityId: 'c1',
      cityDefenseMode: 'stagnant',
    }),
    unit({
      id: 'defense',
      defendCityId: 'c1',
      cityDefenseMode: 'auto_engage',
    }),
    unit({ id: 'enemy', ownerId: 'ai', q: 2, r: 0 }),
  ];
  movementTick(units, [], tiles, [], [city], 0, [], undefined, 1, [], territory);
  const garrison = units.find(u => u.id === 'garrison')!;
  const defense = units.find(u => u.id === 'defense')!;
  assert(defense.status === 'moving', 'auto-engage unit intercepts');
  assert(garrison.status === 'idle' && garrison.garrisonCityId === 'c1', 'garrison not dragged by city defense');
}

console.log('verify-patrol-hex-orders: ok');
