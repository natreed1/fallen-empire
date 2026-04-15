import {
  Tile,
  KingdomId,
  hexNeighbors,
  hexDistance,
  hexTouchesBiome,
  tileKey,
  TERRITORY_RADIUS,
  TerritoryInfo,
  City,
  CityBuilding,
  getBuildingJobs,
  getHexRing,
  isValidFarmPlacementBiome,
} from '@/types/game';
import { getCityTerritory } from '@/lib/territory';

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = t;
  }
}

/** L1 farm on a free hex near the capital (prefers plains, then desert, then other valid farm biomes). Skips if a farm or banana farm exists. */
export function appendStartingFarmToCity(city: City, tiles: Map<string, Tile>, seed: number): void {
  if (city.buildings.some(b => b.type === 'farm' || b.type === 'banana_farm')) return;
  const rng = mulberry32(seed ^ 0xf4a11);
  const occupied = new Set(city.buildings.map(b => tileKey(b.q, b.r)));
  const candidates: { q: number; r: number }[] = [];
  for (const ring of [1, 2] as const) {
    for (const { q, r } of getHexRing(city.q, city.r, ring)) {
      candidates.push({ q, r });
    }
  }
  const valid = candidates.filter(({ q, r }) => {
    const k = tileKey(q, r);
    if (occupied.has(k)) return false;
    const t = tiles.get(k);
    return !!t && isBuildableLand(t) && isValidFarmPlacementBiome(t.biome);
  });
  const plains = valid.filter(({ q, r }) => tiles.get(tileKey(q, r))?.biome === 'plains');
  const desert = valid.filter(({ q, r }) => tiles.get(tileKey(q, r))?.biome === 'desert');
  const rest = valid.filter(({ q, r }) => {
    const b = tiles.get(tileKey(q, r))?.biome;
    return b !== 'plains' && b !== 'desert';
  });
  const order = [...plains, ...desert, ...rest];
  shuffleInPlace(order, rng);
  const pick = order[0];
  if (!pick) return;
  city.buildings.push({
    type: 'farm',
    q: pick.q,
    r: pick.r,
    level: 1,
    assignedWorkers: 2,
  });
}

/** L1 barracks on a free land hex near the capital (ring 1, else ring 2). Idempotent if barracks already present. */
export function appendStartingBarracksToCity(city: City, tiles: Map<string, Tile>, seed: number): void {
  if (city.buildings.some(b => b.type === 'barracks')) return;
  const rng = mulberry32(seed ^ 0x8a11a435);
  const occupied = new Set(city.buildings.map(b => tileKey(b.q, b.r)));
  const candidates: { q: number; r: number }[] = [];
  for (const ring of [1, 2] as const) {
    for (const { q, r } of getHexRing(city.q, city.r, ring)) {
      candidates.push({ q, r });
    }
  }
  shuffleInPlace(candidates, rng);
  for (const { q, r } of candidates) {
    const k = tileKey(q, r);
    if (occupied.has(k)) continue;
    const t = tiles.get(k);
    if (!isBuildableLand(t)) continue;
    city.buildings.push({
      type: 'barracks',
      q,
      r,
      level: 1,
      assignedWorkers: 0,
    });
    return;
  }
}

/** L1 academy (University) on a free land hex near the capital (ring 1, else ring 2). Idempotent. */
export function appendStartingAcademyToCity(city: City, tiles: Map<string, Tile>, seed: number): void {
  if (city.buildings.some(b => b.type === 'academy')) return;
  const rng = mulberry32(seed ^ 0x55e11a9d);
  const occupied = new Set(city.buildings.map(b => tileKey(b.q, b.r)));
  const candidates: { q: number; r: number }[] = [];
  for (const ring of [1, 2] as const) {
    for (const { q, r } of getHexRing(city.q, city.r, ring)) {
      candidates.push({ q, r });
    }
  }
  shuffleInPlace(candidates, rng);
  for (const { q, r } of candidates) {
    const k = tileKey(q, r);
    if (occupied.has(k)) continue;
    const t = tiles.get(k);
    if (!isBuildableLand(t)) continue;
    city.buildings.push({
      type: 'academy',
      q,
      r,
      level: 1,
      assignedWorkers: 0,
    });
    return;
  }
}

function isBuildableLand(t: Tile | undefined): boolean {
  return !!t && t.biome !== 'water' && t.biome !== 'mountain';
}

/** Human/AI capitals and scored start — not on scroll regions, province hubs, ruins, or ancient cities. Villages are cleared when a capital is placed. */
export function isCapitalStartHex(t: Tile | undefined): boolean {
  if (!isBuildableLand(t)) return false;
  if (t!.specialTerrainKind) return false;
  if (t!.isProvinceCenter) return false;
  if (t!.hasAncientCity) return false;
  if (t!.hasRuins) return false;
  return true;
}

/** Remove village marker from a hex when placing a capital (city replaces the settlement). */
export function clearVillageForCapitalTile(tiles: Map<string, Tile>, q: number, r: number): void {
  const k = tileKey(q, r);
  const t = tiles.get(k);
  if (t?.hasVillage) tiles.set(k, { ...t, hasVillage: false });
}

/** Land hexes within `radius` steps of (q,r) that are buildable (for territory estimate). */
function landHexesInRadius(
  tiles: Map<string, Tile>,
  q: number,
  r: number,
  radius: number,
): { q: number; r: number }[] {
  const out: { q: number; r: number }[] = [];
  const seen = new Set<string>();
  const queue: [number, number, number][] = [[q, r, 0]];
  seen.add(tileKey(q, r));
  while (queue.length > 0) {
    const [cq, cr, d] = queue.shift()!;
    const t = tiles.get(tileKey(cq, cr));
    if (isBuildableLand(t)) out.push({ q: cq, r: cr });
    if (d >= radius) continue;
    for (const [nq, nr] of hexNeighbors(cq, cr)) {
      const nk = tileKey(nq, nr);
      if (seen.has(nk)) continue;
      seen.add(nk);
      queue.push([nq, nr, d + 1]);
    }
  }
  return out;
}

function countDepositsWithin(
  tiles: Map<string, Tile>,
  q: number,
  r: number,
  maxDist: number,
): { mines: number; goldMines: number } {
  let mines = 0;
  let goldMines = 0;
  tiles.forEach((t) => {
    if (!isBuildableLand(t)) return;
    const d = hexDistance(q, r, t.q, t.r);
    if (d > maxDist || d === 0) return;
    if (t.hasMineDeposit) mines += 1;
    if (t.hasGoldMineDeposit) goldMines += 1;
  });
  return { mines, goldMines };
}

function countBiomesInRing(
  tiles: Map<string, Tile>,
  q: number,
  r: number,
  maxDist: number,
): { plains: number; forest: number; desert: number } {
  let plains = 0;
  let forest = 0;
  let desert = 0;
  tiles.forEach((t) => {
    if (!isBuildableLand(t)) return;
    const d = hexDistance(q, r, t.q, t.r);
    if (d > maxDist) return;
    if (t.biome === 'plains') plains += 1;
    else if (t.biome === 'forest') forest += 1;
    else if (t.biome === 'desert') desert += 1;
  });
  return { plains, forest, desert };
}

function minDistToWater(tiles: Map<string, Tile>, q: number, r: number): number {
  let minD = Infinity;
  tiles.forEach((t) => {
    if (t.biome !== 'water') return;
    const d = hexDistance(q, r, t.q, t.r);
    if (d < minD) minD = d;
  });
  return minD === Infinity ? 999 : minD;
}

function waterNeighborCount(tiles: Map<string, Tile>, q: number, r: number): number {
  let n = 0;
  for (const [nq, nr] of hexNeighbors(q, r)) {
    if (tiles.get(tileKey(nq, nr))?.biome === 'water') n += 1;
  }
  return n;
}

function hasAdjacentMineDeposit(tiles: Map<string, Tile>, q: number, r: number): boolean {
  for (const [nq, nr] of hexNeighbors(q, r)) {
    const t = tiles.get(tileKey(nq, nr));
    if (t?.hasMineDeposit && isBuildableLand(t)) return true;
  }
  return false;
}

/**
 * Fishers need: island, coastal capital, enough land in "territory" for city + port + shipyard + fishery + banana farm.
 */
function canFishersStartHere(tiles: Map<string, Tile>, q: number, r: number): boolean {
  const t = tiles.get(tileKey(q, r));
  if (!isBuildableLand(t) || !t!.isIsland) return false;
  if (!hexTouchesBiome(tiles, q, r, 'water')) return false;
  const land = landHexesInRadius(tiles, q, r, TERRITORY_RADIUS);
  if (land.length < 6) return false;
  return true;
}

export interface MapConfigLike {
  width: number;
  height: number;
  seed: number;
}

/**
 * Pick a strong starting hex for the kingdom. Returns null if no valid candidate (e.g. Fishers on map with no islands).
 */
export function findBestStartHex(
  kingdom: KingdomId,
  tiles: Map<string, Tile>,
  config: MapConfigLike,
): { q: number; r: number } | null {
  const rng = mulberry32(config.seed ^ 0x4b696e67 ^ kingdom.charCodeAt(0) * 1315423911);
  const candidates: { q: number; r: number; score: number }[] = [];

  tiles.forEach((tile) => {
    const { q, r } = tile;
    if (!isCapitalStartHex(tile)) return;

    let score = 0;

    if (kingdom === 'mongols') {
      const { mines, goldMines } = countDepositsWithin(tiles, q, r, 5);
      if (tile.biome === 'desert') score += 40;
      if (tile.biome === 'mountain') score += 25;
      if (tile.biome === 'plains' || tile.biome === 'forest') score -= 5;
      score -= mines * 12;
      score -= goldMines * 8;
    } else if (kingdom === 'fishers') {
      if (!canFishersStartHere(tiles, q, r)) return;
      score = 100 + waterNeighborCount(tiles, q, r) * 5;
    } else if (kingdom === 'crusaders') {
      const { plains, forest, desert } = countBiomesInRing(tiles, q, r, 3);
      score = plains * 3 + forest * 3 - desert * 4;
      if (hasAdjacentMineDeposit(tiles, q, r)) score += 80;
    } else if (kingdom === 'traders') {
      const md = minDistToWater(tiles, q, r);
      score = 200 - md * 25 + waterNeighborCount(tiles, q, r) * 15;
    }

    candidates.push({ q, r, score });
  });

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  const bestScore = candidates[0]!.score;
  const nearTop = candidates.filter(c => c.score >= bestScore - 14);
  const pool =
    nearTop.length >= 4
      ? nearTop
      : candidates.slice(0, Math.min(24, Math.max(4, Math.ceil(candidates.length * 0.12))));
  const pick = pool[Math.floor(rng() * pool.length)]!;
  if (kingdom === 'fishers' && pick.score < 50) return null;
  return { q: pick.q, r: pick.r };
}

/**
 * Pick a random valid starting hex for the kingdom.
 * Uses map seed + current time so each new run can start in a different area.
 */
export function findRandomStartHex(
  kingdom: KingdomId,
  tiles: Map<string, Tile>,
  config: MapConfigLike,
): { q: number; r: number } | null {
  const seedMix = (Date.now() ^ config.seed ^ kingdom.length * 2654435761) >>> 0;
  const rng = mulberry32(seedMix);
  const candidates: { q: number; r: number }[] = [];

  tiles.forEach((tile) => {
    const { q, r } = tile;
    if (!isCapitalStartHex(tile)) return;
    if (kingdom === 'fishers' && !canFishersStartHere(tiles, q, r)) return;
    candidates.push({ q, r });
  });

  if (candidates.length === 0) return null;
  const pick = candidates[Math.floor(rng() * candidates.length)]!;
  return { q: pick.q, r: pick.r };
}

/**
 * Random capital hex for the kingdom; if strict rules (e.g. Fishers island) leave no candidates,
 * falls back to any {@link isCapitalStartHex} tile so the match can still start.
 */
export function findRandomStartHexWithFallback(
  kingdom: KingdomId,
  tiles: Map<string, Tile>,
  config: MapConfigLike,
): { q: number; r: number } | null {
  const primary = findRandomStartHex(kingdom, tiles, config);
  if (primary) return primary;
  const loose: { q: number; r: number }[] = [];
  tiles.forEach(tile => {
    if (!isCapitalStartHex(tile)) return;
    loose.push({ q: tile.q, r: tile.r });
  });
  if (loose.length === 0) return null;
  const seedMix = (Date.now() ^ config.seed ^ 0xf11bac) >>> 0;
  const rng = mulberry32(seedMix);
  return loose[Math.floor(rng() * loose.length)]!;
}

/** Land tiles in this city's territory (from map), excluding city center, suitable for placing a building. */
function territoryLandKeys(
  city: City,
  territory: Map<string, TerritoryInfo>,
  tiles: Map<string, Tile>,
): string[] {
  const keys = getCityTerritory(city.id, territory);
  const center = tileKey(city.q, city.r);
  return keys.filter((k) => {
    if (k === center) return false;
    const [q, r] = k.split(',').map(Number);
    const t = tiles.get(k);
    return isBuildableLand(t) && hexTouchesBiome(tiles, q, r, 'water');
  });
}

function territoryLandKeysInland(
  city: City,
  territory: Map<string, TerritoryInfo>,
  tiles: Map<string, Tile>,
): string[] {
  const keys = getCityTerritory(city.id, territory);
  const center = tileKey(city.q, city.r);
  return keys.filter((k) => {
    if (k === center) return false;
    const t = tiles.get(k);
    return isBuildableLand(t);
  });
}

/**
 * Pick hexes for Fishers' pre-placed coastal buildings + banana farm. Returns null if layout impossible.
 */
export function findFishersStartingBuildings(
  city: City,
  territory: Map<string, TerritoryInfo>,
  tiles: Map<string, Tile>,
): { port: CityBuilding; shipyard: CityBuilding; fishery: CityBuilding; banana_farm: CityBuilding } | null {
  const coastal = territoryLandKeys(city, territory, tiles);
  const inland = territoryLandKeysInland(city, territory, tiles).filter((k) => !coastal.includes(k));
  if (coastal.length < 3) return null;
  const used = new Set<string>();
  const pick = (keys: string[]) => {
    for (const k of keys) {
      if (used.has(k)) continue;
      used.add(k);
      const [q, r] = k.split(',').map(Number);
      return { q, r };
    }
    return null;
  };
  const p1 = pick(coastal);
  const p2 = pick(coastal);
  const p3 = pick(coastal);
  const p4 = pick(inland.length > 0 ? inland : coastal);
  if (!p1 || !p2 || !p3 || !p4) return null;
  let employed = 1;
  const assignWorkers = (type: CityBuilding['type'], q: number, r: number): CityBuilding => {
    const b: CityBuilding = { type, q, r, level: 1 };
    const jobs = getBuildingJobs(b);
    const available = city.population - employed;
    const aw = Math.min(jobs, Math.max(0, available));
    employed += aw;
    b.assignedWorkers = aw;
    return b;
  };
  return {
    port: assignWorkers('port', p1.q, p1.r),
    shipyard: assignWorkers('shipyard', p2.q, p2.r),
    fishery: assignWorkers('fishery', p3.q, p3.r),
    banana_farm: assignWorkers('banana_farm', p4.q, p4.r),
  };
}
