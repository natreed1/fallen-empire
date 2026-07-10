import { emptyAiActions, type AiActions } from '../../src/lib/ai.ts';
import { tileKey } from '../../src/types/game.ts';
import type { SimState } from '../../src/core/gameCore.ts';

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

/**
 * Keep live client intents to the small authority-safe surface the server owns:
 * finite in-map move orders for alive units belonging to the sending player.
 */
export function sanitizeClientPlan(
  patch: Partial<AiActions> | undefined,
  state: SimState,
  playerId: string,
): AiActions {
  const sanitized = emptyAiActions();
  const rawMoves = (patch as { moveTargets?: unknown } | undefined)?.moveTargets;
  if (!Array.isArray(rawMoves)) return sanitized;

  const unitsById = new Map(state.units.map(unit => [unit.id, unit]));
  const moveTargets = new Map<string, { unitId: string; toQ: number; toR: number }>();

  for (const raw of rawMoves) {
    if (!raw || typeof raw !== 'object') continue;
    const { unitId, toQ, toR } = raw as { unitId?: unknown; toQ?: unknown; toR?: unknown };
    if (typeof unitId !== 'string' || !isFiniteInteger(toQ) || !isFiniteInteger(toR)) continue;

    const unit = unitsById.get(unitId);
    if (!unit || unit.ownerId !== playerId || unit.hp <= 0) continue;
    if (!state.tiles.has(tileKey(toQ, toR))) continue;

    moveTargets.set(unitId, { unitId, toQ, toR });
  }

  sanitized.moveTargets = Array.from(moveTargets.values());
  return sanitized;
}
