import {
  Tile, City, Unit, Hero, ScoutTower, Commander,
  VISION_RANGE, CITY_VISION_RANGE, BUILDING_VISION_RANGE, SCOUT_TOWER_VISION_RANGE,
  TERRITORY_BORDER_VISION_RANGE,
  hexDistance, tileKey, parseTileKey,
  type MapQuadrantId,
  type MapQuadrantsRevealed,
  type TerritoryInfo,
} from '@/types/game';

interface VisionSource {
  q: number;
  r: number;
  range: number;
}

function tileBounds(tiles: Map<string, Tile>): { midQ: number; midR: number } {
  let minQ = Infinity;
  let maxQ = -Infinity;
  let minR = Infinity;
  let maxR = -Infinity;
  for (const t of tiles.values()) {
    minQ = Math.min(minQ, t.q);
    maxQ = Math.max(maxQ, t.q);
    minR = Math.min(minR, t.r);
    maxR = Math.max(maxR, t.r);
  }
  return { midQ: (minQ + maxQ) / 2, midR: (minR + maxR) / 2 };
}

function quadrantForTile(q: number, r: number, midQ: number, midR: number): MapQuadrantId {
  const west = q <= midQ;
  const north = r <= midR;
  if (north && west) return 'nw';
  if (north && !west) return 'ne';
  if (!north && west) return 'sw';
  return 'se';
}

/** Add all hexes in revealed quadrants (trade menu “map pieces”) for full enemy-unit intel there. */
export function mergeMapQuadrantVision(
  base: Set<string>,
  tiles: Map<string, Tile>,
  revealed: MapQuadrantsRevealed | undefined | null,
): Set<string> {
  if (!revealed || (!revealed.nw && !revealed.ne && !revealed.sw && !revealed.se)) {
    return base;
  }
  const { midQ, midR } = tileBounds(tiles);
  const out = new Set(base);
  for (const [k, t] of tiles) {
    const qid = quadrantForTile(t.q, t.r, midQ, midR);
    if (revealed[qid]) out.add(k);
  }
  return out;
}

function addVisionFromOwnedTerritory(
  territory: Map<string, TerritoryInfo>,
  playerId: string,
  tiles: Map<string, Tile>,
  extraRange: number,
  into: Set<string>,
) {
  for (const [key, info] of territory) {
    if (info.playerId !== playerId) continue;
    const [q, r] = parseTileKey(key);
    addHexesInRange(q, r, extraRange, tiles, into);
  }
}

/**
 * Current line-of-sight for the player: units, buildings, cities, heroes, towers,
 * plus {@link TERRITORY_BORDER_VISION_RANGE} beyond every owned territory hex,
 * plus optional trade-menu map quadrants (enemy intel + terrain reveal for those tiles).
 */
export function computeVisibleHexes(
  playerId: string,
  cities: City[],
  units: Unit[],
  heroes: Hero[],
  tiles: Map<string, Tile>,
  scoutTowers: ScoutTower[] = [],
  commanders: Commander[] = [],
  mapQuadrantReveal?: MapQuadrantsRevealed | null,
  territory?: Map<string, TerritoryInfo> | null,
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

  for (const c of commanders) {
    if (c.ownerId === playerId) {
      sources.push({ q: c.q, r: c.r, range: VISION_RANGE });
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

  // Scout towers grant SCOUT_TOWER_VISION_RANGE
  for (const t of scoutTowers) {
    if (t.ownerId === playerId) {
      sources.push({ q: t.q, r: t.r, range: SCOUT_TOWER_VISION_RANGE });
    }
  }

  // Compute all hexes within range of any source
  const visible = new Set<string>();
  for (const src of sources) {
    addHexesInRange(src.q, src.r, src.range, tiles, visible);
  }

  if (territory?.size) {
    addVisionFromOwnedTerritory(territory, playerId, tiles, TERRITORY_BORDER_VISION_RANGE, visible);
  }

  return mergeMapQuadrantVision(visible, tiles, mapQuadrantReveal);
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
