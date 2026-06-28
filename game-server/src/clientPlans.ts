import { type AiActions } from '../../src/lib/ai';
import type { SimState } from '../../src/core/gameCore';
import { tileKey } from '../../src/types/game';

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

/**
 * Clients may only submit movement intents for their own living units. The
 * authoritative server ignores every other AI action type.
 */
export function sanitizeClientPlan(
  plan: unknown,
  state: SimState,
  playerId: string,
): Partial<AiActions> {
  const sanitized: Partial<AiActions> = { moveTargets: [] };
  if (!plan || typeof plan !== 'object') return sanitized;

  const rawMoveTargets = (plan as { moveTargets?: unknown }).moveTargets;
  if (!Array.isArray(rawMoveTargets)) return sanitized;

  const unitsById = new Map(state.units.map(unit => [unit.id, unit]));
  for (const raw of rawMoveTargets) {
    if (!raw || typeof raw !== 'object') continue;
    const move = raw as { unitId?: unknown; toQ?: unknown; toR?: unknown };
    if (typeof move.unitId !== 'string' || !isFiniteInteger(move.toQ) || !isFiniteInteger(move.toR)) {
      continue;
    }

    const unit = unitsById.get(move.unitId);
    if (!unit || unit.ownerId !== playerId || unit.hp <= 0 || unit.status === 'fighting') continue;
    if (!state.tiles.has(tileKey(move.toQ, move.toR))) continue;

    sanitized.moveTargets!.push({ unitId: move.unitId, toQ: move.toQ, toR: move.toR });
  }

  return sanitized;
}
