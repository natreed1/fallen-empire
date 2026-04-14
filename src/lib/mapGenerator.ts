import { createNoise2D } from 'simplex-noise';
import {
  Tile,
  Biome,
  MapConfig,
  BIOME_HEIGHTS,
  hexNeighbors,
  hexDistance,
  tileKey,
  createSpecialRegionMetadata,
  SPECIAL_REGION_BLOB_SIZE_MAX,
  SPECIAL_REGION_BLOB_SIZE_MIN,
  SPECIAL_REGION_KINDS_MAX,
  SPECIAL_REGION_KINDS_MIN,
  SPECIAL_TERRAIN_CAPITAL_EXCLUSION_RADIUS,
  type SpecialRegion,
  type SpecialRegionKind,
  type ScrollRelicSite,
} from '@/types/game';

/** Connected component of `specialTerrainKind` containing the relic (search must cover this patch). */
export function floodFillSpecialTerrainCluster(
  tileMap: Map<string, Tile>,
  startQ: number,
  startR: number,
  kind: SpecialRegionKind,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const stack: { q: number; r: number }[] = [{ q: startQ, r: startR }];
  while (stack.length > 0) {
    const { q, r } = stack.pop()!;
    const k = tileKey(q, r);
    if (seen.has(k)) continue;
    const t = tileMap.get(k);
    if (!t || t.specialTerrainKind !== kind) continue;
    seen.add(k);
    out.push(k);
    for (const [nq, nr] of hexNeighbors(q, r)) {
      stack.push({ q: nq, r: nr });
    }
  }
  return out;
}

export type ScrollRelicClusters = Record<SpecialRegionKind, string[]>;

export function computeScrollRelicClusters(
  tileMap: Map<string, Tile>,
  scrollRelics: ScrollRelicSite[],
): ScrollRelicClusters {
  const empty: ScrollRelicClusters = {
    mexca: [],
    hills_lost: [],
    forest_secrets: [],
    isle_lost: [],
  };
  for (const site of scrollRelics) {
    empty[site.regionKind] = floodFillSpecialTerrainCluster(tileMap, site.q, site.r, site.regionKind);
  }
  return empty;
}

// ─── Seeded PRNG (Mulberry32) ──────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Main Generator ────────────────────────────────────────────────

export interface GeneratorResult {
  tiles: Tile[];
  provinceCenters: Tile[];
  specialRegions: SpecialRegion[];
  /** One relic hex per special terrain flavor present (seeded). */
  scrollRelics: ScrollRelicSite[];
  /** Per region, hex keys in the connected special-terrain patch that contains the relic. */
  scrollRelicClusters: ScrollRelicClusters;
}

export function generateMap(config: MapConfig): GeneratorResult {
  const rng = mulberry32(config.seed);

  const elevationNoise = createNoise2D(rng);
  const moistureNoise = createNoise2D(rng);
  const detailNoise = createNoise2D(rng);

  // ── Pass 1: Generate biomes ────────────────────────────────────
  const tileMap = new Map<string, Tile>();
  const allTiles: Tile[] = [];

  for (let r = 0; r < config.height; r++) {
    for (let q = 0; q < config.width; q++) {
      const elevation = sampleElevation(q, r, config, elevationNoise, detailNoise);
      const moisture = sampleMoisture(q, r, config, moistureNoise);
      const biome = classifyBiome(elevation, moisture, config);
      const height = computeHeight(biome, elevation);

      const tile: Tile = {
        q,
        r,
        biome,
        elevation,
        height,
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

      tileMap.set(tileKey(q, r), tile);
      allTiles.push(tile);
    }
  }

  sprinkleOceanIslands(allTiles, tileMap, config, rng);
  labelIslandLandmasses(allTiles, tileMap, config);

  // ── Pass 2: Named wilds — one connected patch per flavor (2–4 flavors); no capital avoids yet ──
  placeSingleBlobSpecialRegions(allTiles, tileMap, rng, {
    avoidCenters: [],
    avoidRadius: SPECIAL_TERRAIN_CAPITAL_EXCLUSION_RADIUS,
    excludeInfrastructure: false,
  });
  const specialRegions = createSpecialRegionMetadata();
  const scrollRelics = placeScrollRelics(allTiles, rng);
  const scrollRelicClusters = computeScrollRelicClusters(tileMap, scrollRelics);

  // ── Pass 3: Empire overlay — province centers avoid scroll terrain ───
  const landTiles = allTiles.filter((t) => t.biome !== 'water' && !t.specialTerrainKind);
  const provinceCenters = selectProvinceCenters(landTiles, config, rng);

  for (const center of provinceCenters) {
    center.isProvinceCenter = true;
  }

  generateRoads(provinceCenters, tileMap, config);
  scatterRuins(allTiles, tileMap, config, rng);

  // ── Pass 4: Villages (not inside scroll regions) ───────────────────────
  spawnVillages(allTiles, config, rng);

  // ── Pass 5: Quarry & Mine deposits (biome-based) ───────────────────────
  scatterResourceDeposits(allTiles, rng);

  return { tiles: allTiles, provinceCenters, specialRegions, scrollRelics, scrollRelicClusters };
}

function waterTouchesIslandLand(t: Tile, tileMap: Map<string, Tile>): boolean {
  return hexNeighbors(t.q, t.r).some(([nq, nr]) => {
    const n = tileMap.get(tileKey(nq, nr));
    return n != null && n.biome !== 'water' && n.isIsland;
  });
}

const ALL_SPECIAL_REGION_KINDS: SpecialRegionKind[] = ['mexca', 'hills_lost', 'forest_secrets', 'isle_lost'];

function clearAllSpecialTerrain(allTiles: Tile[]): void {
  for (const t of allTiles) t.specialTerrainKind = undefined;
}

function hexOutsideCapitalExclusion(
  q: number,
  r: number,
  avoidCenters: { q: number; r: number }[],
  radius: number,
): boolean {
  if (avoidCenters.length === 0) return true;
  return avoidCenters.every(c => hexDistance(q, r, c.q, c.r) > radius);
}

function tileBlockedForSpecialBlob(t: Tile, excludeInfrastructure: boolean): boolean {
  if (excludeInfrastructure) {
    if (t.isProvinceCenter || t.hasAncientCity || t.hasVillage || t.hasRuins) return true;
  }
  return false;
}

/** Tile can be part of a blob of this kind (biome / isle rules). */
export function tileEligibleForSpecialKind(kind: SpecialRegionKind, t: Tile, tileMap: Map<string, Tile>): boolean {
  if (kind === 'isle_lost') {
    if (t.biome === 'water') return waterTouchesIslandLand(t, tileMap);
    if (t.biome === 'mountain') return false;
    return t.isIsland;
  }
  if (t.biome === 'water') return false;
  switch (kind) {
    case 'mexca':
      return t.biome === 'desert' || t.biome === 'plains' || t.biome === 'forest';
    case 'hills_lost':
      return (
        t.biome === 'mountain' || t.biome === 'desert' || t.biome === 'plains' || t.biome === 'forest'
      );
    case 'forest_secrets':
      return t.biome === 'forest' || t.biome === 'plains' || t.biome === 'desert';
    default:
      return false;
  }
}

function shuffleKinds(rng: () => number): SpecialRegionKind[] {
  const a = [...ALL_SPECIAL_REGION_KINDS];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function tryGrowBlob(
  startTile: Tile,
  kind: SpecialRegionKind,
  tileMap: Map<string, Tile>,
  used: Set<string>,
  targetSize: number,
  avoidCenters: { q: number; r: number }[],
  avoidRadius: number,
  excludeInfrastructure: boolean,
  rng: () => number,
): string[] | null {
  const startKey = tileKey(startTile.q, startTile.r);
  const assigned: string[] = [];
  const queue: string[] = [startKey];
  const seen = new Set<string>();

  while (queue.length > 0 && assigned.length < targetSize) {
    const k = queue.shift()!;
    if (seen.has(k)) continue;
    seen.add(k);
    const t = tileMap.get(k);
    if (!t) continue;
    if (!tileEligibleForSpecialKind(kind, t, tileMap)) continue;
    if (used.has(k)) continue;
    if (tileBlockedForSpecialBlob(t, excludeInfrastructure)) continue;
    if (!hexOutsideCapitalExclusion(t.q, t.r, avoidCenters, avoidRadius)) continue;

    assigned.push(k);
    if (assigned.length >= targetSize) break;

    const neigh = hexNeighbors(t.q, t.r);
    const order = [...neigh].sort(() => rng() - 0.5);
    for (const [nq, nr] of order) {
      const nt = tileMap.get(tileKey(nq, nr));
      if (!nt || !tileEligibleForSpecialKind(kind, nt, tileMap)) continue;
      const nk = tileKey(nq, nr);
      if (!seen.has(nk)) queue.push(nk);
    }
  }

  const minOk = Math.min(4, targetSize);
  if (assigned.length < minOk) return null;
  return assigned;
}

export type PlaceSpecialTerrainOpts = {
  avoidCenters: { q: number; r: number }[];
  /** Default {@link SPECIAL_TERRAIN_CAPITAL_EXCLUSION_RADIUS} when capitals are known. */
  avoidRadius: number;
  /** When true (after full map gen), never paint province centers, villages, ruins, ancient sites. */
  excludeInfrastructure: boolean;
};

/**
 * Clears prior wilds and places 2–4 disjoint connected regions (one per flavor). Guarantees at least two flavors when the map allows it.
 */
export function placeSingleBlobSpecialRegions(
  allTiles: Tile[],
  tileMap: Map<string, Tile>,
  rng: () => number,
  opts: PlaceSpecialTerrainOpts,
): void {
  clearAllSpecialTerrain(allTiles);
  const { avoidCenters, avoidRadius, excludeInfrastructure } = opts;

  const used = new Set<string>();
  const kindTarget =
    SPECIAL_REGION_KINDS_MIN + Math.floor(rng() * (SPECIAL_REGION_KINDS_MAX - SPECIAL_REGION_KINDS_MIN + 1));
  const kindsOrder = shuffleKinds(rng);

  const tryPlaceKind = (kind: SpecialRegionKind, radius: number): boolean => {
    const targetSize =
      SPECIAL_REGION_BLOB_SIZE_MIN +
      Math.floor(rng() * (SPECIAL_REGION_BLOB_SIZE_MAX - SPECIAL_REGION_BLOB_SIZE_MIN + 1));
    const candidates = allTiles.filter(
      t =>
        !used.has(tileKey(t.q, t.r)) &&
        !tileBlockedForSpecialBlob(t, excludeInfrastructure) &&
        tileEligibleForSpecialKind(kind, t, tileMap) &&
        hexOutsideCapitalExclusion(t.q, t.r, avoidCenters, radius),
    );
    if (candidates.length === 0) return false;

    for (let attempt = 0; attempt < 160; attempt++) {
      const seed = candidates[Math.floor(rng() * candidates.length)]!;
      const blob = tryGrowBlob(
        seed,
        kind,
        tileMap,
        used,
        targetSize,
        avoidCenters,
        radius,
        excludeInfrastructure,
        rng,
      );
      if (!blob) continue;
      for (const k of blob) {
        const t = tileMap.get(k);
        if (t) t.specialTerrainKind = kind;
        used.add(k);
      }
      return true;
    }
    return false;
  };

  let placed = 0;
  for (const kind of kindsOrder) {
    if (placed >= kindTarget) break;
    if (tryPlaceKind(kind, avoidRadius)) placed++;
  }

  const countKinds = () =>
    new Set(allTiles.map(t => t.specialTerrainKind).filter(Boolean) as SpecialRegionKind[]).size;

  if (countKinds() < SPECIAL_REGION_KINDS_MIN) {
    for (const kind of ALL_SPECIAL_REGION_KINDS) {
      if (countKinds() >= SPECIAL_REGION_KINDS_MIN) break;
      if (allTiles.some(t => t.specialTerrainKind === kind)) continue;
      tryPlaceKind(kind, avoidRadius);
    }
  }

  if (countKinds() < SPECIAL_REGION_KINDS_MIN) {
    for (const kind of ALL_SPECIAL_REGION_KINDS) {
      if (countKinds() >= SPECIAL_REGION_KINDS_MIN) break;
      if (allTiles.some(t => t.specialTerrainKind === kind)) continue;
      tryPlaceKind(kind, 0);
    }
  }
}

/**
 * After capitals exist: repaints named wilds so no hex lies within {@link SPECIAL_TERRAIN_CAPITAL_EXCLUSION_RADIUS}
 * of any capital. Province centers / villages / ruins / ancient sites are avoided.
 */
export function rebuildSpecialTerrainForCapitals(
  allTiles: Tile[],
  tileMap: Map<string, Tile>,
  config: MapConfig,
  capitalHexes: { q: number; r: number }[],
): { scrollRelics: ScrollRelicSite[]; scrollRelicClusters: ScrollRelicClusters } {
  const rng = mulberry32((config.seed ^ 0x7363726f) >>> 0);
  placeSingleBlobSpecialRegions(allTiles, tileMap, rng, {
    avoidCenters: capitalHexes,
    avoidRadius: SPECIAL_TERRAIN_CAPITAL_EXCLUSION_RADIUS,
    excludeInfrastructure: true,
  });
  const rngRelic = mulberry32((config.seed ^ 0x72656c) >>> 0);
  const scrollRelics = placeScrollRelics(allTiles, rngRelic);
  const scrollRelicClusters = computeScrollRelicClusters(tileMap, scrollRelics);
  return { scrollRelics, scrollRelicClusters };
}

/** Pick one relic hex per special terrain flavor present (deterministic from rng). */
export function placeScrollRelics(allTiles: Tile[], rng: () => number): ScrollRelicSite[] {
  const order: SpecialRegionKind[] = ['mexca', 'hills_lost', 'forest_secrets', 'isle_lost'];
  const sites: ScrollRelicSite[] = [];
  for (const regionKind of order) {
    const candidates = allTiles.filter(t => t.specialTerrainKind === regionKind);
    if (candidates.length === 0) continue;
    const t = candidates[Math.floor(rng() * candidates.length)]!;
    sites.push({ regionKind, q: t.q, r: t.r });
  }
  return sites;
}

// ─── Ancient City placement (after starting cities chosen) ─────────────

export function placeAncientCity(
  tiles: Map<string, Tile>,
  humanQ: number,
  humanR: number,
  aiQ: number | undefined,
  aiR: number | undefined,
): void {
  const landTiles: Tile[] = [];
  tiles.forEach((tile) => {
    if (tile.biome === 'water') return;
    landTiles.push(tile);
  });

  const cityKeys = new Set<string>();
  cityKeys.add(tileKey(humanQ, humanR));
  if (aiQ !== undefined && aiR !== undefined) cityKeys.add(tileKey(aiQ, aiR));

  const candidates = landTiles.filter((t) => !cityKeys.has(tileKey(t.q, t.r)));
  if (candidates.length === 0) return;

  const dAi = (q: number, r: number) =>
    aiQ !== undefined && aiR !== undefined ? hexDistance(aiQ, aiR, q, r) : 0;

  let bestDiff = Infinity;
  const best: Tile[] = [];
  for (const t of candidates) {
    const dHuman = hexDistance(humanQ, humanR, t.q, t.r);
    const diff = Math.abs(dHuman - dAi(t.q, t.r));
    if (diff < bestDiff) {
      bestDiff = diff;
      best.length = 0;
      best.push(t);
    } else if (diff === bestDiff) {
      best.push(t);
    }
  }
  if (best.length === 0) return;
  const chosen = best[Math.floor(Math.random() * best.length)];
  chosen.hasAncientCity = true;
}

// ─── Height Computation ────────────────────────────────────────────

function computeHeight(biome: Biome, elevation: number): number {
  const spec = BIOME_HEIGHTS[biome];
  // Normalize elevation from [-1, 1] to [0, 1] for variation
  const t = (elevation + 1) / 2;
  return spec.base + spec.variation * t;
}

// ─── Noise Sampling ────────────────────────────────────────────────

function sampleElevation(
  q: number,
  r: number,
  config: MapConfig,
  elevNoise: (x: number, y: number) => number,
  detailNoise: (x: number, y: number) => number,
): number {
  const scale = config.noiseScale;

  const e1 = elevNoise(q * scale, r * scale) * 1.0;
  const e2 = elevNoise(q * scale * 2.0, r * scale * 2.0) * 0.5;
  const e3 = detailNoise(q * scale * 4.0, r * scale * 4.0) * 0.25;
  let e = (e1 + e2 + e3) / 1.75;

  // Island falloff — gentler uplift so coastlines stay lower and seas read larger
  const cx = config.width / 2;
  const cy = config.height / 2;
  const dx = (q - cx) / Math.max(1, cx);
  const dy = (r - cy) / Math.max(1, cy);
  const distFromCenter = Math.sqrt(dx * dx + dy * dy);
  const falloff = 1.0 - Math.pow(distFromCenter, 1.65);

  if (config.mapTerrain === 'islands') {
    // Archipelago: much less continental uplift — almost all deep ocean; land only on noise peaks + corners.
    e = e * 0.48 + falloff * 0.05;
    e -= 0.14;
  } else {
    e = e * 0.74 + falloff * 0.22;
  }

  /** Large inland sea — pull map center down so classifyBiome yields a central water body. */
  if (config.mapTerrain === 'lake') {
    e -= Math.max(0, 1 - distFromCenter * 1.12) * 0.44;
  }

  // Ensure land in all 4 corners (for 4-bot maps) — lighter touch on archipelago so the map stays ocean-heavy.
  if (config.ensureCornerLand) {
    const w = config.width;
    const h = config.height;
    const cornerRadius = Math.min(14, Math.floor(Math.min(w, h) * 0.22));
    const corners: [number, number][] = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
    const boostScale = config.mapTerrain === 'islands' ? 0.12 : 0.25;
    const floorBase = config.mapTerrain === 'islands' ? 0.08 : -0.05;
    for (const [cq, cr] of corners) {
      const d = hexDistance(q, r, cq, cr);
      if (d <= cornerRadius) {
        const boost = boostScale * (1 - d / cornerRadius);
        e = Math.max(e, floorBase + boost);
      }
    }
  }

  return Math.max(-1, Math.min(1, e));
}

function sampleMoisture(
  q: number,
  r: number,
  config: MapConfig,
  moistNoise: (x: number, y: number) => number,
): number {
  const scale = config.moistureScale;
  const m = moistNoise(q * scale + 500, r * scale + 500);
  return (m + 1) / 2;
}

// ─── Biome Classification ──────────────────────────────────────────

function classifyBiome(elevation: number, moisture: number, config: MapConfig): Biome {
  const terrain = config.mapTerrain ?? 'continents';

  if (terrain === 'no_water') {
    if (elevation < 0.02) return moisture < 0.28 ? 'desert' : 'plains';
  } else {
    // Islands: high threshold + lowered sampleElevation → ~85–95% water; scattered peaks = land.
    const waterCut = terrain === 'islands' ? 0.22 : 0.02;
    if (elevation < waterCut) return 'water';
  }

  if (elevation > 0.55) return 'mountain';
  if (moisture < 0.3) return 'desert';
  if (moisture > 0.6 && elevation > 0.05) return 'forest';
  return 'plains';
}

// ─── Province Center Selection ─────────────────────────────────────

function selectProvinceCenters(
  landTiles: Tile[],
  config: MapConfig,
  rng: () => number,
): Tile[] {
  const targetCount = Math.max(
    4,
    Math.floor(landTiles.length * config.provinceDensity)
  );
  const minDistance = 8;
  const centers: Tile[] = [];

  const candidates = landTiles
    .filter((t) => t.biome === 'plains' || t.biome === 'forest')
    .sort(() => rng() - 0.5);

  for (const candidate of candidates) {
    if (centers.length >= targetCount) break;

    const tooClose = centers.some(
      (c) => hexDistance(c.q, c.r, candidate.q, candidate.r) < minDistance
    );

    if (!tooClose) {
      centers.push(candidate);
    }
  }

  return centers;
}

// ─── Road Generation (A* Pathfinding) ──────────────────────────────

function generateRoads(
  centers: Tile[],
  tileMap: Map<string, Tile>,
  config: MapConfig,
): void {
  for (const center of centers) {
    const sorted = [...centers]
      .filter((c) => c !== center)
      .sort(
        (a, b) =>
          hexDistance(center.q, center.r, a.q, a.r) -
          hexDistance(center.q, center.r, b.q, b.r)
      );

    const connectTo = sorted.slice(0, 3);
    for (const target of connectTo) {
      const path = findPath(center, target, tileMap, config);
      for (const key of path) {
        const tile = tileMap.get(key);
        if (tile && tile.biome !== 'water') {
          tile.hasRoad = true;
        }
      }
    }
  }
}

function findPath(
  start: Tile,
  end: Tile,
  tileMap: Map<string, Tile>,
  config: MapConfig,
): string[] {
  const gScore = new Map<string, number>();
  const fScore = new Map<string, number>();
  const cameFrom = new Map<string, string>();
  const openSet = new Set<string>();
  const closedSet = new Set<string>();

  const startKey = tileKey(start.q, start.r);
  const endKey = tileKey(end.q, end.r);

  gScore.set(startKey, 0);
  fScore.set(startKey, hexDistance(start.q, start.r, end.q, end.r));
  openSet.add(startKey);

  const maxIter = config.width * config.height * 2;
  let iter = 0;

  while (openSet.size > 0 && iter++ < maxIter) {
    let currentKey = '';
    let lowestF = Infinity;
    for (const key of openSet) {
      const f = fScore.get(key) ?? Infinity;
      if (f < lowestF) {
        lowestF = f;
        currentKey = key;
      }
    }

    if (currentKey === endKey) {
      return reconstructPath(cameFrom, endKey);
    }

    openSet.delete(currentKey);
    closedSet.add(currentKey);

    const [cq, cr] = currentKey.split(',').map(Number);
    const neighbors = hexNeighbors(cq, cr);
    const currentG = gScore.get(currentKey) ?? Infinity;

    for (const [nq, nr] of neighbors) {
      const nKey = tileKey(nq, nr);
      if (closedSet.has(nKey)) continue;

      const nTile = tileMap.get(nKey);
      if (!nTile || nTile.biome === 'water') continue;

      const moveCost = getMoveCost(nTile);
      const tentativeG = currentG + moveCost;

      if (tentativeG < (gScore.get(nKey) ?? Infinity)) {
        cameFrom.set(nKey, currentKey);
        gScore.set(nKey, tentativeG);
        fScore.set(nKey, tentativeG + hexDistance(nq, nr, end.q, end.r));
        openSet.add(nKey);
      }
    }
  }

  return straightLinePath(startKey, endKey);
}

function getMoveCost(tile: Tile): number {
  switch (tile.biome) {
    case 'water': return Infinity;
    case 'mountain': return 5;
    case 'forest': return 2;
    case 'desert': return 2.5;
    case 'plains': return 1;
    default: return 1;
  }
}

function reconstructPath(
  cameFrom: Map<string, string>,
  endKey: string,
): string[] {
  const path: string[] = [endKey];
  let current = endKey;
  while (cameFrom.has(current)) {
    current = cameFrom.get(current)!;
    path.unshift(current);
  }
  return path;
}

function straightLinePath(startKey: string, endKey: string): string[] {
  const [sq, sr] = startKey.split(',').map(Number);
  const [eq, er] = endKey.split(',').map(Number);
  const dist = hexDistance(sq, sr, eq, er);
  if (dist === 0) return [startKey];

  const path: string[] = [];
  const ss = -sq - sr;
  const es = -eq - er;

  for (let i = 0; i <= dist; i++) {
    const t = dist === 0 ? 0 : i / dist;
    const fq = sq + (eq - sq) * t;
    const fr = sr + (er - sr) * t;
    const fs = ss + (es - ss) * t;
    const [rq, rr] = cubeRound(fq, fr, fs);
    path.push(tileKey(rq, rr));
  }

  return path;
}

function cubeRound(fq: number, fr: number, fs: number): [number, number] {
  let rq = Math.round(fq);
  let rr = Math.round(fr);
  const rs = Math.round(fs);

  const dq = Math.abs(rq - fq);
  const dr = Math.abs(rr - fr);
  const ds = Math.abs(rs - fs);

  if (dq > dr && dq > ds) {
    rq = -rr - rs;
  } else if (dr > ds) {
    rr = -rq - rs;
  }

  return [rq, rr];
}

// ─── Ruin Scattering ───────────────────────────────────────────────

function scatterRuins(
  allTiles: Tile[],
  tileMap: Map<string, Tile>,
  config: MapConfig,
  rng: () => number,
): void {
  for (const tile of allTiles) {
    if (tile.biome === 'water' || tile.isProvinceCenter) continue;

    let chance = config.ruinDensity;

    if (tile.hasRoad) {
      chance *= 3;
    } else {
      const neighbors = hexNeighbors(tile.q, tile.r);
      const nearRoad = neighbors.some(([nq, nr]) => {
        const n = tileMap.get(tileKey(nq, nr));
        return n?.hasRoad;
      });
      if (nearRoad) chance *= 2;
    }

    if (rng() < chance) {
      tile.hasRuins = true;
    }
  }
}

// ─── Quarry & Mine Deposits (biome-based) ─────────────────────────

function scatterResourceDeposits(
  allTiles: Tile[],
  rng: () => number,
): void {
  for (const tile of allTiles) {
    if (tile.biome === 'water' || tile.hasVillage || tile.isProvinceCenter) continue;

    // Quarries: common on mountains, medium chance on plains/forest with elevation
    if (tile.biome === 'mountain') {
      if (rng() < 0.6) tile.hasQuarryDeposit = true;
    } else if ((tile.biome === 'plains' || tile.biome === 'forest') && tile.elevation > 0.2) {
      if (rng() < 0.25) tile.hasQuarryDeposit = true;
    }

    // Mines: plains and forest, rarer than quarries
    if (tile.biome === 'plains' || tile.biome === 'forest') {
      if (!tile.hasQuarryDeposit && rng() < 0.12) tile.hasMineDeposit = true;
    }

    // Gold mine deposits: mountains only, less common than iron mines
    if (tile.biome === 'mountain') {
      if (!tile.hasQuarryDeposit && !tile.hasMineDeposit && rng() < 0.05) tile.hasGoldMineDeposit = true;
    }

    // Wood deposits: forest (logging huts)
    if (tile.biome === 'forest' && rng() < 0.35) tile.hasWoodDeposit = true;
  }
}

// ─── Village Spawning ──────────────────────────────────────────────

function spawnVillages(
  allTiles: Tile[],
  config: MapConfig,
  rng: () => number,
): void {
  for (const tile of allTiles) {
    if (
      tile.biome === 'water' ||
      tile.biome === 'mountain' ||
      tile.isProvinceCenter ||
      tile.hasRuins ||
      tile.specialTerrainKind
    ) continue;

    const islandBoost = tile.isIsland ? 1.8 : 1;
    if (rng() < config.villageDensity * islandBoost) {
      tile.hasVillage = true;
    }
  }
}

/** Landmasses inside oceans — larger archipelagos and occasional high ground. */
function sprinkleOceanIslands(
  allTiles: Tile[],
  tileMap: Map<string, Tile>,
  config: MapConfig,
  rng: () => number,
): void {
  const waterCandidates = allTiles.filter((t) => t.biome === 'water');
  if (waterCandidates.length < 20) return;

  const baseAttempts = Math.floor((config.width * config.height) / 280);
  const attempts = Math.max(
    12,
    config.mapTerrain === 'islands' ? Math.floor(baseAttempts * 3.2) : baseAttempts,
  );
  for (let a = 0; a < attempts; a++) {
    const seed = waterCandidates[Math.floor(rng() * waterCandidates.length)];
    const neighbors = hexNeighbors(seed.q, seed.r);
    const nearLand = neighbors.some(([nq, nr]) => {
      const n = tileMap.get(tileKey(nq, nr));
      return n && n.biome !== 'water';
    });
    if (nearLand && rng() < 0.72) continue;

    const size = 8 + Math.floor(rng() * 22);
    const queue: Tile[] = [seed];
    const seen = new Set<string>([tileKey(seed.q, seed.r)]);
    let added = 0;
    while (queue.length > 0 && added < size) {
      const cur = queue.shift()!;
      if (cur.biome !== 'water') continue;
      const elev = cur.elevation;
      const roll = rng();
      if (roll < 0.12) {
        cur.biome = 'mountain';
      } else {
        cur.biome = roll < 0.52 ? 'forest' : 'plains';
      }
      cur.height = computeHeight(cur.biome, elev);
      added++;

      for (const [nq, nr] of hexNeighbors(cur.q, cur.r)) {
        const k = tileKey(nq, nr);
        if (seen.has(k)) continue;
        const nt = tileMap.get(k);
        if (!nt || nt.biome !== 'water') continue;
        if (rng() < 0.68) {
          seen.add(k);
          queue.push(nt);
        }
      }
    }
  }
}

/** Land hexes not reachable from map edge without crossing water are flagged isIsland. */
function labelIslandLandmasses(
  allTiles: Tile[],
  tileMap: Map<string, Tile>,
  config: MapConfig,
): void {
  const w = config.width;
  const h = config.height;
  const edgeLand: Tile[] = [];
  for (const t of allTiles) {
    if (t.biome === 'water') continue;
    if (t.q === 0 || t.r === 0 || t.q === w - 1 || t.r === h - 1) edgeLand.push(t);
  }

  const visited = new Set<string>();
  const queue: Tile[] = [...edgeLand];
  for (const t of edgeLand) visited.add(tileKey(t.q, t.r));

  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const [nq, nr] of hexNeighbors(cur.q, cur.r)) {
      if (nq < 0 || nr < 0 || nq >= w || nr >= h) continue;
      const k = tileKey(nq, nr);
      if (visited.has(k)) continue;
      const nt = tileMap.get(k);
      if (!nt || nt.biome === 'water') continue;
      visited.add(k);
      queue.push(nt);
    }
  }

  for (const t of allTiles) {
    if (t.biome === 'water') {
      t.isIsland = false;
      continue;
    }
    t.isIsland = !visited.has(tileKey(t.q, t.r));
  }
}
