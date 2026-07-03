import type { SimState } from '../../src/core/gameCore.ts';
import type { AiActions } from '../../src/lib/ai.ts';
import { tileKey } from '../../src/types/game.ts';

type ClientMoveTarget = { unitId: string; toQ: number; toR: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

function sanitizeMoveTargets(state: SimState, playerId: string, value: unknown): ClientMoveTarget[] {
  if (!Array.isArray(value)) return [];

  const ownedAliveUnitIds = new Set(
    state.units
      .filter(u => u.ownerId === playerId && u.hp > 0)
      .map(u => u.id),
  );
  const out: ClientMoveTarget[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const { unitId, toQ, toR } = entry;
    if (typeof unitId !== 'string') continue;
    if (!ownedAliveUnitIds.has(unitId)) continue;
    if (!isFiniteInteger(toQ) || !isFiniteInteger(toR)) continue;
    if (!state.tiles.has(tileKey(toQ, toR))) continue;
    if (seen.has(unitId)) continue;
    seen.add(unitId);
    out.push({ unitId, toQ, toR });
  }

  return out;
}

/**
 * Network clients are only allowed to submit movement intents for their own
 * units. All AI/economy action arrays are server-owned and intentionally
 * dropped even if a client includes them in a forged packet.
 */
export function sanitizeClientPlanPatch(
  state: SimState,
  playerId: string,
  patch: unknown,
): Partial<AiActions> {
  if (!isRecord(patch)) return { moveTargets: [] };
  return {
    moveTargets: sanitizeMoveTargets(state, playerId, patch.moveTargets),
  };
}
