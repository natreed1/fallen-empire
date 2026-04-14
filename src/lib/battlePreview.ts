/**
 * Battle UI helpers: cluster nearby contested hexes and estimate outlook from HP + morale.
 */

import { hexDistance, tileKey, type Unit } from '@/types/game';
import type { MoraleState } from '@/lib/combat';
import { getStackMorale } from '@/lib/combat';

/** Max axial distance between a human stack hex and an enemy stack hex to show battle UI (not same tile). */
export const NEARBY_OPPOSITION_MAX_HEX = 8;

/**
 * Groups hexes into separate engagements: same-hex multi-faction fights, plus human vs enemy stacks
 * within `NEARBY_OPPOSITION_MAX_HEX` (so approaching armies still get a battle icon before merging).
 */
export function clusterHumanBattleEngagements(units: Unit[]): string[][] {
  const byHex: Record<string, Unit[]> = {};
  for (const u of units) {
    if (u.hp <= 0 || u.aboardShipId) continue;
    const k = tileKey(u.q, u.r);
    if (!byHex[k]) byHex[k] = [];
    byHex[k].push(u);
  }

  const parent = new Map<string, string>();
  const ensure = (k: string) => {
    if (!parent.has(k)) parent.set(k, k);
  };
  const find = (k: string): string => {
    ensure(k);
    const p = parent.get(k)!;
    if (p !== k) {
      const r = find(p);
      parent.set(k, r);
      return r;
    }
    return k;
  };
  const unionKeys = (a: string, b: string) => {
    ensure(a);
    ensure(b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const involved = new Set<string>();

  for (const [k, arr] of Object.entries(byHex)) {
    const owners = new Set(arr.map(u => u.ownerId));
    if (owners.size < 2) continue;
    if (![...owners].some(o => o.includes('human'))) continue;
    involved.add(k);
    ensure(k);
  }

  type StackRef = { key: string; q: number; r: number };
  const humanOnly: StackRef[] = [];
  const enemyOnly: StackRef[] = [];
  for (const [k, arr] of Object.entries(byHex)) {
    const owners = new Set(arr.map(u => u.ownerId));
    if (owners.size >= 2) continue;
    const hasHuman = [...owners].some(o => o.includes('human'));
    const hasEnemy = [...owners].some(o => !o.includes('human'));
    const u0 = arr[0]!;
    if (hasHuman && !hasEnemy) humanOnly.push({ key: k, q: u0.q, r: u0.r });
    if (hasEnemy && !hasHuman) enemyOnly.push({ key: k, q: u0.q, r: u0.r });
  }

  for (const h of humanOnly) {
    for (const e of enemyOnly) {
      if (hexDistance(h.q, h.r, e.q, e.r) <= NEARBY_OPPOSITION_MAX_HEX) {
        unionKeys(h.key, e.key);
        involved.add(h.key);
        involved.add(e.key);
      }
    }
  }

  const byRoot = new Map<string, string[]>();
  for (const k of involved) {
    const r = find(k);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r)!.push(k);
  }
  return [...byRoot.values()];
}

export function humanBattleHexKeysFlat(units: Unit[]): string[] {
  return clusterHumanBattleEngagements(units).flat();
}

export function battleClusterContainingHex(units: Unit[], hexKey: string | null): string[] {
  if (!hexKey) return [];
  for (const c of clusterHumanBattleEngagements(units)) {
    if (c.includes(hexKey)) return c;
  }
  return [hexKey];
}

/** Group hex keys when every pair in a group is connected by edges of distance ≤ maxHexDist (union-find). */
export function clusterBattleHexKeys(hexKeys: string[], maxHexDist: number): string[][] {
  if (hexKeys.length === 0) return [];
  const n = hexKeys.length;
  const parent = hexKeys.map((_, i) => i);
  const find = (i: number): number => {
    if (parent[i] !== i) parent[i] = find(parent[i]);
    return parent[i];
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  const parse = (k: string) => k.split(',').map(Number) as [number, number];
  for (let i = 0; i < n; i++) {
    const [q1, r1] = parse(hexKeys[i]!);
    for (let j = i + 1; j < n; j++) {
      const [q2, r2] = parse(hexKeys[j]!);
      if (hexDistance(q1, r1, q2, r2) <= maxHexDist) union(i, j);
    }
  }
  const groups = new Map<number, string[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(hexKeys[i]!);
  }
  return [...groups.values()];
}

export type LikelyWinnerLean = 'you' | 'enemy' | 'tossup';

export function likelyWinnerForHumanBattle(
  units: Unit[],
  hexKeys: string[],
  moraleState: MoraleState,
): { label: string; lean: LikelyWinnerLean; pctYou: number } {
  const hexSet = new Set(hexKeys);
  let sumYou = 0;
  let sumEn = 0;
  let yourOwner: string | undefined;
  let enemyOwner: string | undefined;

  for (const u of units) {
    if (u.hp <= 0 || u.aboardShipId) continue;
    if (!hexSet.has(tileKey(u.q, u.r))) continue;
    const hp = Math.max(0, u.hp);
    if (u.ownerId.includes('human')) {
      sumYou += hp;
      yourOwner ??= u.ownerId;
    } else {
      sumEn += hp;
      enemyOwner ??= u.ownerId;
    }
  }

  const avgM = (owner: string | undefined) => {
    if (!owner || hexKeys.length === 0) return 100;
    let s = 0;
    for (const hk of hexKeys) {
      s += getStackMorale(moraleState, hk, owner);
    }
    return s / hexKeys.length;
  };

  const my = avgM(yourOwner);
  const me = avgM(enemyOwner);
  const effYou = sumYou * (my / 100);
  const effEn = sumEn * (me / 100);
  const total = effYou + effEn;
  const pctYou = total > 0 ? Math.round((100 * effYou) / total) : 50;

  let lean: LikelyWinnerLean = 'tossup';
  let label = 'Too close to call';
  if (pctYou >= 58) {
    lean = 'you';
    label = 'Likely: You';
  } else if (pctYou <= 42) {
    lean = 'enemy';
    label = 'Likely: Enemy';
  }

  return { label, lean, pctYou };
}
