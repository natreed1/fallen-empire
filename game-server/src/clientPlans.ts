import type { SimState } from '../../src/core/gameCore.ts';
import { emptyAiActions, type AiActions, type AiMoveAction } from '../../src/lib/ai.ts';
import { tileKey } from '../../src/types/game.ts';

type RawMoveTarget = {
  unitId?: unknown;
  toQ?: unknown;
  toR?: unknown;
};

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

export function sanitizeClientPlanPatch(
  patch: unknown,
  state: Pick<SimState, 'tiles' | 'units'>,
  playerId: string,
): Partial<AiActions> {
  if (!patch || typeof patch !== 'object') return {};

  const rawMoveTargets = (patch as { moveTargets?: unknown }).moveTargets;
  if (!Array.isArray(rawMoveTargets)) return {};

  const unitById = new Map(state.units.map(unit => [unit.id, unit]));
  const moveTargets: AiMoveAction[] = [];

  for (const raw of rawMoveTargets) {
    if (!raw || typeof raw !== 'object') continue;

    const { unitId, toQ, toR } = raw as RawMoveTarget;
    if (typeof unitId !== 'string' || !isFiniteInteger(toQ) || !isFiniteInteger(toR)) continue;
    if (!state.tiles.has(tileKey(toQ, toR))) continue;

    const unit = unitById.get(unitId);
    if (!unit || unit.ownerId !== playerId) continue;

    moveTargets.push({ unitId, toQ, toR });
  }

  return moveTargets.length > 0 ? { moveTargets } : {};
}

export function mergeClientPlanPatch(
  base: AiActions,
  patch: unknown,
  state: Pick<SimState, 'tiles' | 'units'>,
  playerId: string,
): AiActions {
  const sanitized = sanitizeClientPlanPatch(patch, state, playerId);
  const moveTargetsByUnit = new Map<string, AiMoveAction>();

  for (const moveTarget of base.moveTargets) moveTargetsByUnit.set(moveTarget.unitId, moveTarget);
  for (const moveTarget of sanitized.moveTargets ?? []) moveTargetsByUnit.set(moveTarget.unitId, moveTarget);

  return {
    ...emptyAiActions(),
    moveTargets: Array.from(moveTargetsByUnit.values()),
  };
}
