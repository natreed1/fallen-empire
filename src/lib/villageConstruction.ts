import {
  type BuildingType,
  type City,
  type CityBuilding,
  type ConstructionSite,
  type Player,
  type Tile,
  BUILDING_COSTS,
  BUILDING_IRON_COSTS,
  tileKey,
} from '@/types/game';

/** Village hexes become the city center on incorporate — never a build site. */
export function hexIsVillageOrCityCenter(
  q: number,
  r: number,
  tiles: Map<string, Tile>,
  cities: City[],
): boolean {
  if (cities.some(c => c.q === q && c.r === r)) return true;
  return tiles.get(tileKey(q, r))?.hasVillage === true;
}

export function hexHasCityBuilding(q: number, r: number, cities: City[]): boolean {
  const k = tileKey(q, r);
  return cities.some(c => c.buildings.some(b => tileKey(b.q, b.r) === k));
}

/**
 * Clear in-flight sites and foreign buildings on a hex that is about to become a city center.
 * Refunds gold/iron for cancelled construction only.
 */
export function reclaimHexForNewCityCenter(args: {
  q: number;
  r: number;
  constructions: ConstructionSite[];
  cities: City[];
  players: Player[];
}): {
  constructions: ConstructionSite[];
  cities: City[];
  players: Player[];
  cancelledSites: ConstructionSite[];
  detachedBuildings: CityBuilding[];
} {
  const k = tileKey(args.q, args.r);
  const cancelledSites = args.constructions.filter(cs => tileKey(cs.q, cs.r) === k);
  const constructions = args.constructions.filter(cs => tileKey(cs.q, cs.r) !== k);

  const goldRefund = new Map<string, number>();
  const ironRefundByCity = new Map<string, number>();
  for (const site of cancelledSites) {
    const gold = BUILDING_COSTS[site.type as BuildingType];
    if (gold && gold > 0) {
      goldRefund.set(site.ownerId, (goldRefund.get(site.ownerId) ?? 0) + gold);
    }
    const iron = BUILDING_IRON_COSTS[site.type as BuildingType] ?? 0;
    if (iron > 0) {
      ironRefundByCity.set(site.cityId, (ironRefundByCity.get(site.cityId) ?? 0) + iron);
    }
  }

  const detachedBuildings: CityBuilding[] = [];
  const cities = args.cities.map(c => {
    const keep: CityBuilding[] = [];
    let detachedHere = false;
    for (const b of c.buildings) {
      if (b.type !== 'city_center' && tileKey(b.q, b.r) === k) {
        detachedBuildings.push(b);
        detachedHere = true;
        continue;
      }
      keep.push(b);
    }
    const ironAdd = ironRefundByCity.get(c.id) ?? 0;
    if (!detachedHere && ironAdd === 0) return c;
    return {
      ...c,
      buildings: keep,
      storage: ironAdd > 0
        ? { ...c.storage, iron: (c.storage.iron ?? 0) + ironAdd }
        : c.storage,
    };
  });

  const players = goldRefund.size === 0
    ? args.players
    : args.players.map(p => {
        const add = goldRefund.get(p.id);
        return add ? { ...p, gold: p.gold + add } : p;
      });

  return { constructions, cities, players, cancelledSites, detachedBuildings };
}
