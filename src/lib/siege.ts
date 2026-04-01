import {
  AttackCityStyle,
  City,
  Tile,
  Unit,
  UnitType,
  hexDistance,
  hexNeighbors,
  tileKey,
} from '@/types/game';
import { withDeployFlags, isLandMilitaryUnit, marchHexDistanceAtOrder } from '@/lib/garrison';

/** March target + flags for the first wave of an attack-city order. */
export function getAttackMarchParams(
  attackStyle: AttackCityStyle,
  city: City,
  preferFromQ: number,
  preferFromR: number,
  tiles: Map<string, Tile>,
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
    const ring = pickSiegeRallyHex(city, preferFromQ, preferFromR, tiles);
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

/** Land approach hex adjacent to city center (for encirclement / camp). */
export function pickSiegeRallyHex(
  city: City,
  preferFromQ: number,
  preferFromR: number,
  tiles: Map<string, Tile>,
): { q: number; r: number } | null {
  const neigh = hexNeighbors(city.q, city.r);
  let best: { q: number; r: number; d: number } | null = null;
  for (const [nq, nr] of neigh) {
    const t = tiles.get(tileKey(nq, nr));
    if (!t || t.biome === 'water') continue;
    const d = hexDistance(preferFromQ, preferFromR, nq, nr);
    if (!best || d < best.d) best = { q: nq, r: nr, d };
  }
  return best ? { q: best.q, r: best.r } : null;
}

function sortLandMilitaryById(stackUnits: Unit[]): Unit[] {
  return stackUnits
    .filter(u => isLandMilitaryUnit(u) && u.hp > 0 && !u.aboardShipId)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
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

    const deployed = withDeployFlags(u, targetQ, targetR, cities);
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
