/**
 * Village hex construction vs incorporate — city-center overlap guard.
 * Run with: npx tsx scripts/verify-village-construction.ts
 */
import {
  BUILDING_COSTS,
  BUILDING_IRON_COSTS,
  tileKey,
  type City,
  type ConstructionSite,
  type Player,
  type Tile,
} from '../src/types/game';
import {
  hexHasCityBuilding,
  hexIsVillageOrCityCenter,
  reclaimHexForNewCityCenter,
} from '../src/lib/villageConstruction';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function city(partial: Partial<City> & Pick<City, 'id' | 'q' | 'r'>): City {
  return {
    name: partial.name ?? partial.id,
    ownerId: partial.ownerId ?? 'human',
    population: 80,
    morale: 70,
    storage: { food: 20, goods: 0, guns: 0, gunsL2: 0, iron: 10, stone: 0, wood: 0, refinedWood: 0 },
    storageCap: { food: 100, goods: 50, guns: 50, gunsL2: 50, iron: 50, stone: 50, wood: 50, refinedWood: 50 },
    buildings: [],
    ...partial,
  };
}

function player(id: string, gold: number): Player {
  return {
    id,
    name: id,
    color: '#fff',
    gold,
    taxRate: 0.3,
    foodPriority: 'military',
    isHuman: id === 'human',
    kingdomId: 'crusaders',
  };
}

function forestVillage(q: number, r: number): Tile {
  return {
    q,
    r,
    biome: 'forest',
    elevation: 0.1,
    height: 0.3,
    hasVillage: true,
    hasRuins: false,
    hasRoad: false,
    hasQuarryDeposit: false,
    hasMineDeposit: false,
    hasWoodDeposit: false,
    hasGoldMineDeposit: false,
    hasAncientCity: false,
    isProvinceCenter: false,
    isIsland: false,
  };
}

const capital = city({ id: 'cap', q: 0, r: 0, ownerId: 'human' });
const tiles = new Map<string, Tile>([[tileKey(4, 1), forestVillage(4, 1)]]);

assert(hexIsVillageOrCityCenter(4, 1, tiles, [capital]), 'forest village is reserved');
assert(hexIsVillageOrCityCenter(0, 0, tiles, [capital]), 'existing city center is reserved');
assert(!hexIsVillageOrCityCenter(2, 2, tiles, [capital]), 'empty land is not reserved');

const site: ConstructionSite = {
  id: 'con1',
  type: 'logging_hut',
  q: 4,
  r: 1,
  cityId: 'cap',
  ownerId: 'human',
  bpRequired: 75,
  bpAccumulated: 40,
};

const goldMine: ConstructionSite = {
  id: 'con2',
  type: 'gold_mine',
  q: 4,
  r: 1,
  cityId: 'cap',
  ownerId: 'human',
  bpRequired: 90,
  bpAccumulated: 10,
};

const otherSite: ConstructionSite = {
  id: 'con3',
  type: 'farm',
  q: 1,
  r: 0,
  cityId: 'cap',
  ownerId: 'human',
  bpRequired: 75,
  bpAccumulated: 5,
};

const human = player('human', 50);
const reclaimed = reclaimHexForNewCityCenter({
  q: 4,
  r: 1,
  constructions: [site, otherSite],
  cities: [capital],
  players: [human],
});
assert(reclaimed.cancelledSites.length === 1 && reclaimed.cancelledSites[0]!.id === 'con1', 'cancels site on village hex');
assert(reclaimed.constructions.length === 1 && reclaimed.constructions[0]!.id === 'con3', 'keeps other sites');
assert(reclaimed.players[0]!.gold === 50 + BUILDING_COSTS.logging_hut, 'refunds logging hut gold');

const ironBefore = capital.storage.iron ?? 0;
const goldReclaim = reclaimHexForNewCityCenter({
  q: 4,
  r: 1,
  constructions: [goldMine],
  cities: [capital],
  players: [human],
});
assert(goldReclaim.cancelledSites.length === 1, 'cancels gold mine site');
assert(
  (goldReclaim.cities[0]!.storage.iron ?? 0) === ironBefore + (BUILDING_IRON_COSTS.gold_mine ?? 0),
  'refunds gold mine iron to site city',
);
assert(goldReclaim.players[0]!.gold === 50 + BUILDING_COSTS.gold_mine, 'refunds gold mine gold');

const capitalWithHut = city({
  id: 'cap',
  q: 0,
  r: 0,
  ownerId: 'human',
  buildings: [
    { type: 'city_center', q: 0, r: 0, assignedWorkers: 0 },
    { type: 'logging_hut', q: 4, r: 1, level: 1, assignedWorkers: 2 },
  ],
});
const detached = reclaimHexForNewCityCenter({
  q: 4,
  r: 1,
  constructions: [],
  cities: [capitalWithHut],
  players: [human],
});
assert(detached.detachedBuildings.length === 1 && detached.detachedBuildings[0]!.type === 'logging_hut', 'detaches completed hut');
assert(!hexHasCityBuilding(4, 1, detached.cities), 'village hex has no leftover building');
assert(detached.cities[0]!.buildings.some(b => b.type === 'city_center'), 'keeps capital city center');
assert(detached.players[0]!.gold === 50, 'does not refund already-completed buildings');

const newVillageCity = city({
  id: 'vil',
  q: 4,
  r: 1,
  ownerId: 'human',
  buildings: [{ type: 'city_center', q: 4, r: 1, assignedWorkers: 0 }],
});
const afterIncorporate = [...detached.cities, newVillageCity];
assert(hexHasCityBuilding(4, 1, afterIncorporate), 'new city center occupies village hex');
assert(
  !afterIncorporate.some(c => c.id === 'cap' && c.buildings.some(b => b.q === 4 && b.r === 1)),
  'capital no longer owns a building on the new city center',
);

console.log('verify-village-construction: ok');
