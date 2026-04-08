/**
 * Empire-wide economy helpers (no trade clusters).
 * Resources pool per player; military upkeep draws from all of that player's cities
 * when the unit is within SUPPLY_VICINITY_RADIUS of any friendly city.
 */

import { City, Unit, Tile, TerritoryInfo, hexDistance, SUPPLY_VICINITY_RADIUS } from '@/types/game';

/** Incorporated neutral villages in this player's territory (all cities). */
export function countVillagesInPlayerTerritory(
  playerId: string,
  cities: City[],
  territory: Map<string, TerritoryInfo>,
  tiles: Map<string, Tile>,
): number {
  const cityOwner = new Map(cities.map(c => [c.id, c.ownerId]));
  let n = 0;
  for (const [key, info] of territory) {
    if (cityOwner.get(info.cityId) !== playerId) continue;
    const tile = tiles.get(key);
    if (tile?.hasVillage) n += 1;
  }
  return n;
}

/** True if the unit is in resupply range of any friendly city (owner match). */
export function isUnitInSupplyVicinityOfPlayerCities(unit: Unit, playerCities: City[]): boolean {
  for (const city of playerCities) {
    if (hexDistance(unit.q, unit.r, city.q, city.r) <= SUPPLY_VICINITY_RADIUS) return true;
  }
  return false;
}
