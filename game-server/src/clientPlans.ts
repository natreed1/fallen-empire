import type { SimState } from '../../src/core/gameCore.ts';
import { emptyAiActions, type AiActions, type AiMoveAction } from '../../src/lib/ai.ts';
import { tileKey } from '../../src/types/game.ts';

const isFiniteInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);

/**
 * Multiplayer clients are only allowed to submit movement intents for their own
 * living units. All other AI action fields remain server-owned.
 */
export function sanitizeClientPlan(
  state: SimState,
  playerId: string,
  patch: unknown,
): AiActions {
  const plan = emptyAiActions();
  if (!patch || typeof patch !== 'object') return plan;

  const rawMoveTargets = (patch as { moveTargets?: unknown }).moveTargets;
  if (!Array.isArray(rawMoveTargets)) return plan;

  const ownedAliveUnits = new Set(
    state.units
      .filter(unit => unit.ownerId === playerId && unit.hp > 0)
      .map(unit => unit.id),
  );

  const sanitized: AiMoveAction[] = [];
  const seenUnitIds = new Set<string>();
  for (const raw of rawMoveTargets) {
    if (!raw || typeof raw !== 'object') continue;
    const move = raw as { unitId?: unknown; toQ?: unknown; toR?: unknown };
    if (typeof move.unitId !== 'string') continue;
    if (!ownedAliveUnits.has(move.unitId)) continue;
    if (!isFiniteInteger(move.toQ) || !isFiniteInteger(move.toR)) continue;
    if (!state.tiles.has(tileKey(move.toQ, move.toR))) continue;
    if (seenUnitIds.has(move.unitId)) continue;
    seenUnitIds.add(move.unitId);
    sanitized.push({ unitId: move.unitId, toQ: move.toQ, toR: move.toR });
  }

  plan.moveTargets = sanitized;
  return plan;
}
