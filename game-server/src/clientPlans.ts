import type { SimState } from '../../src/core/gameCore.ts';
import type { AiActions } from '../../src/lib/ai.ts';
import { tileKey } from '../../src/types/game.ts';

export function sanitizeClientMoveTargets(
  state: SimState,
  playerId: string,
  moveTargets: unknown,
): AiActions['moveTargets'] {
  if (!Array.isArray(moveTargets)) return [];
  const ownedUnitIds = new Set(
    state.units.filter(unit => unit.ownerId === playerId && unit.hp > 0).map(unit => unit.id),
  );
  const safe: AiActions['moveTargets'] = [];
  for (const move of moveTargets) {
    if (!move || typeof move !== 'object') continue;
    const { unitId, toQ, toR } = move as { unitId?: unknown; toQ?: unknown; toR?: unknown };
    if (
      typeof unitId !== 'string' ||
      !ownedUnitIds.has(unitId) ||
      typeof toQ !== 'number' ||
      typeof toR !== 'number' ||
      !Number.isInteger(toQ) ||
      !Number.isInteger(toR) ||
      !state.tiles.has(tileKey(toQ, toR))
    ) {
      continue;
    }
    safe.push({ unitId, toQ, toR });
  }
  return safe;
}

export function mergeClientPlan(
  base: AiActions,
  patch: unknown,
  state: SimState,
  playerId: string,
): AiActions {
  const mt = new Map<string, { unitId: string; toQ: number; toR: number }>();
  for (const m of base.moveTargets) mt.set(m.unitId, m);
  const moveTargets =
    patch && typeof patch === 'object'
      ? sanitizeClientMoveTargets(state, playerId, (patch as { moveTargets?: unknown }).moveTargets)
      : [];
  for (const m of moveTargets) mt.set(m.unitId, m);
  return {
    ...base,
    moveTargets: Array.from(mt.values()),
  };
}
