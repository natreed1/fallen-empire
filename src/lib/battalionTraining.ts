/**
 * HoI-style battalion training: time + tier-1/tier-2 arms delivered from empire pools over cycles.
 */

import {
  getUnitPopCost,
  type Unit,
  type City,
  type UnitType,
  BATTALION_TRAINING_CYCLES_L1,
  BATTALION_TRAINING_CYCLES_L2,
  BATTALION_TRAINING_CYCLES_L3,
  trainingQuotaGuns,
  trainingQuotaGunsL2,
} from '@/types/game';
import type { PendingLandRecruit } from '@/lib/pendingLandRecruit';

/** Training-time fields for a land recruit (HoI-style). */
export function buildBattalionTrainingFields(
  _type: UnitType,
  effectiveArmsLevel: 1 | 2 | 3,
  popCost: number,
): Pick<
  PendingLandRecruit,
  | 'trainingCyclesTotal'
  | 'trainingCyclesElapsed'
  | 'gunsRequired'
  | 'gunsDelivered'
  | 'gunsL2Required'
  | 'gunsL2Delivered'
  | 'completesAtCycle'
  | 'popCost'
> {
  const pc = popCost;
  if (effectiveArmsLevel === 1) {
    return {
      trainingCyclesTotal: BATTALION_TRAINING_CYCLES_L1,
      trainingCyclesElapsed: 0,
      gunsRequired: trainingQuotaGuns(pc),
      gunsDelivered: 0,
      gunsL2Required: 0,
      gunsL2Delivered: 0,
      completesAtCycle: Number.MAX_SAFE_INTEGER,
      popCost: pc,
    };
  }
  if (effectiveArmsLevel === 2) {
    return {
      trainingCyclesTotal: BATTALION_TRAINING_CYCLES_L2,
      trainingCyclesElapsed: 0,
      gunsRequired: trainingQuotaGuns(pc),
      gunsDelivered: 0,
      gunsL2Required: trainingQuotaGunsL2(pc),
      gunsL2Delivered: 0,
      completesAtCycle: Number.MAX_SAFE_INTEGER,
      popCost: pc,
    };
  }
  return {
    trainingCyclesTotal: BATTALION_TRAINING_CYCLES_L3,
    trainingCyclesElapsed: 0,
    gunsRequired: 0,
    gunsDelivered: 0,
    gunsL2Required: trainingQuotaGunsL2(Math.max(2, Math.ceil(pc * 1.2))),
    gunsL2Delivered: 0,
    completesAtCycle: Number.MAX_SAFE_INTEGER,
    popCost: pc,
  };
}

/** Weighted population used by living units + land training orders + queued ships for one player. */
export function computeEmpirePopUsedForPlayer(
  units: Unit[],
  pendingMixed: unknown[],
  playerId: string,
): number {
  let sum = 0;
  for (const u of units) {
    if (u.ownerId !== playerId || u.hp <= 0) continue;
    sum += getUnitPopCost(u.type);
  }
  for (const pr of pendingMixed) {
    if (typeof pr !== 'object' || pr === null) continue;
    const o = pr as { playerId?: string; shipType?: UnitType };
    if (o.playerId !== playerId) continue;
    if (o.shipType != null) {
      sum += getUnitPopCost(o.shipType);
      continue;
    }
    if (landPending(pr)) {
      const p = pr as PendingLandRecruit;
      sum += p.popCost ?? getUnitPopCost(p.type);
    }
  }
  return sum;
}

export function landPending(pr: unknown): pr is PendingLandRecruit {
  return (
    typeof pr === 'object' &&
    pr !== null &&
    'effectiveArmsLevel' in pr &&
    !('shipType' in pr) &&
    !('commanderSeed' in pr)
  );
}

/** Pull up to `amount` from pooled city storage for one player (FIFO by city order). */
export function takeFromEmpirePool(
  cities: City[],
  playerId: string,
  resource: 'guns' | 'gunsL2',
  amount: number,
): number {
  let remaining = amount;
  const playerCities = cities.filter(c => c.ownerId === playerId);
  for (const c of playerCities) {
    if (remaining <= 0) break;
    const avail = (c.storage[resource] ?? 0) as number;
    const take = Math.min(avail, remaining);
    if (take > 0) {
      c.storage = { ...c.storage, [resource]: avail - take };
      remaining -= take;
    }
  }
  return amount - remaining;
}

/** Return arms allocated to a cancelled order back to empire pools (FIFO fill first cities). */
export function returnArmsToEmpirePool(
  cities: City[],
  playerId: string,
  resource: 'guns' | 'gunsL2',
  amount: number,
): void {
  if (amount <= 0) return;
  const playerCities = cities.filter(c => c.ownerId === playerId);
  if (playerCities.length === 0) return;
  let left = amount;
  for (const c of playerCities) {
    if (left <= 0) break;
    const cap = resource === 'guns' ? c.storageCap.guns : (c.storageCap.gunsL2 ?? 100);
    const cur = (c.storage[resource] ?? 0) as number;
    const room = Math.max(0, cap - cur);
    const add = Math.min(room, left);
    if (add > 0) {
      c.storage = { ...c.storage, [resource]: cur + add };
      left -= add;
    }
  }
}

/**
 * Advance all battalion training orders one economy cycle; completes spawn the same cycle.
 * Mutates `cities` and returns updated pending list + recruits ready to spawn.
 *
 * Must run **after** `processEconomyTurn` each cycle so empire storage includes this tick’s
 * armory / fine-steel production; otherwise orders pull from stale stock and stall.
 * Multiple orders: single pass in array order (FIFO — first queued receives deliveries first).
 */
export function advanceBattalionTrainingOrders(
  pendingRecruits: PendingLandRecruit[],
  cities: City[],
): { nextPending: PendingLandRecruit[]; readyToSpawn: PendingLandRecruit[] } {
  const readyToSpawn: PendingLandRecruit[] = [];
  const nextPending: PendingLandRecruit[] = [];

  for (const pr of pendingRecruits) {
    if (!landPending(pr)) {
      nextPending.push(pr);
      continue;
    }
    if (pr.trainingCyclesTotal == null) {
      nextPending.push(pr);
      continue;
    }

    const elapsed = (pr.trainingCyclesElapsed ?? 0) + 1;
    let gunsDel = pr.gunsDelivered ?? 0;
    let gunsL2Del = pr.gunsL2Delivered ?? 0;
    const gunsNeed = pr.gunsRequired ?? 0;
    const gunsL2Need = pr.gunsL2Required ?? 0;

    if (gunsNeed > gunsDel) {
      const got = takeFromEmpirePool(cities, pr.playerId, 'guns', gunsNeed - gunsDel);
      gunsDel += got;
    }
    if (gunsL2Need > gunsL2Del) {
      const got = takeFromEmpirePool(cities, pr.playerId, 'gunsL2', gunsL2Need - gunsL2Del);
      gunsL2Del += got;
    }

    const timeOk = elapsed >= pr.trainingCyclesTotal;
    const armsOk = gunsDel >= gunsNeed && gunsL2Del >= gunsL2Need;

    if (timeOk && armsOk) {
      readyToSpawn.push({
        ...pr,
        trainingCyclesElapsed: elapsed,
        gunsDelivered: gunsDel,
        gunsL2Delivered: gunsL2Del,
        completesAtCycle: pr.completesAtCycle,
      });
    } else {
      nextPending.push({
        ...pr,
        trainingCyclesElapsed: elapsed,
        gunsDelivered: gunsDel,
        gunsL2Delivered: gunsL2Del,
      });
    }
  }

  return { nextPending, readyToSpawn };
}
