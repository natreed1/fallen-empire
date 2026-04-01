/**
 * Trade route connectivity via passable terrain.
 * Cities auto-connect when reachable through passable hexes (plains, forest, desert).
 * Blocked by mountains, water, and enemy units. Roads on mountains create "mountain passes"
 * and make those hexes traversable for connectivity.
 *
 * Unit supply: military units and builders get supply when within SUPPLY_VICINITY_RADIUS
 * of any friendly city. Supply is by vicinity, not road connectivity.
 */

import { City, Unit, Tile, TerritoryInfo, hexNeighbors, hexDistance, tileKey, parseTileKey, SUPPLY_VICINITY_RADIUS } from '@/types/game';

export interface TradeCluster {
  cityIds: string[];
  cities: City[];
}

/** Flood-fill: each water hex key → component id (for port-linked trade). */
export function getWaterHexComponents(tiles: Map<string, Tile>): Map<string, number> {
  const result = new Map<string, number>();
  let nextId = 0;
  for (const tile of tiles.values()) {
    if (tile.biome !== 'water') continue;
    const k = tileKey(tile.q, tile.r);
    if (result.has(k)) continue;
    nextId += 1;
    const id = nextId;
    const queue: Tile[] = [tile];
    result.set(k, id);
    while (queue.length > 0) {
      const t = queue.pop()!;
      for (const [nq, nr] of hexNeighbors(t.q, t.r)) {
        const nk = tileKey(nq, nr);
        if (result.has(nk)) continue;
        const nt = tiles.get(nk);
        if (!nt || nt.biome !== 'water') continue;
        result.set(nk, id);
        queue.push(nt);
      }
    }
  }
  return result;
}

function mergeLandClustersByPorts(
  landClusters: TradeCluster[],
  tiles: Map<string, Tile>,
  waterKeyToComp: Map<string, number>,
): TradeCluster[] {
  if (landClusters.length <= 1) return landClusters;

  const n = landClusters.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const portComps: Set<number>[] = landClusters.map(cluster => {
    const s = new Set<number>();
    for (const c of cluster.cities) {
      for (const b of c.buildings) {
        if (b.type !== 'port') continue;
        for (const [nq, nr] of hexNeighbors(b.q, b.r)) {
          const wk = tileKey(nq, nr);
          if (tiles.get(wk)?.biome !== 'water') continue;
          const comp = waterKeyToComp.get(wk);
          if (comp != null) s.add(comp);
        }
      }
    }
    return s;
  });

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let share = false;
      for (const w of portComps[i]) {
        if (portComps[j].has(w)) {
          share = true;
          break;
        }
      }
      if (share) union(i, j);
    }
  }

  const byRoot = new Map<number, Map<string, City>>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!byRoot.has(r)) byRoot.set(r, new Map());
    const m = byRoot.get(r)!;
    for (const c of landClusters[i].cities) m.set(c.id, c);
  }

  const out: TradeCluster[] = [];
  for (const m of byRoot.values()) {
    const cities = [...m.values()];
    out.push({ cityIds: cities.map(c => c.id), cities });
  }
  return out;
}

/**
 * Compute trade clusters per player.
 * Cities are in the same cluster if they're connected via passable terrain
 * (plains, forest, desert — or mountains with roads / mountain passes) with no enemy blocking.
 */
export function computeTradeClusters(
  cities: City[],
  tiles: Map<string, Tile>,
  units: Unit[],
  territory: Map<string, TerritoryInfo>,
): Map<string, TradeCluster[]> {
  const enemyByHex = new Map<string, string>();
  for (const u of units) {
    if (u.hp <= 0) continue;
    const key = tileKey(u.q, u.r);
    // For a given player, "enemy" = any unit not owned by that player
    if (!enemyByHex.has(key)) enemyByHex.set(key, u.ownerId);
    else {
      const existing = enemyByHex.get(key)!;
      if (existing !== u.ownerId) enemyByHex.set(key, 'multiple'); // multiple owners = blocked for all
    }
  }

  const byPlayer = new Map<string, City[]>();
  for (const c of cities) {
    if (!byPlayer.has(c.ownerId)) byPlayer.set(c.ownerId, []);
    byPlayer.get(c.ownerId)!.push(c);
  }

  const result = new Map<string, TradeCluster[]>();

  for (const [playerId, playerCities] of byPlayer) {
    const landClusters: TradeCluster[] = [];
    const assigned = new Set<string>();
    const cityByHex = new Map<string, City>();
    for (const c of playerCities) cityByHex.set(tileKey(c.q, c.r), c);

    for (const startCity of playerCities) {
      if (assigned.has(startCity.id)) continue;

      const clusterCities: City[] = [];
      const queue: [number, number][] = [[startCity.q, startCity.r]];
      const visited = new Set<string>();
      visited.add(tileKey(startCity.q, startCity.r));

      while (queue.length > 0) {
        const [q, r] = queue.shift()!;
        const key = tileKey(q, r);

        const tile = tiles.get(key);
        if (!tile || tile.biome === 'water') continue;

        const cityHere = cityByHex.get(key);
        if (cityHere) {
          clusterCities.push(cityHere);
          assigned.add(cityHere.id);
        }

        for (const [nq, nr] of hexNeighbors(q, r)) {
          const nKey = tileKey(nq, nr);
          if (visited.has(nKey)) continue;

          const nTile = tiles.get(nKey);
          if (!nTile) continue;
          // Passable: plains/forest/desert, or mountains with roads (mountain pass)
          const passable =
            (nTile.biome !== 'water' && nTile.biome !== 'mountain') ||
            (nTile.biome === 'mountain' && nTile.hasRoad);
          if (!passable) continue;

          const enemyOwner = enemyByHex.get(nKey);
          if (enemyOwner !== undefined && enemyOwner !== playerId) continue;

          visited.add(nKey);
          queue.push([nq, nr]);
        }
      }

      if (clusterCities.length > 0) {
        landClusters.push({
          cityIds: clusterCities.map(c => c.id),
          cities: clusterCities,
        });
      }
    }

    const waterComps = getWaterHexComponents(tiles);
    result.set(playerId, mergeLandClustersByPorts(landClusters, tiles, waterComps));
  }

  return result;
}

/**
 * Find which cluster supplies a unit.
 * Units get supply when within SUPPLY_VICINITY_RADIUS hexes of any friendly city in a cluster.
 * No roads required — supply is by vicinity of cities, not road connectivity.
 */
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

export function getSupplyingClusterKey(
  unit: Unit,
  clusters: TradeCluster[],
  _tiles: Map<string, Tile>,
  _units: Unit[],
  playerId: string,
): string | null {
  for (const cluster of clusters) {
    for (const city of cluster.cities) {
      if (city.ownerId !== playerId) continue;
      const dist = hexDistance(unit.q, unit.r, city.q, city.r);
      if (dist <= SUPPLY_VICINITY_RADIUS) {
        return cluster.cityIds.join(',');
      }
    }
  }
  return null;
}

/** A* pathfinding for logistics: mountains and water impassable except mountain passes (roads on mountains). */
function pathfindLogistics(
  fromQ: number,
  fromR: number,
  toQ: number,
  toR: number,
  tiles: Map<string, Tile>,
  units: Unit[],
  playerId: string,
): { q: number; r: number }[] {
  const enemyByHex = new Map<string, boolean>();
  for (const u of units) {
    if (u.hp <= 0) continue;
    const key = tileKey(u.q, u.r);
    if (u.ownerId !== playerId) enemyByHex.set(key, true);
  }

  const getMoveCost = (tile: Tile): number => {
    if (tile.biome === 'water') return Infinity;
    if (tile.biome === 'mountain') return tile.hasRoad ? 5 : Infinity; // mountain pass
    switch (tile.biome) {
      case 'forest': return 2;
      case 'desert': return 2.5;
      default: return 1;
    }
  };

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
      if (!nTile) continue;
      if (enemyByHex.get(nKey)) continue;

      const cost = getMoveCost(nTile);
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
