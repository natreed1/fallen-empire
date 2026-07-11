import type { SimState } from '../../src/core/gameCore.ts';
import type { AiActions, AiMoveAction } from '../../src/lib/ai.ts';

function tileKey(q: number, r: number): string {
  return `${q},${r}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidMoveTarget(value: unknown): value is AiMoveAction {
  if (!isObject(value)) return false;
  return (
    typeof value.unitId === 'string' &&
    Number.isInteger(value.toQ) &&
    Number.isInteger(value.toR)
  );
}

/**
 * Multiplayer clients are allowed to submit movement orders for their own live
 * units only. Other AiActions fields are server/AI-authoritative and must not
 * be accepted from raw WebSocket payloads.
 */
export function sanitizeClientPlan(
  patch: Partial<AiActions>,
  state: SimState,
  playerId: string,
): Partial<AiActions> {
  const moveTargets: AiMoveAction[] = [];
  const unitsById = new Map(state.units.map(unit => [unit.id, unit]));
  const rawMoves = Array.isArray(patch.moveTargets) ? patch.moveTargets : [];

  for (const rawMove of rawMoves) {
    if (!isValidMoveTarget(rawMove)) continue;
    const unit = unitsById.get(rawMove.unitId);
    if (!unit || unit.ownerId !== playerId || unit.hp <= 0 || unit.status === 'fighting') continue;
    if (!state.tiles.has(tileKey(rawMove.toQ, rawMove.toR))) continue;
    moveTargets.push({
      unitId: rawMove.unitId,
      toQ: rawMove.toQ,
      toR: rawMove.toR,
    });
  }

  return { moveTargets };
}
