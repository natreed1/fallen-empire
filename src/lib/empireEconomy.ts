/**
 * Empire-wide economy helpers (no trade clusters).
 * Resources pool per player; military upkeep draws from all of that player's cities
 * when the unit is within SUPPLY_VICINITY_RADIUS of any friendly city.
 */

import { City, Unit, Tile, TerritoryInfo, hexDistance, SUPPLY_VICINITY_RADIUS, isNavalUnitType } from '@/types/game';

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

/**
 * Passive per-cycle HP regen is only for land military that are in supply.
 * Cut-off / starving units must not heal — otherwise 4% regen cancels the 5% upkeep HP loss
 * for many unit sizes (e.g. L1 ranged 50 HP, L1 cavalry 75 HP).
 */
export function unitReceivesPassiveHpRegen(unit: Unit, playerCities: City[]): boolean {
  if (unit.hp <= 0 || unit.hp >= unit.maxHp) return false;
  if (unit.aboardShipId || isNavalUnitType(unit.type) || unit.type === 'builder') return false;
  if (unit.status === 'fighting' || unit.status === 'starving') return false;
  return playerCities.length > 0 && isUnitInSupplyVicinityOfPlayerCities(unit, playerCities);
}

export type PooledStorageResource = 'food' | 'goods' | 'guns' | 'gunsL2';

/**
 * Deduct a pooled resource from the player's cities in proportion to current stock.
 * Greedy first-city drain empties the capital every cycle once empire demand exceeds
 * that city's storage, which then falsely trips per-city starvation / local pay checks.
 */
export function deductPooledStorage(
  cities: City[],
  resource: PooledStorageResource,
  amount: number,
): void {
  if (amount <= 0 || cities.length === 0) return;
  const total = cities.reduce((s, c) => s + (c.storage[resource] ?? 0), 0);
  if (total <= 0) return;
  if (amount >= total) {
    for (const city of cities) city.storage[resource] = 0;
    return;
  }
  const takes = cities.map(city => {
    const avail = city.storage[resource] ?? 0;
    return Math.floor(amount * (avail / total));
  });
  let remaining = amount - takes.reduce((s, n) => s + n, 0);
  for (let i = 0; i < cities.length && remaining > 0; i++) {
    const leftover = (cities[i].storage[resource] ?? 0) - takes[i];
    if (leftover <= 0) continue;
    const extra = Math.min(leftover, remaining);
    takes[i] += extra;
    remaining -= extra;
  }
  for (let i = 0; i < cities.length; i++) {
    cities[i].storage[resource] = Math.max(0, (cities[i].storage[resource] ?? 0) - takes[i]);
  }
}
