/**
 * Side effects when a city changes owner: transfer local wall rings, cancel
 * in-progress city constructions, and strip fielded-troop population slots.
 */

import {
  getHexRing,
  tileKey,
  type City,
  type ConstructionSite,
  type Unit,
  type WallSection,
} from '@/types/game';
import { stripCapturedCityFieldedPopulation } from '@/lib/originCityPopulation';

/** Wall hexes that belong to a city (center + rings 1–2 used by wall builder). */
export function cityWallHexKeys(city: City): Set<string> {
  const keys = new Set<string>([tileKey(city.q, city.r)]);
  for (const ring of [1, 2] as const) {
    for (const { q, r } of getHexRing(city.q, city.r, ring)) {
      keys.add(tileKey(q, r));
    }
  }
  return keys;
}

/** Remap former-owner wall sections around the city to the capturer. */
export function transferCityWallSections(
  wallSections: WallSection[],
  city: City,
  previousOwnerId: string,
  newOwnerId: string,
): WallSection[] {
  if (previousOwnerId === newOwnerId) return wallSections;
  const keys = cityWallHexKeys(city);
  let changed = false;
  const next = wallSections.map(w => {
    if (w.ownerId !== previousOwnerId) return w;
    if (!keys.has(tileKey(w.q, w.r))) return w;
    changed = true;
    return { ...w, ownerId: newOwnerId };
  });
  return changed ? next : wallSections;
}

/** Drop construction sites tied to a captured city (walls/buildings/towers). */
export function cancelConstructionsForCity(
  constructions: ConstructionSite[],
  cityId: string,
): ConstructionSite[] {
  const next = constructions.filter(c => c.cityId !== cityId);
  return next.length === constructions.length ? constructions : next;
}

export type CityCaptureEffectsResult = {
  city: City;
  wallSections: WallSection[];
  constructions: ConstructionSite[];
};

/**
 * Apply ownership side effects for one captured city.
 * `city` should still reflect the previous owner (caller applies newOwnerId).
 */
export function applyCityCaptureEffects(args: {
  city: City;
  previousOwnerId: string;
  newOwnerId: string;
  units: readonly Unit[];
  wallSections: WallSection[];
  constructions: ConstructionSite[];
}): CityCaptureEffectsResult {
  const { city, previousOwnerId, newOwnerId, units, wallSections, constructions } = args;
  const stripped = stripCapturedCityFieldedPopulation(city, units, previousOwnerId);
  return {
    city: { ...stripped, ownerId: newOwnerId },
    wallSections: transferCityWallSections(wallSections, city, previousOwnerId, newOwnerId),
    constructions: cancelConstructionsForCity(constructions, city.id),
  };
}
