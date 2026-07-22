import { emptyAiActions, type AiActions } from '../../src/lib/ai.ts';
import type { SimState } from '../../src/core/gameCore.ts';
import { tileKey } from '../../src/types/game.ts';

type PlayerId = 'player_ai' | 'player_ai_2';

/**
 * Multiplayer clients may currently submit movement orders only. Treat the
 * WebSocket payload as untrusted and discard every other AI action.
 */
export function sanitizeClientPlan(
  patch: unknown,
  state: Pick<SimState, 'tiles' | 'units'>,
  playerId: PlayerId,
): AiActions {
  const sanitized = emptyAiActions();
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return sanitized;

  const moveTargets = (patch as { moveTargets?: unknown }).moveTargets;
  if (!Array.isArray(moveTargets)) return sanitized;

  const ownedUnits = new Map(
    state.units
      .filter(unit => unit.ownerId === playerId && unit.hp > 0)
      .map(unit => [unit.id, unit]),
  );
  const validMoves = new Map<string, AiActions['moveTargets'][number]>();

  for (const candidate of moveTargets) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const { unitId, toQ, toR } = candidate as {
      unitId?: unknown;
      toQ?: unknown;
      toR?: unknown;
    };
    if (
      typeof unitId !== 'string' ||
      !ownedUnits.has(unitId) ||
      typeof toQ !== 'number' ||
      typeof toR !== 'number' ||
      !Number.isSafeInteger(toQ) ||
      !Number.isSafeInteger(toR) ||
      !state.tiles.has(tileKey(toQ, toR))
    ) {
      continue;
    }
    validMoves.set(unitId, { unitId, toQ, toR });
  }

  sanitized.moveTargets = Array.from(validMoves.values());
  return sanitized;
}

export function mergeClientPlan(base: AiActions, patch: AiActions): AiActions {
  const merged = emptyAiActions();
  const moveTargets = new Map<string, AiActions['moveTargets'][number]>();
  for (const move of base.moveTargets) moveTargets.set(move.unitId, move);
  for (const move of patch.moveTargets) moveTargets.set(move.unitId, move);
  merged.moveTargets = Array.from(moveTargets.values());
  return merged;
}
