/**
 * Empire-wide L2 arms (gunsL2) helpers for recruit upkeep.
 * Validation sums across owned cities; deduction must match that model.
 */

import type { City } from '@/types/game';

export function totalGunsL2ForOwner(cities: City[], ownerId: string): number {
  return cities
    .filter(c => c.ownerId === ownerId)
    .reduce((sum, c) => sum + (c.storage.gunsL2 ?? 0), 0);
}

/**
 * Greedily deduct `amount` gunsL2 from cities owned by `ownerId`.
 * Returns a new cities array, or null if the owner cannot cover the full amount.
 */
export function deductGunsL2AcrossCities(
  cities: City[],
  ownerId: string,
  amount: number,
): City[] | null {
  if (amount <= 0) return cities;
  if (totalGunsL2ForOwner(cities, ownerId) < amount) return null;

  let remaining = amount;
  return cities.map(c => {
    if (c.ownerId !== ownerId || remaining <= 0) return c;
    const have = c.storage.gunsL2 ?? 0;
    if (have <= 0) return c;
    const take = Math.min(have, remaining);
    remaining -= take;
    return {
      ...c,
      storage: {
        ...c.storage,
        gunsL2: have - take,
      },
    };
  });
}
