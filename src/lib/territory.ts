import {
  City, Tile, TerritoryInfo,
  TERRITORY_RADIUS, hexNeighbors, tileKey,
} from '@/types/game';

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

      if (dist < TERRITORY_RADIUS) {
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
