import {
  City, Tile, TerritoryInfo,
  TERRITORY_RADIUS, hexNeighbors, tileKey, parseTileKey, hexDistance,
  MOVE_ORDER_TERRITORY_BAND_HEXES, MOVE_ORDER_MAX_IN_TERRITORY_BAND, MOVE_ORDER_MAX_OUTSIDE_BAND,
} from '@/types/game';

/** Minimum hex distance from (q,r) to any tile owned by `playerId` in `territory`. */
export function minHexDistanceToPlayerTerritory(
  q: number,
  r: number,
  territory: Map<string, TerritoryInfo>,
  playerId: string,
): number {
  let minD = Infinity;
  for (const [key, info] of territory.entries()) {
    if (info.playerId !== playerId) continue;
    const [tq, tr] = parseTileKey(key);
    const d = hexDistance(q, r, tq, tr);
    if (d < minD) minD = d;
  }
  return minD;
}

/** One-step move / tactical order distance cap from human rules (near territory = longer leg). */
export function maxMoveOrderDistanceForDestination(
  toQ: number,
  toR: number,
  territory: Map<string, TerritoryInfo>,
  playerId: string,
): number {
  const dTerr = minHexDistanceToPlayerTerritory(toQ, toR, territory, playerId);
  return dTerr <= MOVE_ORDER_TERRITORY_BAND_HEXES ? MOVE_ORDER_MAX_IN_TERRITORY_BAND : MOVE_ORDER_MAX_OUTSIDE_BAND;
}

export function isWithinPlayerMoveOrderRange(
  fromQ: number,
  fromR: number,
  toQ: number,
  toR: number,
  territory: Map<string, TerritoryInfo>,
  playerId: string,
): boolean {
  const dist = hexDistance(fromQ, fromR, toQ, toR);
  if (dist <= 0) return false;
  return dist <= maxMoveOrderDistanceForDestination(toQ, toR, territory, playerId);
}

export function calculateTerritory(
  cities: City[],
  tiles: Map<string, Tile>,
): Map<string, TerritoryInfo> {
  const territory = new Map<string, TerritoryInfo>();

  for (const city of cities) {
    const queue: [number, number, number][] = [[city.q, city.r, 0]];
    const visited = new Set<string>();
    visited.add(tileKey(city.q, city.r));

    while (queue.length > 0) {
      const [q, r, dist] = queue.shift()!;
      const key = tileKey(q, r);
      const tile = tiles.get(key);
      if (!tile || tile.biome === 'water') continue;

      if (!territory.has(key)) {
        territory.set(key, { playerId: city.ownerId, cityId: city.id });
      }

      const maxDist = city.territoryRadius ?? TERRITORY_RADIUS;
      if (dist < maxDist) {
        for (const [nq, nr] of hexNeighbors(q, r)) {
          const nKey = tileKey(nq, nr);
          if (!visited.has(nKey)) {
            visited.add(nKey);
            queue.push([nq, nr, dist + 1]);
          }
        }
      }
    }
  }

  return territory;
}

export function getCityTerritory(
  cityId: string,
  territory: Map<string, TerritoryInfo>,
): string[] {
  const keys: string[] = [];
  for (const [key, info] of territory) {
    if (info.cityId === cityId) keys.push(key);
  }
  return keys;
}

export function getPlayerTerritory(
  playerId: string,
  territory: Map<string, TerritoryInfo>,
): string[] {
  const keys: string[] = [];
  for (const [key, info] of territory) {
    if (info.playerId === playerId) keys.push(key);
  }
  return keys;
}

/** City to spend refined wood from for a field build: territory hex's city first, else nearest stocked city. */
export function findCityForRefinedWoodSpend(
  q: number,
  r: number,
  playerId: string,
  amount: number,
  cities: City[],
  territory: Map<string, TerritoryInfo>,
): City | null {
  if (amount <= 0) return null;
  const key = tileKey(q, r);
  const terr = territory.get(key);
  if (terr?.playerId === playerId) {
    const c = cities.find(x => x.id === terr.cityId);
    if (c && (c.storage.refinedWood ?? 0) >= amount) return c;
  }
  let best: City | null = null;
  let bestD = Infinity;
  for (const c of cities) {
    if (c.ownerId !== playerId) continue;
    if ((c.storage.refinedWood ?? 0) < amount) continue;
    const d = hexDistance(q, r, c.q, c.r);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}
