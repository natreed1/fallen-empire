/**
 * Population tracks living troops by origin city (design §21–22):
 * recruit does not spend pop; death reduces origin-city pop; disband returns it.
 * After a city changes hands, only the current owner may lose/gain that city's pop.
 */

import type { City, Unit } from '@/types/game';

/** Living units still charged against a city's population (same owner + origin). */
export function countLivingOriginUnitsForCity(
  units: readonly Unit[],
  cityId: string,
  ownerId: string,
): number {
  let n = 0;
  for (const u of units) {
    if (u.hp > 0 && u.originCityId === cityId && u.ownerId === ownerId) n += 1;
  }
  return n;
}

/**
 * On capture, strip population slots that still represent the former owner's
 * living fielded troops so the capturer does not inherit inflated troop capacity.
 */
export function stripCapturedCityFieldedPopulation(
  city: City,
  units: readonly Unit[],
  previousOwnerId: string,
): City {
  const fielded = countLivingOriginUnitsForCity(units, city.id, previousOwnerId);
  if (fielded <= 0) return city;
  return { ...city, population: Math.max(0, city.population - fielded) };
}

/** Apply death pop loss only while the origin city remains owned by the unit's owner. */
export function applyOriginCityPopulationDeath(
  cities: City[],
  deadUnits: readonly Unit[],
): City[] {
  const cityById = new Map(cities.map(c => [c.id, c]));
  const popDeductByCityId: Record<string, number> = {};
  for (const u of deadUnits) {
    if (!u.originCityId) continue;
    const city = cityById.get(u.originCityId);
    if (!city || city.ownerId !== u.ownerId) continue;
    popDeductByCityId[u.originCityId] = (popDeductByCityId[u.originCityId] ?? 0) + 1;
  }
  if (Object.keys(popDeductByCityId).length === 0) return cities;
  return cities.map(c => {
    const deduct = popDeductByCityId[c.id] ?? 0;
    return deduct > 0 ? { ...c, population: Math.max(0, c.population - deduct) } : c;
  });
}

/** Return disbanded troops to origin cities only while still owned by the unit's owner. */
export function applyOriginCityPopulationReturn(
  cities: City[],
  disbandedUnits: readonly Unit[],
): City[] {
  const cityById = new Map(cities.map(c => [c.id, c]));
  const popByCity: Record<string, number> = {};
  for (const u of disbandedUnits) {
    if (!u.originCityId) continue;
    const city = cityById.get(u.originCityId);
    if (!city || city.ownerId !== u.ownerId) continue;
    popByCity[u.originCityId] = (popByCity[u.originCityId] ?? 0) + 1;
  }
  if (Object.keys(popByCity).length === 0) return cities;
  return cities.map(c => {
    const add = popByCity[c.id] ?? 0;
    return add > 0 ? { ...c, population: c.population + add } : c;
  });
}
