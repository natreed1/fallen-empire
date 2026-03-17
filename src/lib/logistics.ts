/**
 * Trade route connectivity and unit supply via path cost.
 * Cities connect only if shortest passable path cost (terrain + interdiction) <= CITY_LINK_MAX_PATH_COST.
 * Unit supply: from nearest valid connected anchor path; supplyQuality [0..1] from route cost;
 * below threshold => unsupplied/starving (see military upkeepTick).
 *
 * Performance: min-heap Dijkstra, precomputed interdiction field, multi-source supply cost maps.
 */

import { City, Unit, Tile, TerritoryInfo, hexNeighbors, hexDistance, tileKey, parseTileKey, getHexRing } from '@/types/game';

/** Max path cost for two cities to be in the same cluster (terrain-aware + interdiction). */
export const CITY_LINK_MAX_PATH_COST = 20;
/** Max path cost from unit to nearest anchor for full supply; above => supplyQuality decays to 0. */
export const SUPPLY_UNIT_MAX_PATH_COST = 14;
/** Extra cost per hex when an enemy unit is within this distance (interdiction). */
export const INTERDICTION_RANGE = 2;
/** Added move cost for a hex when an enemy is within INTERDICTION_RANGE. */
export const INTERDICTION_HEX_COST = 3;

export interface TradeCluster {
  cityIds: string[];
  cities: City[];
}

/** Terrain-aware move cost (roads cheaper). Used for cluster links and supply path cost. */
export function getTileMoveCost(tile: Tile): number {
  if (tile.biome === 'water') return Infinity;
  if (tile.biome === 'mountain') return tile.hasRoad ? 5 : Infinity;
  let base = 1;
  switch (tile.biome) {
    case 'forest': base = 2; break;
    case 'desert': base = 2.5; break;
    default: break;
  }
  return tile.hasRoad ? base * 0.5 : base;
}

// ─── Min-heap for Dijkstra (deterministic tie-break by key) ───────────────────

interface HeapEntry { key: string; cost: number }

function heapLess(a: HeapEntry, b: HeapEntry): boolean {
  if (a.cost !== b.cost) return a.cost < b.cost;
  return a.key < b.key;
}

class MinHeap {
  private heap: HeapEntry[] = [];

  push(entry: HeapEntry): void {
    this.heap.push(entry);
    this.siftUp(this.heap.length - 1);
  }

  pop(): HeapEntry | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  private siftUp(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!heapLess(this.heap[i], this.heap[p])) break;
      [this.heap[i], this.heap[p]] = [this.heap[p], this.heap[i]];
      i = p;
    }
  }

  private siftDown(i: number): void {
    const n = this.heap.length;
    while (true) {
      let best = i;
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      if (l < n && heapLess(this.heap[l], this.heap[best])) best = l;
      if (r < n && heapLess(this.heap[r], this.heap[best])) best = r;
      if (best === i) break;
      [this.heap[i], this.heap[best]] = [this.heap[best], this.heap[i]];
      i = best;
    }
  }
}

// ─── Precomputed interdiction field (O(1) lookup per hex) ────────────────────

/** Build tileKey -> interdiction cost once per player/tick. Do not scan enemies in neighbor loop. */
export function buildInterdictionField(units: Unit[], playerId: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const u of units) {
    if (u.hp <= 0 || u.ownerId === playerId) continue;
    out.set(tileKey(u.q, u.r), INTERDICTION_HEX_COST);
    for (let ring = 1; ring <= INTERDICTION_RANGE; ring++) {
      for (const { q, r } of getHexRing(u.q, u.r, ring)) {
        const key = tileKey(q, r);
        if (!out.has(key)) out.set(key, INTERDICTION_HEX_COST);
      }
    }
  }
  return out;
}

/** Build set of hex keys occupied by enemy units (blocked for pathfinding). */
export function buildEnemyBlockedHexes(units: Unit[], playerId: string): Set<string> {
  const out = new Set<string>();
  for (const u of units) {
    if (u.hp <= 0) continue;
    if (u.ownerId !== playerId) out.add(tileKey(u.q, u.r));
  }
  return out;
}

/**
 * Cost-limited Dijkstra from (fromQ, fromR). Uses min-heap and precomputed interdiction.
 * Step cost = getTileMoveCost(tile) + (interdictionMap.get(nKey) ?? 0).
 */
function dijkstraCostLimited(
  fromQ: number,
  fromR: number,
  maxCost: number,
  tiles: Map<string, Tile>,
  enemyByHex: Set<string>,
  interdictionMap: Map<string, number>,
): Map<string, number> {
  const costTo = new Map<string, number>();
  const startKey = tileKey(fromQ, fromR);
  costTo.set(startKey, 0);
  const open = new MinHeap();
  open.push({ key: startKey, cost: 0 });

  const maxIter = tiles.size * 2;
  let iter = 0;
  while (!open.isEmpty() && iter++ < maxIter) {
    const { key: currentKey, cost: currentCost } = open.pop()!;
    if (currentCost > maxCost) continue;
    const [cq, cr] = parseTileKey(currentKey);

    for (const [nq, nr] of hexNeighbors(cq, cr)) {
      const nKey = tileKey(nq, nr);
      if (enemyByHex.has(nKey)) continue;
      const nTile = tiles.get(nKey);
      if (!nTile) continue;
      const moveCost = getTileMoveCost(nTile);
      if (moveCost === Infinity) continue;
      const stepCost = moveCost + (interdictionMap.get(nKey) ?? 0);
      const newCost = currentCost + stepCost;
      if (newCost > maxCost) continue;
      const prev = costTo.get(nKey);
      if (prev != null && newCost >= prev) continue;
      costTo.set(nKey, newCost);
      open.push({ key: nKey, cost: newCost });
    }
  }
  return costTo;
}

/**
 * Compute trade clusters per player.
 * Cities are in the same cluster only if shortest path cost (terrain + interdiction) <= CITY_LINK_MAX_PATH_COST.
 * Uses min-heap Dijkstra and precomputed interdiction per player.
 */
export function computeTradeClusters(
  cities: City[],
  tiles: Map<string, Tile>,
  units: Unit[],
  _territory: Map<string, TerritoryInfo>,
): Map<string, TradeCluster[]> {
  const byPlayer = new Map<string, City[]>();
  for (const c of cities) {
    if (!byPlayer.has(c.ownerId)) byPlayer.set(c.ownerId, []);
    byPlayer.get(c.ownerId)!.push(c);
  }

  const result = new Map<string, TradeCluster[]>();

  for (const [playerId, playerCities] of byPlayer) {
    const enemyByHex = buildEnemyBlockedHexes(units, playerId);
    const interdictionMap = buildInterdictionField(units, playerId);

    // Union-find: parent[id] = id for root
    const parent = new Map<string, string>();
    for (const c of playerCities) parent.set(c.id, c.id);
    function find(id: string): string {
      const p = parent.get(id)!;
      if (p === id) return id;
      const root = find(p);
      parent.set(id, root);
      return root;
    }
    function union(a: string, b: string) {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    }

    for (const startCity of playerCities) {
      const costTo = dijkstraCostLimited(
        startCity.q, startCity.r, CITY_LINK_MAX_PATH_COST, tiles, enemyByHex, interdictionMap,
      );
      for (const c of playerCities) {
        if (c.id === startCity.id) continue;
        const key = tileKey(c.q, c.r);
        const cost = costTo.get(key);
        if (cost != null && cost <= CITY_LINK_MAX_PATH_COST) union(startCity.id, c.id);
      }
    }

    const rootToCities = new Map<string, City[]>();
    for (const c of playerCities) {
      const root = find(c.id);
      if (!rootToCities.has(root)) rootToCities.set(root, []);
      rootToCities.get(root)!.push(c);
    }
    const clusters: TradeCluster[] = [];
    for (const list of rootToCities.values()) {
      if (list.length > 0) {
        clusters.push({ cityIds: list.map(x => x.id), cities: list });
      }
    }
    result.set(playerId, clusters);
  }

  return result;
}

/** Returns the cluster containing the first (capital) city for the player. */
export function getCapitalCluster(
  cities: City[],
  clusters: TradeCluster[],
  playerId: string,
): TradeCluster | undefined {
  const playerCities = cities.filter(c => c.ownerId === playerId);
  const capital = playerCities[0]; // first placed = capital
  if (!capital) return undefined;
  return clusters.find(cl => cl.cityIds.includes(capital.id));
}

/** Returns the cluster containing a given city. */
export function getClusterForCity(
  cityId: string,
  clusters: TradeCluster[],
): TradeCluster | undefined {
  return clusters.find(cl => cl.cityIds.includes(cityId));
}

export interface UnitSupplyInfo {
  clusterKey: string | null;
  supplyQuality: number;
}

/** Per-player supply cost map: cost from any owned city to hex, and which cluster that cost came from. */
export interface SupplyCostMap {
  costTo: Map<string, number>;
  clusterAt: Map<string, string>;
}

/**
 * Multi-source Dijkstra from all player cities (tagged by cluster). One run per player.
 * Reusable for all units of that player in the same tick.
 */
export function computeSupplyCostMaps(
  cities: City[],
  clusters: Map<string, TradeCluster[]>,
  tiles: Map<string, Tile>,
  units: Unit[],
): Map<string, SupplyCostMap> {
  const result = new Map<string, SupplyCostMap>();
  const maxCost = SUPPLY_UNIT_MAX_PATH_COST * 1.5;

  const byPlayer = new Map<string, City[]>();
  for (const c of cities) {
    if (!byPlayer.has(c.ownerId)) byPlayer.set(c.ownerId, []);
    byPlayer.get(c.ownerId)!.push(c);
  }

  for (const [playerId, playerCities] of byPlayer) {
    const playerClusters = clusters.get(playerId) ?? [];
    const enemyByHex = buildEnemyBlockedHexes(units, playerId);
    const interdictionMap = buildInterdictionField(units, playerId);

    const costTo = new Map<string, number>();
    const clusterAt = new Map<string, string>();
    const open = new MinHeap();

    for (const cluster of playerClusters) {
      const clusterKey = cluster.cityIds.join(',');
      for (const city of cluster.cities) {
        if (city.ownerId !== playerId) continue;
        const key = tileKey(city.q, city.r);
        costTo.set(key, 0);
        clusterAt.set(key, clusterKey);
        open.push({ key, cost: 0 });
      }
    }

    const maxIter = tiles.size * 2;
    let iter = 0;
    while (!open.isEmpty() && iter++ < maxIter) {
      const { key: currentKey, cost: currentCost } = open.pop()!;
      if (currentCost > maxCost) continue;
      const currentCluster = clusterAt.get(currentKey)!;
      const [cq, cr] = parseTileKey(currentKey);

      for (const [nq, nr] of hexNeighbors(cq, cr)) {
        const nKey = tileKey(nq, nr);
        if (enemyByHex.has(nKey)) continue;
        const nTile = tiles.get(nKey);
        if (!nTile) continue;
        const moveCost = getTileMoveCost(nTile);
        if (moveCost === Infinity) continue;
        const stepCost = moveCost + (interdictionMap.get(nKey) ?? 0);
        const newCost = currentCost + stepCost;
        if (newCost > maxCost) continue;
        const prev = costTo.get(nKey);
        if (prev != null && newCost >= prev) continue;
        costTo.set(nKey, newCost);
        clusterAt.set(nKey, currentCluster);
        open.push({ key: nKey, cost: newCost });
      }
    }

    result.set(playerId, { costTo, clusterAt });
  }
  return result;
}

/**
 * Get unit supply from precomputed cost map (O(1) lookup). Use when supply cost maps are available.
 */
export function getUnitSupplyInfoFromMap(
  unit: Unit,
  map: SupplyCostMap,
): UnitSupplyInfo {
  const key = tileKey(unit.q, unit.r);
  const cost = map.costTo.get(key);
  const clusterKey = map.clusterAt.get(key) ?? null;
  if (cost == null || cost > SUPPLY_UNIT_MAX_PATH_COST) {
    return { clusterKey: null, supplyQuality: 0 };
  }
  const supplyQuality = Math.max(0, 1 - cost / SUPPLY_UNIT_MAX_PATH_COST);
  return { clusterKey, supplyQuality };
}

/**
 * Unit supply from nearest valid connected anchor path.
 * Fallback when no precomputed map: runs one Dijkstra from unit (slower).
 */
export function getUnitSupplyInfo(
  unit: Unit,
  clusters: TradeCluster[],
  tiles: Map<string, Tile>,
  units: Unit[],
  playerId: string,
): UnitSupplyInfo {
  const maxCost = SUPPLY_UNIT_MAX_PATH_COST * 1.5;
  const enemyByHex = buildEnemyBlockedHexes(units, playerId);
  const interdictionMap = buildInterdictionField(units, playerId);
  const costTo = dijkstraCostLimited(unit.q, unit.r, maxCost, tiles, enemyByHex, interdictionMap);

  let bestCost = Infinity;
  let bestClusterKey: string | null = null;

  for (const cluster of clusters) {
    for (const city of cluster.cities) {
      if (city.ownerId !== playerId) continue;
      const key = tileKey(city.q, city.r);
      const cost = costTo.get(key);
      if (cost != null && cost < bestCost) {
        bestCost = cost;
        bestClusterKey = cluster.cityIds.join(',');
      }
    }
  }

  if (bestClusterKey == null || bestCost > SUPPLY_UNIT_MAX_PATH_COST) {
    return { clusterKey: null, supplyQuality: 0 };
  }
  const supplyQuality = Math.max(0, 1 - bestCost / SUPPLY_UNIT_MAX_PATH_COST);
  return { clusterKey: bestClusterKey, supplyQuality };
}

/**
 * Legacy: returns cluster key if unit has supply, null otherwise.
 * Uses supplyQuality >= 0.5 as "supplied" for backward compatibility with upkeep.
 */
export function getSupplyingClusterKey(
  unit: Unit,
  clusters: TradeCluster[],
  tiles: Map<string, Tile>,
  units: Unit[],
  playerId: string,
): string | null {
  const info = getUnitSupplyInfo(unit, clusters, tiles, units, playerId);
  return info.supplyQuality >= 0.5 ? info.clusterKey : null;
}

/** A* pathfinding for logistics (visualization): uses getTileMoveCost; enemy hexes blocked. */
function pathfindLogistics(
  fromQ: number,
  fromR: number,
  toQ: number,
  toR: number,
  tiles: Map<string, Tile>,
  units: Unit[],
  playerId: string,
): { q: number; r: number }[] {
  const enemyByHex = new Set<string>();
  for (const u of units) {
    if (u.hp <= 0) continue;
    if (u.ownerId !== playerId) enemyByHex.add(tileKey(u.q, u.r));
  }

  const startKey = tileKey(fromQ, fromR);
  const endKey = tileKey(toQ, toR);

  const gScore = new Map<string, number>();
  const fScore = new Map<string, number>();
  const cameFrom = new Map<string, string>();
  const openSet = new Set<string>();

  gScore.set(startKey, 0);
  fScore.set(startKey, hexDistance(fromQ, fromR, toQ, toR));
  openSet.add(startKey);

  const maxIter = tiles.size * 2;
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
      const path: string[] = [endKey];
      let curr = endKey;
      while (cameFrom.has(curr)) {
        curr = cameFrom.get(curr)!;
        path.unshift(curr);
      }
      return path.map(k => {
        const [q, r] = parseTileKey(k);
        return { q, r };
      });
    }

    openSet.delete(currentKey);
    const [cq, cr] = parseTileKey(currentKey);
    const currentG = gScore.get(currentKey) ?? Infinity;

    for (const [nq, nr] of hexNeighbors(cq, cr)) {
      const nKey = tileKey(nq, nr);
      const nTile = tiles.get(nKey);
      if (!nTile || enemyByHex.has(nKey)) continue;
      const cost = getTileMoveCost(nTile);
      if (cost === Infinity) continue;

      const tentativeG = currentG + cost;
      if (tentativeG < (gScore.get(nKey) ?? Infinity)) {
        cameFrom.set(nKey, currentKey);
        gScore.set(nKey, tentativeG);
        fScore.set(nKey, tentativeG + hexDistance(nq, nr, toQ, toR));
        openSet.add(nKey);
      }
    }
  }

  return [];
}

/**
 * Compute connection paths for visualization (supply view).
 * Returns per-player arrays of hex paths (each path is a polyline between connected cities).
 * Uses a spanning tree per cluster (capital as root) with A* shortest path per edge.
 */
export function computeConnectionPaths(
  clusters: Map<string, TradeCluster[]>,
  tiles: Map<string, Tile>,
  units: Unit[],
): Map<string, { q: number; r: number }[][]> {
  const withClusters = computeConnectionPathsWithClusters(clusters, tiles, units);
  const result = new Map<string, { q: number; r: number }[][]>();
  for (const [playerId, entries] of withClusters) {
    result.set(playerId, entries.flatMap(e => e.paths));
  }
  return result;
}

export interface ClusterWithPaths {
  clusterKey: string;
  cluster: TradeCluster;
  paths: { q: number; r: number }[][];
}

/**
 * Compute connection paths with cluster metadata (for supply view UI).
 * Returns per-player arrays of { clusterKey, cluster, paths } for click resolution and health coloring.
 */
export function computeConnectionPathsWithClusters(
  clusters: Map<string, TradeCluster[]>,
  tiles: Map<string, Tile>,
  units: Unit[],
): Map<string, ClusterWithPaths[]> {
  const result = new Map<string, ClusterWithPaths[]>();

  for (const [playerId, playerClusters] of clusters) {
    const entries: ClusterWithPaths[] = [];

    for (const cluster of playerClusters) {
      const clusterKey = cluster.cityIds.join(',');
      const clusterCities = cluster.cities;
      const paths: { q: number; r: number }[][] = [];

      if (clusterCities.length >= 2) {
        const capital = clusterCities[0];
        const connected = new Set<string>([capital.id]);

        while (connected.size < clusterCities.length) {
          let bestDist = Infinity;
          let bestCity: City | null = null;
          let bestConnected: City | null = null;

          for (const city of clusterCities) {
            if (connected.has(city.id)) continue;
            for (const otherId of connected) {
              const otherCity = clusterCities.find(c => c.id === otherId)!;
              const d = hexDistance(city.q, city.r, otherCity.q, otherCity.r);
              if (d < bestDist) {
                bestDist = d;
                bestCity = city;
                bestConnected = otherCity;
              }
            }
          }

          if (!bestCity || !bestConnected) break;

          const path = pathfindLogistics(bestCity.q, bestCity.r, bestConnected.q, bestConnected.r, tiles, units, playerId);
          if (path.length > 0) paths.push(path);
          connected.add(bestCity.id);
        }
      }

      // City-to-mine and city-to-quarry paths: show integration of remote buildings
      for (const city of clusterCities) {
        for (const b of city.buildings) {
          if (b.type !== 'mine' && b.type !== 'quarry') continue;
          if (b.q === city.q && b.r === city.r) continue; // building on city hex
          const path = pathfindLogistics(city.q, city.r, b.q, b.r, tiles, units, playerId);
          if (path.length > 0) paths.push(path);
        }
      }

      entries.push({ clusterKey, cluster, paths });
    }

    result.set(playerId, entries);
  }

  return result;
}
