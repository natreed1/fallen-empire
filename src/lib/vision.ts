import {
  Tile, City, Unit, Hero,
  VISION_RANGE, CITY_VISION_RANGE, BUILDING_VISION_RANGE, SCOUT_VISION_RANGE,
  hexDistance, tileKey,
} from '@/types/game';

interface VisionSource {
  q: number;
  r: number;
  range: number;
}

/**
 * Compute the set of hex keys currently visible to the given player.
 * Vision sources: units, cities, buildings, heroes.
 */
export function computeVisibleHexes(
  playerId: string,
  cities: City[],
  units: Unit[],
  heroes: Hero[],
  tiles: Map<string, Tile>,
): Set<string> {
  const sources: VisionSource[] = [];

  // Units grant VISION_RANGE
  for (const u of units) {
    if (u.ownerId === playerId && u.hp > 0) {
      sources.push({ q: u.q, r: u.r, range: VISION_RANGE });
    }
  }

  // Heroes also grant VISION_RANGE
  for (const h of heroes) {
    if (h.ownerId === playerId) {
      sources.push({ q: h.q, r: h.r, range: VISION_RANGE });
    }
  }

  // Cities grant CITY_VISION_RANGE
  for (const c of cities) {
    if (c.ownerId === playerId) {
      sources.push({ q: c.q, r: c.r, range: CITY_VISION_RANGE });

      // Each building grants vision
      for (const b of c.buildings) {
        sources.push({ q: b.q, r: b.r, range: BUILDING_VISION_RANGE });
      }
    }
  }

  // Compute all hexes within range of any source
  const visible = new Set<string>();
  for (const src of sources) {
    addHexesInRange(src.q, src.r, src.range, tiles, visible);
  }

  return visible;
}

function addHexesInRange(
  cq: number, cr: number, range: number,
  tiles: Map<string, Tile>,
  result: Set<string>,
) {
  // Iterate all hexes in the bounding box and check distance
  for (let dq = -range; dq <= range; dq++) {
    for (let dr = -range; dr <= range; dr++) {
      if (hexDistance(0, 0, dq, dr) > range) continue;
      const key = tileKey(cq + dq, cr + dr);
      if (tiles.has(key)) {
        result.add(key);
      }
    }
  }
}
