import type { AiActions, AiMoveAction } from '../../src/lib/ai';

export const MAX_CLIENT_MOVE_TARGETS = 512;

function isClientMoveTarget(value: unknown): value is AiMoveAction {
  if (typeof value !== 'object' || value === null) return false;
  const move = value as Partial<AiMoveAction>;
  return (
    typeof move.unitId === 'string' &&
    move.unitId.length > 0 &&
    Number.isInteger(move.toQ) &&
    Number.isInteger(move.toR)
  );
}

/**
 * Multiplayer clients currently have authority to submit movement intents only.
 * Drop every other AiActions field so a crafted websocket payload cannot invoke
 * bot-only build/recruit/upgrade actions on the authoritative server.
 */
export function sanitizeClientPlanPatch(plan: unknown): Partial<AiActions> {
  if (typeof plan !== 'object' || plan === null) return { moveTargets: [] };

  const rawMoves = (plan as { moveTargets?: unknown }).moveTargets;
  if (!Array.isArray(rawMoves)) return { moveTargets: [] };

  const moveTargets: AiMoveAction[] = [];
  for (const rawMove of rawMoves) {
    if (moveTargets.length >= MAX_CLIENT_MOVE_TARGETS) break;
    if (isClientMoveTarget(rawMove)) {
      moveTargets.push({
        unitId: rawMove.unitId,
        toQ: rawMove.toQ,
        toR: rawMove.toR,
      });
    }
  }
  return { moveTargets };
}

export function mergeClientMovePlan(base: AiActions, patch: Partial<AiActions>): AiActions {
  const mt = new Map<string, AiMoveAction>();
  for (const move of base.moveTargets) mt.set(move.unitId, move);
  for (const move of patch.moveTargets ?? []) mt.set(move.unitId, move);
  return {
    ...base,
    moveTargets: Array.from(mt.values()),
  };
}
