/**
 * Land unit recruits that complete after a cycle delay (parity: useGameStore + gameCore).
 */

import {
  type City,
  type Unit,
  type UnitType,
  generateId,
  getUnitStats,
  isNavalUnitType,
  type RangedVariant,
} from '@/types/game';
import { marchHexDistanceAtOrder } from '@/lib/garrison';

export type PendingLandRecruit = {
  id: string;
  playerId: string;
  cityId: string;
  type: UnitType;
  effectiveArmsLevel: 1 | 2 | 3;
  rangedVariant?: RangedVariant;
  spawnQ: number;
  spawnR: number;
  completesAtCycle: number;
  stackId?: string;
  moveToRallyAfterSpawn?: { q: number; r: number };
};

/** Spawn a unit from a pending land recruit (matches useGameStore behavior). */
export function spawnUnitFromPendingLand(item: PendingLandRecruit, cities: City[]): Unit | null {
  if (item.type === 'builder') return null;
  const city = cities.find(c => c.id === item.cityId);
  if (!city) return null;
  const rv =
    item.type === 'ranged' && item.effectiveArmsLevel === 3
      ? (item.rangedVariant ?? 'marksman')
      : undefined;
  const stats = getUnitStats({
    type: item.type,
    armsLevel: item.effectiveArmsLevel,
    rangedVariant: rv,
  });
  const u: Unit = {
    id: generateId('unit'),
    type: item.type,
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
  };
  if (item.effectiveArmsLevel === 2 && item.type !== 'defender') u.armsLevel = 2;
  if (item.effectiveArmsLevel === 3 || item.type === 'defender') u.armsLevel = 3;
  if (item.type === 'ranged' && item.effectiveArmsLevel === 3) {
    u.rangedVariant = rv;
  }
  if (item.stackId) u.stackId = item.stackId;
  if (item.moveToRallyAfterSpawn) {
    const rq = item.moveToRallyAfterSpawn.q;
    const rr = item.moveToRallyAfterSpawn.r;
    u.targetQ = rq;
    u.targetR = rr;
    u.status = 'moving';
    u.marchInitialHexDistance = marchHexDistanceAtOrder(u, rq, rr);
  } else if (!isNavalUnitType(item.type)) {
    u.garrisonCityId = city.id;
    u.defendCityId = city.id;
  }
  return u;
}
