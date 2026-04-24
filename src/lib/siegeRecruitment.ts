/**
 * Siege recruit pairing: trebuchets and battering rams must stay within one of each other
 * (living units + land training queue) so armies cannot stack only one engine type.
 */

import type { Unit, UnitType } from '@/types/game';
import { landPending } from '@/lib/battalionTraining';

export function countPlayerSiegePieces(
  units: Unit[],
  pendingMixed: unknown[],
  playerId: string,
): { trebuchets: number; batteringRams: number } {
  let trebuchets = 0;
  let batteringRams = 0;
  for (const u of units) {
    if (u.ownerId !== playerId || (u.hp ?? 0) <= 0) continue;
    if (u.type === 'trebuchet') trebuchets++;
    else if (u.type === 'battering_ram') batteringRams++;
  }
  for (const pr of pendingMixed) {
    if (!landPending(pr)) continue;
    const p = pr as { playerId?: string; type?: UnitType };
    if (p.playerId !== playerId) continue;
    if (p.type === 'trebuchet') trebuchets++;
    else if (p.type === 'battering_ram') batteringRams++;
  }
  return { trebuchets, batteringRams };
}

export function siegeCompositionAllowsRecruit(
  recruiting: 'trebuchet' | 'battering_ram',
  counts: { trebuchets: number; batteringRams: number },
): boolean {
  const T = counts.trebuchets;
  const R = counts.batteringRams;
  if (recruiting === 'trebuchet') return Math.abs(T + 1 - R) <= 1;
  return Math.abs(T - (R + 1)) <= 1;
}
