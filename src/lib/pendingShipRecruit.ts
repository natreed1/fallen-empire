/**
 * Ship recruits that complete after one cycle delay (parity: useGameStore + gameCore).
 */

import { type City, type Unit, generateId, getUnitStats, getShipMaxCargo } from '@/types/game';
import type { PendingLandRecruit } from '@/lib/pendingLandRecruit';

export type PendingShipRecruit = {
  id: string;
  playerId: string;
  cityId: string;
  shipType: 'scout_ship' | 'warship' | 'transport_ship' | 'fisher_transport' | 'capital_ship';
  spawnQ: number;
  spawnR: number;
  completesAtCycle: number;
};

export function spawnUnitFromPendingShip(item: PendingShipRecruit, cities: City[]): Unit | null {
  if (!cities.some(c => c.id === item.cityId)) return null;
  const cap = getShipMaxCargo(item.shipType);
  const stats = getUnitStats({ type: item.shipType });
  return {
    id: generateId('unit'),
    type: item.shipType,
    q: item.spawnQ,
    r: item.spawnR,
    ownerId: item.playerId,
    hp: stats.maxHp,
    maxHp: stats.maxHp,
    xp: 0,
    level: 0,
    status: 'idle',
    stance: 'aggressive',
    nextMoveAt: 0,
    originCityId: item.cityId,
    cargoUnitIds: cap > 0 ? [] : undefined,
  };
}

export type SimPendingRecruit = PendingLandRecruit | PendingShipRecruit;

export function isPendingShipRecruit(pr: SimPendingRecruit): pr is PendingShipRecruit {
  return 'shipType' in pr;
}
