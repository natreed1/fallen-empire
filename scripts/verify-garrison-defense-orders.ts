/**
 * Regression: city-defense / patrol ticks must not drag co-located stagnant
 * garrison off the city center (capture only contests that hex).
 * Run: npx tsx --tsconfig tsconfig.train.json scripts/verify-garrison-defense-orders.ts
 */
import { movementTick, landMilitaryContestsCityCapture } from '../src/lib/military';
import { calculateTerritory } from '../src/lib/territory';
import {
  getHexRing,
  tileKey,
  type City,
  type Hero,
  type Tile,
  type Unit,
} from '../src/types/game';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function plains(q: number, r: number): Tile {
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

function makeTiles(radius: number): Map<string, Tile> {
  const tiles = new Map<string, Tile>();
  tiles.set(tileKey(0, 0), plains(0, 0));
  for (let ring = 1; ring <= radius; ring++) {
    for (const h of getHexRing(0, 0, ring)) {
      tiles.set(tileKey(h.q, h.r), plains(h.q, h.r));
    }
  }
  return tiles;
}

function inf(partial: Partial<Unit> & Pick<Unit, 'id' | 'ownerId' | 'q' | 'r'>): Unit {
  return {
    type: 'infantry',
    hp: 100,
    maxHp: 100,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'defensive',
    nextMoveAt: 0,
    ...partial,
  };
}

const city: City = {
  id: 'city_home',
  name: 'Home',
  q: 0,
  r: 0,
  ownerId: 'player_human',
  population: 80,
  morale: 80,
  storage: { food: 50, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 0, wood: 0, refinedWood: 0 },
  storageCap: { food: 100, goods: 0, guns: 0, gunsL2: 0, iron: 0, stone: 0, wood: 0, refinedWood: 0 },
  buildings: [{ type: 'city_center', q: 0, r: 0, level: 1 }],
  territoryRadius: 3,
};

const tiles = makeTiles(4);
const territory = calculateTerritory([city], tiles);

function tick(units: Unit[], heroes: Hero[] = []) {
  movementTick(units, heroes, tiles, [], [city], 1000, [], undefined, 1, [], territory);
}

{
  const hold = inf({
    id: 'hold',
    ownerId: 'player_human',
    q: 0,
    r: 0,
    defendCityId: city.id,
    cityDefenseMode: 'stagnant',
    garrisonCityId: city.id,
  });
  const roam = inf({
    id: 'roam',
    ownerId: 'player_human',
    q: 0,
    r: 0,
    defendCityId: city.id,
    cityDefenseMode: 'auto_engage',
  });
  const enemy = inf({ id: 'enemy', ownerId: 'player_ai', q: 2, r: 0 });
  tick([hold, roam, enemy]);

  assert(hold.q === 0 && hold.r === 0, 'stagnant garrison stays on city center');
  assert(hold.status === 'idle', 'stagnant garrison stays idle');
  assert(hold.garrisonCityId === city.id, 'stagnant garrison flag kept');
  assert(hold.cityDefenseMode === 'stagnant', 'stagnant mode kept');
  assert(hold.targetQ === undefined, 'stagnant received no intercept order');
  assert(landMilitaryContestsCityCapture(hold, 0, 0), 'stagnant still contests capture');
  assert(roam.status === 'moving', 'auto_engage intercepts');
  assert(roam.targetQ !== undefined && roam.targetR !== undefined, 'auto_engage got a step');
  assert(!(roam.targetQ === 0 && roam.targetR === 0), 'auto_engage steps off center');
}

{
  const hold = inf({
    id: 'hold_p',
    ownerId: 'player_human',
    q: 0,
    r: 0,
    defendCityId: city.id,
    cityDefenseMode: 'stagnant',
    garrisonCityId: city.id,
  });
  const patrol = inf({
    id: 'patrol',
    ownerId: 'player_human',
    q: 0,
    r: 0,
    patrolCenterQ: 0,
    patrolCenterR: 0,
    patrolRadius: 4,
  });
  tick([hold, patrol]);

  assert(hold.q === 0 && hold.r === 0, 'stagnant not dragged by patrol wander');
  assert(hold.status === 'idle', 'stagnant idle during patrol wander');
  assert(hold.garrisonCityId === city.id, 'stagnant garrison kept during patrol wander');
  assert(patrol.status === 'moving', 'patrol still wanders');
  assert(patrol.targetQ !== undefined, 'patrol received a wander step');
}

{
  const idle = inf({ id: 'idle', ownerId: 'player_human', q: 0, r: 0 });
  const roam = inf({
    id: 'roam2',
    ownerId: 'player_human',
    q: 0,
    r: 0,
    defendCityId: city.id,
    cityDefenseMode: 'auto_engage',
  });
  const enemy = inf({ id: 'enemy2', ownerId: 'player_ai', q: 2, r: 0 });
  tick([idle, roam, enemy]);

  assert(idle.status === 'idle', 'unassigned idle stack is not pulled into auto_engage');
  assert(idle.targetQ === undefined, 'unassigned idle received no order');
  assert(roam.status === 'moving', 'auto_engage still intercepts when stacked with idle');
}

{
  const a = inf({
    id: 'auto_a',
    ownerId: 'player_human',
    q: 0,
    r: 0,
    defendCityId: city.id,
    cityDefenseMode: 'auto_engage',
  });
  const b = inf({
    id: 'auto_b',
    ownerId: 'player_human',
    q: 0,
    r: 0,
    defendCityId: city.id,
    cityDefenseMode: 'auto_engage',
  });
  const enemy = inf({ id: 'enemy3', ownerId: 'player_ai', q: 2, r: 0 });
  tick([a, b, enemy]);

  assert(a.status === 'moving' && b.status === 'moving', 'all auto_engage units on the hex intercept together');
}

{
  const hold = inf({
    id: 'hold_h',
    ownerId: 'player_human',
    q: 0,
    r: 0,
    defendCityId: city.id,
    cityDefenseMode: 'stagnant',
    garrisonCityId: city.id,
  });
  const roam = inf({
    id: 'roam_h',
    ownerId: 'player_human',
    q: 0,
    r: 0,
    defendCityId: city.id,
    cityDefenseMode: 'auto_engage',
  });
  const enemy = inf({ id: 'enemy_h', ownerId: 'player_ai', q: 2, r: 0 });
  const hero: Hero = { id: 'hero1', name: 'H', type: 'general', q: 0, r: 0, ownerId: 'player_human' };
  tick([hold, roam, enemy], [hero]);

  assert(hero.q === 0 && hero.r === 0, 'hero stays with stagnant garrison on the city hex');
}

console.log('verify-garrison-defense-orders: ok');
