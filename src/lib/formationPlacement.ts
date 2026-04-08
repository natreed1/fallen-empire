import type { Tile, TerritoryInfo, Unit } from '@/types/game';
import { tileKey, isNavalUnitType } from '@/types/game';
import { isWithinPlayerMoveOrderRange } from '@/lib/territory';
import type { SiegeTacticId } from '@/lib/siegeTactics';

/** Six axial directions from origin, index order matches clockwise sweep from +q. */
export const AXIAL_DIRS: [number, number][] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

function axialToCube(q: number, r: number) {
  return { x: q, y: -q - r, z: r };
}

function cubeToAxial(c: { x: number; y: number; z: number }) {
  return { q: c.x, r: c.z };
}

function cubeAdd(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scaleCube(c: { x: number; y: number; z: number }, s: number) {
  return { x: c.x * s, y: c.y * s, z: c.z * s };
}

function dirCube(i: number) {
  const [dq, dr] = AXIAL_DIRS[i % 6];
  return axialToCube(dq, dr);
}

/** Integer steps along forward (axis `forwardIdx`) and 60° right of it. */
export function offsetFromForwardRight(forwardIdx: number, a: number, b: number): { dq: number; dr: number } {
  const fc = dirCube(forwardIdx);
  const rc = dirCube((forwardIdx + 1) % 6);
  const sum = cubeAdd(scaleCube(fc, a), scaleCube(rc, b));
  const ar = cubeToAxial(sum);
  return { dq: ar.q, dr: ar.r };
}

/** Hex direction best aligned with vector from start → destination (march axis). */
export function nearestForwardDirection(fromQ: number, fromR: number, toQ: number, toR: number): number {
  const dq = toQ - fromQ;
  const dr = toR - fromR;
  if (dq === 0 && dr === 0) return 0;
  const vc = axialToCube(dq, dr);
  let best = 0;
  let bestDot = -Infinity;
  for (let i = 0; i < 6; i++) {
    const dc = dirCube(i);
    const dot = vc.x * dc.x + vc.y * dc.y + vc.z * dc.z;
    if (dot > bestDot) {
      bestDot = dot;
      best = i;
    }
  }
  return best;
}

function dedupeLocal(pairs: { a: number; b: number }[]): { a: number; b: number }[] {
  const seen = new Set<string>();
  const out: { a: number; b: number }[] = [];
  for (const p of pairs) {
    const k = `${p.a},${p.b}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/** Scale spread: width/depth sliders 1–5 → modest integer stretch. */
function scaleAb(a: number, b: number, width: number, depth: number): { a: number; b: number } {
  const w = Math.max(1, Math.min(5, Math.round(width)));
  const d = Math.max(1, Math.min(5, Math.round(depth)));
  const wa = 0.75 + w * 0.25;
  const da = 0.75 + d * 0.25;
  return { a: Math.round(a * da), b: Math.round(b * wa) };
}

/**
 * Ordered local (forward, right) offsets: anchor first, then preset-shaped rings.
 * Forward = toward enemy along march axis; anchor (0,0) = objective hex.
 */
function localOffsetsForPreset(preset: SiegeTacticId, width: number, depth: number, need: number): { a: number; b: number }[] {
  const raw: { a: number; b: number }[] = [];

  const push = (a: number, b: number) => {
    raw.push(scaleAb(a, b, width, depth));
  };

  push(0, 0);

  if (preset === 'boxed') {
    const box: [number, number][] = [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
      [2, 0],
      [-2, 0],
      [2, 1],
      [2, -1],
      [-2, 1],
      [-2, -1],
      [1, 2],
      [1, -2],
      [-1, 2],
      [-1, -2],
      [0, 2],
      [0, -2],
      [2, 2],
      [2, -2],
      [-2, 2],
      [-2, -2],
    ];
    for (const [a, b] of box) push(a, b);
  } else if (preset === 'winged') {
    // Strong lateral spread (wings) + center line
    push(1, 0);
    push(1, 1);
    push(1, -1);
    for (let f = 2; f <= 8; f++) {
      push(f, 0);
      push(f, f);
      push(f, -f);
      push(f, f - 1);
      push(f, -(f - 1));
    }
    for (let b = -6; b <= 6; b++) {
      if (b !== 0) push(0, b);
    }
  } else {
    // classic_four: depth forward + echelon lines
    for (let f = 1; f <= 8; f++) {
      push(f, 0);
      push(f, 1);
      push(f, -1);
      if (f >= 2) {
        push(f, 2);
        push(f, -2);
      }
    }
    for (let b = -4; b <= 4; b++) {
      if (b !== 0) push(0, b);
    }
    for (let f = -2; f <= -1; f++) {
      push(f, 0);
    }
  }

  const merged = dedupeLocal(raw);
  // Anchor must stay first — pull (0,0) after dedupe scaling
  const zero = merged.findIndex(p => p.a === 0 && p.b === 0);
  if (zero > 0) {
    const z = merged.splice(zero, 1)[0]!;
    merged.unshift(z);
  } else if (zero < 0) {
    merged.unshift({ a: 0, b: 0 });
  }

  return merged.slice(0, Math.max(need, merged.length));
}

/** Infantry / defender types preferred to hold the objective hex (anchor). */
function anchorSortKey(u: Unit): number {
  if (u.type === 'defender' || u.type === 'infantry') return 0;
  if (u.type === 'crusader_knight') return 1;
  if (u.type === 'ranged') return 2;
  if (u.type === 'cavalry' || u.type === 'horse_archer') return 3;
  if (u.type === 'trebuchet' || u.type === 'battering_ram') return 4;
  if (u.type === 'builder') return 5;
  return 2;
}

function sortUnitsForFormationSlots(units: Unit[]): Unit[] {
  return [...units].sort((a, b) => {
    const ka = anchorSortKey(a);
    const kb = anchorSortKey(b);
    if (ka !== kb) return ka - kb;
    return a.id.localeCompare(b.id);
  });
}

function isLandPassable(tile: Tile | undefined): boolean {
  if (!tile) return false;
  return tile.biome !== 'water';
}

export type FormationAssignResult = {
  assignments: Map<string, { q: number; r: number }>;
  /** True if every land military unit got a non-anchor hex when count > 1 (best-effort). */
  usedSpatial: boolean;
};

/**
 * Assign each marching land unit a target hex around `anchorQ/R` so the anchor hex
 * holds the formation center; other slots follow the preset in march-forward space.
 */
export function assignSpatialFormationTargets(
  anchorQ: number,
  anchorR: number,
  fromQ: number,
  fromR: number,
  marching: Unit[],
  preset: SiegeTacticId,
  width: number,
  depth: number,
  tiles: Map<string, Tile>,
  territory: Map<string, TerritoryInfo>,
  playerId: string,
): FormationAssignResult {
  const toPlace = marching.filter(u => u.hp > 0 && !isNavalUnitType(u.type));
  const assignments = new Map<string, { q: number; r: number }>();
  if (toPlace.length === 0) return { assignments, usedSpatial: false };
  if (toPlace.length === 1) {
    assignments.set(toPlace[0]!.id, { q: anchorQ, r: anchorR });
    return { assignments, usedSpatial: false };
  }

  const forwardIdx = nearestForwardDirection(fromQ, fromR, anchorQ, anchorR);
  const locals = localOffsetsForPreset(preset, width, depth, toPlace.length);
  const orderedUnits = sortUnitsForFormationSlots(toPlace);

  const usedHex = new Set<string>();

  const tryPlace = (q: number, r: number): boolean => {
    const k = tileKey(q, r);
    if (usedHex.has(k)) return false;
    const tile = tiles.get(k);
    if (!isLandPassable(tile)) return false;
    if (!isWithinPlayerMoveOrderRange(fromQ, fromR, q, r, territory, playerId)) return false;
    usedHex.add(k);
    return true;
  };

  let spatialExtras = 0;
  for (const u of orderedUnits) {
    let placed = false;
    for (const loc of locals) {
      const { dq, dr } = offsetFromForwardRight(forwardIdx, loc.a, loc.b);
      const q = anchorQ + dq;
      const r = anchorR + dr;
      if (tryPlace(q, r)) {
        assignments.set(u.id, { q, r });
        if (dq !== 0 || dr !== 0) spatialExtras++;
        placed = true;
        break;
      }
    }

    if (!placed) {
      let fallback: { q: number; r: number } | null = null;
      for (let ring = 0; ring <= 6 && !fallback; ring++) {
        for (let dq = -ring; dq <= ring; dq++) {
          for (let dr = -ring; dr <= ring; dr++) {
            if (ring > 0 && Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr)) !== ring) continue;
            const q = anchorQ + dq;
            const r = anchorR + dr;
            const tile = tiles.get(tileKey(q, r));
            if (!isLandPassable(tile)) continue;
            if (!isWithinPlayerMoveOrderRange(fromQ, fromR, q, r, territory, playerId)) continue;
            const k = tileKey(q, r);
            if (usedHex.has(k)) continue;
            fallback = { q, r };
            break;
          }
        }
      }
      if (fallback) {
        usedHex.add(tileKey(fallback.q, fallback.r));
        assignments.set(u.id, fallback);
        if (fallback.q !== anchorQ || fallback.r !== anchorR) spatialExtras++;
      } else {
        assignments.set(u.id, { q: anchorQ, r: anchorR });
      }
    }
  }

  const usedSpatial = toPlace.length > 1 && spatialExtras > 0;
  return { assignments, usedSpatial };
}
