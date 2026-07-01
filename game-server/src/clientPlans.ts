import type { SimState } from '../../src/core/gameCore';
import { emptyAiActions, type AiActions, type AiMoveAction } from '../../src/lib/ai';
import { tileKey } from '../../src/types/game';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function sanitizeMoveTarget(
  value: unknown,
  state: SimState,
  playerId: string,
): AiMoveAction | null {
  if (!isObject(value)) return null;
  const { unitId, toQ, toR } = value;
  if (typeof unitId !== 'string') return null;
  if (typeof toQ !== 'number' || typeof toR !== 'number') return null;
  if (!Number.isInteger(toQ) || !Number.isInteger(toR)) return null;
  if (!state.tiles.has(tileKey(toQ, toR))) return null;

  const unit = state.units.find(u => u.id === unitId);
  if (!unit || unit.ownerId !== playerId || unit.hp <= 0 || unit.status === 'fighting') return null;

  return { unitId, toQ, toR };
}

/**
 * Multiplayer clients may only contribute movement intents for their own live units.
 * All economy/build/recruit fields stay server-owned and are intentionally dropped.
 */
export function sanitizeClientPlan(
  patch: unknown,
  state: SimState,
  playerId: string,
): AiActions {
  const out = emptyAiActions();
  if (!isObject(patch) || !Array.isArray(patch.moveTargets)) return out;

  const byUnit = new Map<string, AiMoveAction>();
  for (const rawMove of patch.moveTargets) {
    const move = sanitizeMoveTarget(rawMove, state, playerId);
    if (move) byUnit.set(move.unitId, move);
  }
  out.moveTargets = Array.from(byUnit.values());
  return out;
}
