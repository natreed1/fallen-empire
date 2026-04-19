/**
 * Pure geography: strategic land connectivity (same walkable land component; water/mountain block).
 * Used by AI for naval/amphibious investment: enemies, neutral villages, or other land targets off-component.
 */

import { type Tile, hexNeighbors, tileKey, type Biome } from '@/types/game';

function walkableLand(biome: Biome): boolean {
  return biome !== 'water' && biome !== 'mountain';
}

/**
 * All land hex keys reachable from (startQ, startR) by strategic land movement
 * (plains/forest/desert/mountain excluded per walkableLand — same rules as connectivity checks).
 */
export function strategicLandReachableKeys(
  tiles: Map<string, Tile>,
  startQ: number,
  startR: number,
  maxVisited: number = 8000,
): Set<string> {
  const startKey = tileKey(startQ, startR);
  const startT = tiles.get(startKey);
  const empty = new Set<string>();
  if (!startT || !walkableLand(startT.biome)) return empty;

  const visited = new Set<string>([startKey]);
  const q: string[] = [startKey];
  let qi = 0;
  while (qi < q.length && visited.size <= maxVisited) {
    const curKey = q[qi++]!;
    const [cq, cr] = curKey.split(',').map(Number);
    for (const [nq, nr] of hexNeighbors(cq, cr)) {
      const nk = tileKey(nq, nr);
      if (visited.has(nk)) continue;
      const t = tiles.get(nk);
      if (!t || !walkableLand(t.biome)) continue;
      visited.add(nk);
      q.push(nk);
    }
  }
  return visited;
}

/** BFS over passable land hexes (plains/forest/desert); ignores units and walls. */
export function landHexesConnectedStrategic(
  tiles: Map<string, Tile>,
  startQ: number,
  startR: number,
  goalQ: number,
  goalR: number,
  maxVisited: number = 8000,
): boolean {
  const goalKey = tileKey(goalQ, goalR);
  const goalT = tiles.get(goalKey);
  if (!goalT || !walkableLand(goalT.biome)) return false;
  return strategicLandReachableKeys(tiles, startQ, startR, maxVisited).has(goalKey);
}
