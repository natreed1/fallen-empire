import type { SimState } from '../../src/core/gameCore.ts';
import { emptyAiActions, type AiActions } from '../../src/lib/ai.ts';
import { tileKey } from '../../src/types/game.ts';

export type ServerPlayerId = 'player_ai' | 'player_ai_2';

function isFiniteMapInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

function isValidOwnedMoveTarget(
  state: SimState,
  playerId: ServerPlayerId,
  move: unknown,
): move is { unitId: string; toQ: number; toR: number } {
  if (typeof move !== 'object' || move == null) return false;
  const m = move as { unitId?: unknown; toQ?: unknown; toR?: unknown };
  if (typeof m.unitId !== 'string') return false;
  if (!isFiniteMapInteger(m.toQ) || !isFiniteMapInteger(m.toR)) return false;
  if (!state.tiles.has(tileKey(m.toQ, m.toR))) return false;
  const unit = state.units.find(u => u.id === m.unitId);
  return !!unit && unit.ownerId === playerId && unit.hp > 0;
}

/**
 * Multiplayer v1 exposes only movement intents. Keep all other AiActions server-owned
 * until each action type has explicit authority and resource validation.
 */
export function mergeClientPlan(
  base: AiActions,
  patch: Partial<AiActions>,
  state: SimState,
  playerId: ServerPlayerId,
): AiActions {
  const moveTargets = new Map<string, { unitId: string; toQ: number; toR: number }>();

  for (const move of base.moveTargets) {
    if (isValidOwnedMoveTarget(state, playerId, move)) moveTargets.set(move.unitId, move);
  }
  if (Array.isArray(patch.moveTargets)) {
    for (const move of patch.moveTargets) {
      if (isValidOwnedMoveTarget(state, playerId, move)) moveTargets.set(move.unitId, move);
    }
  }

  return {
    ...emptyAiActions(),
    moveTargets: Array.from(moveTargets.values()),
  };
}
