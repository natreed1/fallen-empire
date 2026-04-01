import { createNoise2D } from 'simplex-noise';
import {
  Tile,
  Biome,
  MapConfig,
  BIOME_HEIGHTS,
  hexNeighbors,
  hexDistance,
  tileKey,
  SPECIAL_REGION_HEX_RADIUS,
  SPECIAL_REGION_DISPLAY_NAME,
  type SpecialRegion,
  type SpecialRegionKind,
  type ScrollKind,
} from '@/types/game';

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
      const biome = classifyBiome(elevation, moisture);
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

  // ── Pass 2: Empire overlay ─────────────────────────────────────
  const landTiles = allTiles.filter((t) => t.biome !== 'water');
  const provinceCenters = selectProvinceCenters(landTiles, config, rng);

  for (const center of provinceCenters) {
    center.isProvinceCenter = true;
  }

  generateRoads(provinceCenters, tileMap, config);
  scatterRuins(allTiles, tileMap, config, rng);

  // ── Pass 3: Villages ───────────────────────────────────────────
  spawnVillages(allTiles, config, rng);

  // ── Pass 4: Quarry & Mine deposits (biome-based) ───────────────
  scatterResourceDeposits(allTiles, rng);

  // ── Pass 5: Special scroll regions (large scattered zones) ──────
  const specialRegions = placeSpecialRegions(allTiles, tileMap, config, rng);

  return { tiles: allTiles, provinceCenters, specialRegions };
}

/** Keep region disks from overlapping (2×radius + small buffer). */
const MIN_SPECIAL_REGION_CENTER_SEP = 14;

function placeSpecialRegions(
  allTiles: Tile[],
  tileMap: Map<string, Tile>,
  config: MapConfig,
  rng: () => number,
): SpecialRegion[] {
  const specs: { kind: SpecialRegionKind; scrollReward: ScrollKind }[] = [
    { kind: 'mexca', scrollReward: 'combat' },
    { kind: 'hills_lost', scrollReward: 'defense' },
    { kind: 'forest_secrets', scrollReward: 'movement' },
    { kind: 'isle_lost', scrollReward: 'combat' },
  ];
  for (let i = specs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [specs[i], specs[j]] = [specs[j], specs[i]];
  }

  const takenCenters: { q: number; r: number }[] = [];
  const regions: SpecialRegion[] = [];
  const margin = SPECIAL_REGION_HEX_RADIUS + 2;

  for (const spec of specs) {
    const pool = candidateCentersForSpecialRegion(
      spec.kind,
      allTiles,
      config,
      takenCenters,
      margin,
      MIN_SPECIAL_REGION_CENTER_SEP,
    );
    if (pool.length === 0) continue;

    const center = pool[Math.floor(rng() * pool.length)];
    takenCenters.push(center);
    const id = `sr_${spec.kind}_${regions.length}`;
    regions.push({
      id,
      kind: spec.kind,
      name: SPECIAL_REGION_DISPLAY_NAME[spec.kind],
      centerQ: center.q,
      centerR: center.r,
      radius: SPECIAL_REGION_HEX_RADIUS,
      scrollReward: spec.scrollReward,
    });
    paintSpecialRegion(tileMap, allTiles, center, spec.kind, id, config);
    const centerTile = tileMap.get(tileKey(center.q, center.r));
    if (centerTile && spec.kind === 'mexca' && centerTile.biome !== 'water') {
      centerTile.hasRuins = true;
    }
  }

  return regions;
}

function candidateCentersForSpecialRegion(
  kind: SpecialRegionKind,
  allTiles: Tile[],
  config: MapConfig,
  takenCenters: { q: number; r: number }[],
  margin: number,
  minSep: number,
): Tile[] {
  const w = config.width;
  const h = config.height;
  const farFromEdge = (t: Tile) =>
    t.q >= margin && t.r >= margin && t.q < w - margin && t.r < h - margin;
  const farFromTaken = (t: Tile) =>
    takenCenters.every(c => hexDistance(c.q, c.r, t.q, t.r) >= minSep);

  let pool = allTiles.filter(t => t.biome !== 'water' && farFromEdge(t) && farFromTaken(t));

  const byKind = (): Tile[] => {
    switch (kind) {
      case 'mexca':
        return pool.filter(t => t.biome === 'desert' || t.biome === 'plains');
      case 'hills_lost':
        return pool.filter(t => t.biome === 'mountain' || (t.biome === 'plains' && t.elevation > 0.32));
      case 'forest_secrets':
        return pool.filter(t => t.biome === 'forest');
      case 'isle_lost':
        return pool.filter(t => t.isIsland);
      default:
        return pool;
    }
  };

  let out = byKind();
  if (out.length === 0 && kind === 'forest_secrets') {
    out = pool.filter(t => t.biome === 'plains' || t.biome === 'forest');
  }
  if (out.length === 0 && kind === 'mexca') {
    out = pool.filter(t => t.biome !== 'mountain');
  }
  if (out.length === 0 && kind === 'hills_lost') {
    out = pool.filter(t => t.biome === 'mountain' || t.biome === 'desert');
  }
  if (out.length === 0 && kind === 'isle_lost') {
    out = allTiles.filter(
      t =>
        t.biome !== 'water' &&
        t.biome !== 'mountain' &&
        farFromEdge(t) &&
        farFromTaken(t),
    );
  }
  return out;
}

function paintSpecialRegion(
  tileMap: Map<string, Tile>,
  allTiles: Tile[],
  center: { q: number; r: number },
  _kind: SpecialRegionKind,
  regionId: string,
  config: MapConfig,
): void {
  const R = SPECIAL_REGION_HEX_RADIUS;
  const isle = _kind === 'isle_lost';

  for (const t of allTiles) {
    if (hexDistance(center.q, center.r, t.q, t.r) > R) continue;
    if (!isle && t.biome === 'water') continue;
    if (t.specialRegionId) continue;
    const tile = tileMap.get(tileKey(t.q, t.r));
    if (tile) tile.specialRegionId = regionId;
  }
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
  const dx = (q - cx) / cx;
  const dy = (r - cy) / cy;
  const distFromCenter = Math.sqrt(dx * dx + dy * dy);
  const falloff = 1.0 - Math.pow(distFromCenter, 1.65);
  e = e * 0.74 + falloff * 0.22;

  // Ensure land in all 4 corners (for 4-bot maps)
  if (config.ensureCornerLand) {
    const w = config.width;
    const h = config.height;
    const cornerRadius = Math.min(14, Math.floor(Math.min(w, h) * 0.22));
    const corners: [number, number][] = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
    for (const [cq, cr] of corners) {
      const d = hexDistance(q, r, cq, cr);
      if (d <= cornerRadius) {
        const boost = 0.25 * (1 - d / cornerRadius);
        e = Math.max(e, -0.05 + boost);
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

function classifyBiome(elevation: number, moisture: number): Biome {
  if (elevation < 0.02) return 'water';
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
      tile.hasRuins
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

  const attempts = Math.max(
    12,
    Math.floor((config.width * config.height) / 280),
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
