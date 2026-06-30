import { tileKey } from '../../src/types/game.ts';
import type { SimState } from '../../src/core/gameCore.ts';
import { emptyAiActions, type AiActions } from '../../src/lib/ai.ts';

type ClientMoveTarget = {
  unitId: string;
  toQ: number;
  toR: number;
};

function clientMoveTargets(plan: unknown): unknown[] {
  if (!plan || typeof plan !== 'object') return [];
  const moveTargets = (plan as { moveTargets?: unknown }).moveTargets;
  return Array.isArray(moveTargets) ? moveTargets : [];
}

export function isLegalClientMoveTarget(
  state: SimState,
  playerId: string,
  moveTarget: unknown,
): moveTarget is ClientMoveTarget {
  if (!moveTarget || typeof moveTarget !== 'object') return false;
  const { unitId, toQ, toR } = moveTarget as Partial<ClientMoveTarget>;
  if (typeof unitId !== 'string') return false;
  if (!Number.isInteger(toQ) || !Number.isInteger(toR)) return false;
  if (!state.tiles.has(tileKey(toQ, toR))) return false;

  const unit = state.units.find(u => u.id === unitId);
  return !!unit && unit.ownerId === playerId && unit.hp > 0 && unit.status !== 'fighting';
}

/**
 * Multiplayer clients may only submit movement intents for their own living units.
 * All other AiActions are server/AI-owned and must not be accepted over the socket.
 */
export function mergeClientPlan(
  base: AiActions,
  patch: unknown,
  state: SimState,
  playerId: string,
): AiActions {
  const moveTargets = new Map<string, ClientMoveTarget>();
  for (const moveTarget of [...base.moveTargets, ...clientMoveTargets(patch)]) {
    if (isLegalClientMoveTarget(state, playerId, moveTarget)) {
      moveTargets.set(moveTarget.unitId, moveTarget);
    }
  }

  return {
    ...emptyAiActions(),
    moveTargets: Array.from(moveTargets.values()),
  };
}
