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

function pickClosestPassable(
  hexes: { q: number; r: number }[],
  preferFromQ: number,
  preferFromR: number,
  tiles: Map<string, Tile>,
  wallSections: WallSection[],
  moverId: string | undefined,
): { q: number; r: number; d: number } | null {
  let best: { q: number; r: number; d: number } | null = null;
  for (const { q, r } of hexes) {
    if (moverId) {
      if (!isLandApproachHex(tiles, wallSections, q, r, moverId)) continue;
    } else {
      const t = tiles.get(tileKey(q, r));
      if (!t || t.biome === 'water') continue;
    }
    const d = hexDistance(preferFromQ, preferFromR, q, r);
    if (!best || d < best.d) best = { q, r, d };
  }
  return best;
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
    if (ring) {
      return {
        targetQ: ring.q,
        targetR: ring.r,
        siegingCityId: city.id,
        assaulting: false,
        rallyQ: ring.q,
        rallyR: ring.r,
        centerQ: cq,
        centerR: cr,
      };
    }
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

/**
 * Camp hex for a siege: prefer a passable ring-1 gap, else ring-2 outside the walls
 * (trebuchet range 3 / ram range 1 still reach ring-1 sections).
 */
export function pickSiegeRallyHex(
  city: City,
  preferFromQ: number,
  preferFromR: number,
  tiles: Map<string, Tile>,
  wallSections: WallSection[] = [],
  moverId?: string,
): { q: number; r: number } | null {
  const ring1 = hexNeighbors(city.q, city.r).map(([q, r]) => ({ q, r }));
  const r1 = pickClosestPassable(ring1, preferFromQ, preferFromR, tiles, wallSections, moverId);
  if (r1) return { q: r1.q, r: r1.r };

  const ring2 = getHexRing(city.q, city.r, 2);
  const r2 = pickClosestPassable(ring2, preferFromQ, preferFromR, tiles, wallSections, moverId);
  if (r2) return { q: r2.q, r: r2.r };

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
): { q: number; r: number; mode: 'enter' | 'camp' } {
  if (cityHasWallBreach(city, tiles, wallSections, moverId)) {
    return { q: city.q, r: city.r, mode: 'enter' };
  }
  const camp = pickSiegeRallyHex(city, fromQ, fromR, tiles, wallSections, moverId);
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
    const isSiege = hold.attackStyle === 'siege';
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
