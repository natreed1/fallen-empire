import type { SimState } from '../../src/core/gameCore';
import { emptyAiActions, type AiActions, type AiMoveAction } from '../../src/lib/ai';
import { tileKey } from '../../src/types/game';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidMoveTarget(value: unknown): value is AiMoveAction {
  if (!isRecord(value)) return false;
  return (
    typeof value.unitId === 'string' &&
    Number.isInteger(value.toQ) &&
    Number.isInteger(value.toR)
  );
}

export function sanitizeClientPlan(patch: unknown, state: SimState, playerId: string): AiActions {
  const sanitized = emptyAiActions();
  if (!isRecord(patch) || !Array.isArray(patch.moveTargets)) return sanitized;

  const ownedUnits = new Map(
    state.units
      .filter(u => u.ownerId === playerId && u.hp > 0)
      .map(u => [u.id, u]),
  );
  const moveTargets = new Map<string, AiMoveAction>();

  for (const value of patch.moveTargets) {
    if (!isValidMoveTarget(value)) continue;
    const unit = ownedUnits.get(value.unitId);
    if (!unit) continue;
    if (!state.tiles.has(tileKey(value.toQ, value.toR))) continue;
    moveTargets.set(value.unitId, {
      unitId: value.unitId,
      toQ: value.toQ,
      toR: value.toR,
    });
  }

  sanitized.moveTargets = Array.from(moveTargets.values());
  return sanitized;
}

export function mergePlans(base: AiActions, patch: AiActions): AiActions {
  const moveTargets = new Map<string, AiMoveAction>();
  for (const move of base.moveTargets) moveTargets.set(move.unitId, move);
  for (const move of patch.moveTargets) moveTargets.set(move.unitId, move);
  return {
    ...emptyAiActions(),
    moveTargets: Array.from(moveTargets.values()),
  };
}
