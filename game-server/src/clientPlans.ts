import type { SimState } from '../../src/core/gameCore.ts';
import { emptyAiActions, type AiActions } from '../../src/lib/ai.ts';
import { tileKey } from '../../src/types/game.ts';

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

/**
 * JSON from a WebSocket client is untrusted. Multiplayer clients currently only
 * submit move orders, so drop every other action class and only keep moves for
 * alive units owned by the submitting player.
 */
export function sanitizeClientPlanPatch(
  state: SimState,
  playerId: string,
  patch: unknown,
): Partial<AiActions> {
  if (!patch || typeof patch !== 'object') return { moveTargets: [] };

  const rawMoveTargets = (patch as { moveTargets?: unknown }).moveTargets;
  if (!Array.isArray(rawMoveTargets)) return { moveTargets: [] };

  const moveTargets: AiActions['moveTargets'] = [];
  const unitsById = new Map(state.units.map(unit => [unit.id, unit]));

  for (const raw of rawMoveTargets) {
    if (!raw || typeof raw !== 'object') continue;
    const move = raw as { unitId?: unknown; toQ?: unknown; toR?: unknown };
    if (typeof move.unitId !== 'string') continue;
    if (!isFiniteInteger(move.toQ) || !isFiniteInteger(move.toR)) continue;
    if (!state.tiles.has(tileKey(move.toQ, move.toR))) continue;

    const unit = unitsById.get(move.unitId);
    if (!unit || unit.ownerId !== playerId || unit.hp <= 0) continue;

    moveTargets.push({
      unitId: unit.id,
      toQ: move.toQ,
      toR: move.toR,
    });
  }

  return { moveTargets };
}

export function mergeClientPlan(base: AiActions, patch: Partial<AiActions>): AiActions {
  const next = emptyAiActions();
  const byUnit = new Map<string, AiActions['moveTargets'][number]>();
  for (const move of base.moveTargets) byUnit.set(move.unitId, move);
  for (const move of patch.moveTargets ?? []) byUnit.set(move.unitId, move);
  next.moveTargets = Array.from(byUnit.values());
  return next;
}
