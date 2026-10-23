/**
 * Empire troop cap: 1 living troop per 1 population (design §21–22).
 * Field trebuchets are troops. They are not drafted from a city, so they must
 * not carry originCityId — death and disband must not change city population.
 */

import type { City, Unit } from '@/types/game';
import { hexDistance } from '@/types/game';

export function reservedTroopSlots(
  livingTroops: number,
  pendingLandRecruits: number,
  fieldTrebuchetsInProgress: number,
): number {
  return livingTroops + pendingLandRecruits + fieldTrebuchetsInProgress;
}

/** True when another troop (recruit or field trebuchet) still fits under population. */
export function canReserveAnotherTroop(reserved: number, population: number): boolean {
  return reserved < population;
}

/**
 * A field trebuchet finishing this tick. `livingUnits` includes engines already
 * spawned earlier in the same tick. At the cap, cancel and refund instead of spawning.
 */
export function fieldTrebuchetCompletionAction(
  livingUnits: number,
  population: number,
): 'spawn' | 'refund' {
  return livingUnits < population ? 'spawn' : 'refund';
}

/** Field engine: a unit with no recruiting city. Death must not deduct population. */
export function makeFieldTrebuchetUnit(args: {
  id: string;
  q: number;
  r: number;
  ownerId: string;
  maxHp: number;
}): Unit {
  return {
    id: args.id,
    type: 'trebuchet',
    q: args.q,
    r: args.r,
    ownerId: args.ownerId,
    hp: args.maxHp,
    maxHp: args.maxHp,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
  };
}

/**
 * Return refined wood to the nearest city the player owns.
 * Does not clamp to storageCap — a refund must not disappear.
 */
export function refundRefinedWoodToNearestCity<T extends Pick<City, 'id' | 'ownerId' | 'q' | 'r' | 'storage'>>(
  cities: T[],
  ownerId: string,
  q: number,
  r: number,
  amount: number,
): T[] {
  if (amount <= 0) return cities;
  let nearest: T | null = null;
  let bestD = Infinity;
  for (const c of cities) {
    if (c.ownerId !== ownerId) continue;
    const d = hexDistance(c.q, c.r, q, r);
    if (d < bestD) {
      bestD = d;
      nearest = c;
    }
  }
  if (!nearest) return cities;
  const targetId = nearest.id;
  return cities.map(c =>
    c.id === targetId
      ? {
          ...c,
          storage: {
            ...c.storage,
            refinedWood: (c.storage.refinedWood ?? 0) + amount,
          },
        }
      : c,
  );
}
