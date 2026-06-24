import type { AiActions, AiMoveAction } from '../../src/lib/ai';
import type { SimState } from '../../src/core/gameCore';
import { emptyAiActions } from '../../src/lib/ai';
import { tileKey } from '../../src/types/game';

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

function sanitizeMoveTarget(
  value: unknown,
  state: SimState,
  playerId: string,
): AiMoveAction | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { unitId?: unknown; toQ?: unknown; toR?: unknown };
  if (typeof raw.unitId !== 'string') return null;
  if (!isFiniteInteger(raw.toQ) || !isFiniteInteger(raw.toR)) return null;
  if (!state.tiles.has(tileKey(raw.toQ, raw.toR))) return null;

  const unit = state.units.find(u => u.id === raw.unitId);
  if (!unit || unit.ownerId !== playerId || unit.hp <= 0) return null;

  return { unitId: raw.unitId, toQ: raw.toQ, toR: raw.toR };
}

/**
 * Multiplayer clients only submit movement intents. Keep the server-authoritative
 * plan surface narrow so clients cannot smuggle AI build/recruit/scout actions.
 */
export function sanitizeClientPlanPatch(
  patch: unknown,
  state: SimState,
  playerId: string,
): Partial<AiActions> {
  if (!patch || typeof patch !== 'object') return {};
  const raw = patch as { moveTargets?: unknown };
  if (!Array.isArray(raw.moveTargets)) return {};

  const moveTargets: AiMoveAction[] = [];
  const seen = new Set<string>();
  for (const candidate of raw.moveTargets) {
    const mt = sanitizeMoveTarget(candidate, state, playerId);
    if (!mt) continue;
    seen.add(mt.unitId);
    moveTargets.push(mt);
  }

  if (moveTargets.length === 0) return {};
  return {
    ...emptyAiActions(),
    moveTargets: moveTargets.filter((mt, idx) => {
      if (moveTargets.findIndex(other => other.unitId === mt.unitId) !== idx) return false;
      return seen.has(mt.unitId);
    }),
  };
}

export function mergeClientPlan(base: AiActions, patch: Partial<AiActions>): AiActions {
  const mt = new Map<string, AiMoveAction>();
  for (const m of base.moveTargets) mt.set(m.unitId, m);
  for (const m of patch.moveTargets ?? []) mt.set(m.unitId, m);
  return {
    ...emptyAiActions(),
    moveTargets: Array.from(mt.values()),
  };
}
