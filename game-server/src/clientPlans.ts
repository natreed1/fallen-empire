import { emptyAiActions, type AiActions, type AiMoveAction } from '../../src/lib/ai.ts';
import { tileKey } from '../../src/types/game.ts';
import type { SimState } from '../../src/core/gameCore.ts';

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function sanitizeMoveTarget(
  state: SimState,
  playerId: string,
  value: unknown,
): AiMoveAction | null {
  if (!isObject(value)) return null;
  const { unitId, toQ, toR } = value;
  if (typeof unitId !== 'string' || !isFiniteInteger(toQ) || !isFiniteInteger(toR)) return null;
  if (!state.tiles.has(tileKey(toQ, toR))) return null;

  const unit = state.units.find(u => u.id === unitId);
  if (!unit || unit.ownerId !== playerId || unit.hp <= 0) return null;

  return { unitId, toQ, toR };
}

/** Allowlist client-submitted plan fields before they enter the authoritative sim. */
export function sanitizeClientPlanPatch(
  state: SimState,
  playerId: string,
  patch: unknown,
): AiActions {
  const sanitized = emptyAiActions();
  if (!isObject(patch) || !Array.isArray(patch.moveTargets)) return sanitized;

  const byUnitId = new Map<string, AiMoveAction>();
  for (const rawMove of patch.moveTargets) {
    const move = sanitizeMoveTarget(state, playerId, rawMove);
    if (move) byUnitId.set(move.unitId, move);
  }
  sanitized.moveTargets = Array.from(byUnitId.values());
  return sanitized;
}
