import {
  AttackCityStyle,
  City,
  Tile,
  Unit,
  UnitType,
  WallSection,
  getHexRing,
  hexDistance,
  hexNeighbors,
  parseTileKey,
  tileKey,
} from '@/types/game';
import { withDeployFlags, withoutPatrolFields, isLandMilitaryUnit, marchHexDistanceAtOrder } from '@/lib/garrison';

/** Land military types that can appear in tactical unit-type filters (excludes builder, naval). */
export const TACTICAL_FILTER_LAND_TYPES: UnitType[] = [
  'infantry',
  'cavalry',
  'ranged',
  'horse_archer',
  'crusader_knight',
  'trebuchet',
  'battering_ram',
  'defender',
];

export function isIntactEnemyWallAt(
  wallSections: WallSection[],
  q: number,
  r: number,
  moverId: string,
): boolean {
  return wallSections.some(
    w => w.q === q && w.r === r && w.ownerId !== moverId && (w.hp ?? 0) > 0,
  );
}

/** Land hex a mover can stand on (not water, not an intact enemy wall). */
export function isLandApproachHex(
  tiles: Map<string, Tile>,
  wallSections: WallSection[],
  q: number,
  r: number,
  moverId: string,
): boolean {
  const t = tiles.get(tileKey(q, r));
  if (!t || t.biome === 'water') return false;
  return !isIntactEnemyWallAt(wallSections, q, r, moverId);
}

/** True if at least one land neighbor of the city center is not blocked by an intact enemy wall. */
export function cityHasWallBreach(
  city: City,
  tiles: Map<string, Tile>,
  wallSections: WallSection[],
  moverId: string,
): boolean {
  return hexNeighbors(city.q, city.r).some(([q, r]) =>
    isLandApproachHex(tiles, wallSections, q, r, moverId),
  );
}

function isPassableCandidate(
  q: number,
  r: number,
  tiles: Map<string, Tile>,
  wallSections: WallSection[],
  moverId: string | undefined,
): boolean {
  if (moverId) return isLandApproachHex(tiles, wallSections, q, r, moverId);
  const t = tiles.get(tileKey(q, r));
  return !!t && t.biome !== 'water';
}

function pickClosestPassable(
  hexes: { q: number; r: number }[],
  preferFromQ: number,
  preferFromR: number,
  tiles: Map<string, Tile>,
  wallSections: WallSection[],
  moverId: string | undefined,
  avoidKeys?: Set<string>,
): { q: number; r: number; d: number } | null {
  let best: { q: number; r: number; d: number } | null = null;
  let bestAvoided: { q: number; r: number; d: number } | null = null;
  for (const { q, r } of hexes) {
    if (!isPassableCandidate(q, r, tiles, wallSections, moverId)) continue;
    const d = hexDistance(preferFromQ, preferFromR, q, r);
    if (avoidKeys?.has(tileKey(q, r))) {
      if (!bestAvoided || d < bestAvoided.d) bestAvoided = { q, r, d };
      continue;
    }
    if (!best || d < best.d) best = { q, r, d };
  }
  return best ?? bestAvoided;
}

function intactWallAt(wallSections: WallSection[], q: number, r: number): boolean {
  return wallSections.some(w => w.q === q && w.r === r && (w.hp ?? 0) > 0);
}

/** Enemy land military on this hex (besieger covering a perimeter tile). */
function enemyLandMilitaryAt(units: Unit[], q: number, r: number, cityOwnerId: string): boolean {
  return units.some(
    u =>
      u.hp > 0 &&
      !u.aboardShipId &&
      u.ownerId !== cityOwnerId &&
      u.q === q &&
      u.r === r &&
      isLandMilitaryUnit(u),
  );
}

/**
 * Design §6–7: every land ring-1 approach is covered.
 * A gap must be occupied; an intact wall is covered from an adjacent ring-2 hex.
 */
export function isCitySurrounded(
  city: City,
  tiles: Map<string, Tile>,
  units: Unit[],
  wallSections: WallSection[],
): boolean {
  const landRing1 = hexNeighbors(city.q, city.r).filter(([q, r]) => {
    const t = tiles.get(tileKey(q, r));
    return !!t && t.biome !== 'water' && t.biome !== 'mountain';
  });
  if (landRing1.length === 0) return false;

  for (const [q, r] of landRing1) {
    if (intactWallAt(wallSections, q, r)) {
      const covered = hexNeighbors(q, r).some(([oq, or]) => {
        if (hexDistance(city.q, city.r, oq, or) !== 2) return false;
        const t = tiles.get(tileKey(oq, or));
        if (!t || t.biome === 'water' || t.biome === 'mountain') return false;
        return enemyLandMilitaryAt(units, oq, or, city.ownerId);
      });
      if (!covered) return false;
    } else if (!enemyLandMilitaryAt(units, q, r, city.ownerId)) {
      return false;
    }
  }
  return true;
}

export function surroundedCityIds(
  cities: City[],
  tiles: Map<string, Tile>,
  units: Unit[],
  wallSections: WallSection[],
): Set<string> {
  const ids = new Set<string>();
  for (const city of cities) {
    if (isCitySurrounded(city, tiles, units, wallSections)) ids.add(city.id);
  }
  return ids;
}

/** Cities this unit may draw supply from. Isolated cities only feed units on/inside them. */
export function supplyCitiesForUnit(
  unit: Unit,
  playerCities: City[],
  isolatedIds: Set<string>,
): City[] {
  if (isolatedIds.size === 0) return playerCities;
  const inside = playerCities.find(
    c => isolatedIds.has(c.id) && hexDistance(unit.q, unit.r, c.q, c.r) <= 1,
  );
  if (inside) return [inside];
  return playerCities.filter(c => !isolatedIds.has(c.id));
}

function campMarch(
  city: City,
  camp: { q: number; r: number },
): {
  targetQ: number;
  targetR: number;
  siegingCityId: string;
  assaulting: false;
  rallyQ: number;
  rallyR: number;
  centerQ: number;
  centerR: number;
} {
  return {
    targetQ: camp.q,
    targetR: camp.r,
    siegingCityId: city.id,
    assaulting: false,
    rallyQ: camp.q,
    rallyR: camp.r,
    centerQ: city.q,
    centerR: city.r,
  };
}

/** March target + flags for the first wave of an attack-city order. */
export function getAttackMarchParams(
  attackStyle: AttackCityStyle,
  city: City,
  preferFromQ: number,
  preferFromR: number,
  tiles: Map<string, Tile>,
  wallSections: WallSection[] = [],
  moverId?: string,
): {
  targetQ: number;
  targetR: number;
  siegingCityId?: string;
  assaulting: boolean;
  rallyQ: number;
  rallyR: number;
  centerQ: number;
  centerR: number;
} {
  const cq = city.q;
  const cr = city.r;
  if (attackStyle === 'siege') {
    const ring = pickSiegeRallyHex(city, preferFromQ, preferFromR, tiles, wallSections, moverId);
    if (ring) return campMarch(city, ring);
    return {
      targetQ: cq,
      targetR: cr,
      assaulting: false,
      rallyQ: cq,
      rallyR: cr,
      centerQ: cq,
      centerR: cr,
    };
  }

  if (moverId && !cityHasWallBreach(city, tiles, wallSections, moverId)) {
    const camp = pickSiegeRallyHex(city, preferFromQ, preferFromR, tiles, wallSections, moverId);
    if (camp) return campMarch(city, camp);
  }

  if (attackStyle === 'direct') {
    return {
      targetQ: cq,
      targetR: cr,
      assaulting: false,
      rallyQ: cq,
      rallyR: cr,
      centerQ: cq,
      centerR: cr,
    };
  }
  return {
    targetQ: cq,
    targetR: cr,
    assaulting: true,
    rallyQ: cq,
    rallyR: cr,
    centerQ: cq,
    centerR: cr,
  };
}

function wallHexesCoveredFrom(
  city: City,
  fromQ: number,
  fromR: number,
  wallSections: WallSection[],
): string[] {
  if (hexDistance(fromQ, fromR, city.q, city.r) !== 2) return [];
  const covered: string[] = [];
  for (const [wq, wr] of hexNeighbors(city.q, city.r)) {
    if (!intactWallAt(wallSections, wq, wr)) continue;
    if (hexDistance(fromQ, fromR, wq, wr) === 1) covered.push(tileKey(wq, wr));
  }
  return covered;
}

function pickCoverAwareRing2(
  city: City,
  ring2: { q: number; r: number }[],
  preferFromQ: number,
  preferFromR: number,
  tiles: Map<string, Tile>,
  wallSections: WallSection[],
  moverId: string | undefined,
  avoidKeys?: Set<string>,
): { q: number; r: number } | null {
  const coveredWalls = new Set<string>();
  if (avoidKeys) {
    for (const key of avoidKeys) {
      const [oq, or] = parseTileKey(key);
      for (const w of wallHexesCoveredFrom(city, oq, or, wallSections)) coveredWalls.add(w);
    }
  }

  let best: { q: number; r: number; rank: number; d: number } | null = null;
  for (const { q, r } of ring2) {
    if (!isPassableCandidate(q, r, tiles, wallSections, moverId)) continue;
    const d = hexDistance(preferFromQ, preferFromR, q, r);
    const blocked = avoidKeys?.has(tileKey(q, r)) ?? false;
    const coversNew = wallHexesCoveredFrom(city, q, r, wallSections).some(k => !coveredWalls.has(k));
    const rank = (blocked ? 2 : 0) + (coversNew ? 0 : 1);
    if (!best || rank < best.rank || (rank === best.rank && d < best.d)) {
      best = { q, r, rank, d };
    }
  }
  return best ? { q: best.q, r: best.r } : null;
}

/**
 * Camp hex for a siege: prefer a passable ring-1 gap, else ring-2 outside the walls
 * (trebuchet range 3 / ram range 1 still reach ring-1 sections).
 * When `avoidKeys` is set, prefer empty hexes that cover a still-open wall approach.
 */
export function pickSiegeRallyHex(
  city: City,
  preferFromQ: number,
  preferFromR: number,
  tiles: Map<string, Tile>,
  wallSections: WallSection[] = [],
  moverId?: string,
  avoidKeys?: Set<string>,
): { q: number; r: number } | null {
  const ring1 = hexNeighbors(city.q, city.r).map(([q, r]) => ({ q, r }));
  const r1 = pickClosestPassable(ring1, preferFromQ, preferFromR, tiles, wallSections, moverId, avoidKeys);
  if (r1) return { q: r1.q, r: r1.r };

  const ring2 = getHexRing(city.q, city.r, 2);
  const r2 = pickCoverAwareRing2(city, ring2, preferFromQ, preferFromR, tiles, wallSections, moverId, avoidKeys);
  if (r2) return r2;

  let fallback: { q: number; r: number; d: number } | null = null;
  for (const { q, r } of [...ring1, ...ring2]) {
    const t = tiles.get(tileKey(q, r));
    if (!t || t.biome === 'water') continue;
    const d = hexDistance(preferFromQ, preferFromR, q, r);
    if (!fallback || d < fallback.d) fallback = { q, r, d };
  }
  return fallback ? { q: fallback.q, r: fallback.r } : null;
}

/** Where an army should march for a city: enter the center if a wall gap exists, else camp outside. */
export function pickCityApproachHex(
  city: City,
  fromQ: number,
  fromR: number,
  tiles: Map<string, Tile>,
  wallSections: WallSection[],
  moverId: string,
  avoidKeys?: Set<string>,
): { q: number; r: number; mode: 'enter' | 'camp' } {
  if (cityHasWallBreach(city, tiles, wallSections, moverId)) {
    return { q: city.q, r: city.r, mode: 'enter' };
  }
  const camp = pickSiegeRallyHex(city, fromQ, fromR, tiles, wallSections, moverId, avoidKeys);
  if (camp) return { q: camp.q, r: camp.r, mode: 'camp' };
  return { q: city.q, r: city.r, mode: 'enter' };
}

function sortLandMilitaryById(stackUnits: Unit[]): Unit[] {
  return stackUnits
    .filter(u => isLandMilitaryUnit(u) && u.hp > 0 && !u.aboardShipId)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** All land military units whose type is in `types`, stable order by id. */
export function unitIdsMatchingTypes(stackUnits: Unit[], types: UnitType[]): string[] {
  if (types.length === 0) return [];
  const set = new Set(types);
  return sortLandMilitaryById(stackUnits.filter(u => set.has(u.type))).map(u => u.id);
}

/** Pick up to `counts[type]` units per type, optionally skipping ids in `exclude`. */
export function selectUnitIdsByTypeCounts(
  stackUnits: Unit[],
  counts: Partial<Record<UnitType, number>>,
  exclude?: Set<string>,
): string[] {
  const picked: string[] = [];
  const types = Object.keys(counts) as UnitType[];
  for (const type of types) {
    const n = counts[type] ?? 0;
    if (n <= 0) continue;
    const candidates = sortLandMilitaryById(stackUnits.filter(u => u.type === type)).filter(
      u => !exclude?.has(u.id),
    );
    for (let i = 0; i < Math.min(n, candidates.length); i++) picked.push(candidates[i].id);
  }
  return picked;
}

function wave1Arrived(w: Unit | undefined, rallyQ: number, rallyR: number): boolean {
  if (!w || w.hp <= 0) return true;
  return hexDistance(w.q, w.r, rallyQ, rallyR) === 0;
}

/** When prior wave reaches the rally hex (or all gone), start next echelon movement to dest. */
export function releaseMarchEchelonHolds(units: Unit[], cities: City[]): void {
  const byId = new Map(units.map(u => [u.id, u]));
  for (const u of units) {
    const hold = u.marchEchelonHold;
    if (!hold || u.hp <= 0) continue;
    const released = hold.waitForUnitIds.every(wid => {
      const w = byId.get(wid);
      return wave1Arrived(w, hold.rallyQ, hold.rallyR);
    });
    if (!released) continue;

    delete u.marchEchelonHold;
    const deployed = withoutPatrolFields(withDeployFlags(u, hold.destQ, hold.destR, cities));
    Object.assign(u, {
      ...deployed,
      targetQ: hold.destQ,
      targetR: hold.destR,
      status: 'moving' as const,
      assaulting: false,
      marchInitialHexDistance: marchHexDistanceAtOrder(u, hold.destQ, hold.destR),
    });
    delete u.siegingCityId;
  }
}

/** When wave-1 units reach the rally (or die), start wave-2 movement. */
export function releaseAttackWaveHolds(units: Unit[], cities: City[]): void {
  const byId = new Map(units.map(u => [u.id, u]));
  for (const u of units) {
    const hold = u.attackWaveHold;
    if (!hold || u.hp <= 0) continue;
    const released = hold.waitForUnitIds.every(wid => {
      const w = byId.get(wid);
      return wave1Arrived(w, hold.rallyQ, hold.rallyR);
    });
    if (!released) continue;

    delete u.attackWaveHold;
    const camped = hold.rallyQ !== hold.centerQ || hold.rallyR !== hold.centerR;
    const isSiege = hold.attackStyle === 'siege' || camped;
    const targetQ = isSiege ? hold.rallyQ : hold.centerQ;
    const targetR = isSiege ? hold.rallyR : hold.centerR;
    const wantAssault = hold.attackStyle === 'assault' && !isSiege;

    const deployed = withoutPatrolFields(withDeployFlags(u, targetQ, targetR, cities));
    Object.assign(u, {
      ...deployed,
      targetQ,
      targetR,
      status: 'moving' as const,
      assaulting: wantAssault,
      marchInitialHexDistance: marchHexDistanceAtOrder(u, targetQ, targetR),
    });
    if (isSiege) u.siegingCityId = hold.cityId;
    else delete u.siegingCityId;
  }
}

export function countLandMilitaryByType(stackUnits: Unit[]): Partial<Record<UnitType, number>> {
  const out: Partial<Record<UnitType, number>> = {};
  for (const u of stackUnits) {
    if (!isLandMilitaryUnit(u) || u.hp <= 0 || u.aboardShipId) continue;
    out[u.type] = (out[u.type] ?? 0) + 1;
  }
  return out;
}
