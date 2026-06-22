import { emptyAiActions, type AiActions } from '../../src/lib/ai.ts';
import type { SimState } from '../../src/core/gameCore.ts';
import { tileKey } from '../../src/types/game.ts';

type MoveTarget = AiActions['moveTargets'][number];

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

function sanitizeMoveTargets(raw: unknown, state: SimState, playerId: string): MoveTarget[] {
  if (!Array.isArray(raw)) return [];
  const out: MoveTarget[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const move = item as Partial<MoveTarget>;
    if (typeof move.unitId !== 'string') continue;
    if (!isFiniteInteger(move.toQ) || !isFiniteInteger(move.toR)) continue;
    if (!state.tiles.has(tileKey(move.toQ, move.toR))) continue;
    const unit = state.units.find(u => u.id === move.unitId);
    if (!unit || unit.ownerId !== playerId || unit.hp <= 0) continue;
    out.push({ unitId: move.unitId, toQ: move.toQ, toR: move.toR });
  }
  return out;
}

export function mergeClientPlan(
  base: AiActions,
  patch: Partial<AiActions>,
  state: SimState,
  playerId: string,
): AiActions {
  const byUnit = new Map<string, MoveTarget>();
  for (const move of sanitizeMoveTargets(base.moveTargets, state, playerId)) {
    byUnit.set(move.unitId, move);
  }
  for (const move of sanitizeMoveTargets(patch.moveTargets, state, playerId)) {
    byUnit.set(move.unitId, move);
  }

  return {
    ...emptyAiActions(),
    moveTargets: Array.from(byUnit.values()),
  };
}
