import type { SimState } from '../../src/core/gameCore.ts';
import type { AiActions } from '../../src/lib/ai.ts';

type MoveTarget = AiActions['moveTargets'][number];

function isMapTarget(state: SimState, q: number, r: number): boolean {
  return Number.isInteger(q) &&
    Number.isInteger(r) &&
    q >= 0 &&
    r >= 0 &&
    q < state.config.width &&
    r < state.config.height;
}

function sanitizeMoveTargets(state: SimState, playerId: string, moves: unknown): MoveTarget[] {
  if (!Array.isArray(moves)) return [];
  const ownedUnitIds = new Set(
    state.units
      .filter(u => u.ownerId === playerId && u.hp > 0)
      .map(u => u.id),
  );
  const out: MoveTarget[] = [];
  for (const move of moves) {
    if (!move || typeof move !== 'object') continue;
    const { unitId, toQ, toR } = move as Partial<MoveTarget>;
    if (typeof unitId !== 'string') continue;
    if (typeof toQ !== 'number' || typeof toR !== 'number') continue;
    if (!isMapTarget(state, toQ, toR)) continue;
    if (!ownedUnitIds.has(unitId)) continue;
    out.push({ unitId, toQ, toR });
  }
  return out;
}

export function mergeClientPlan(
  base: AiActions,
  patch: Partial<AiActions>,
  state: SimState,
  playerId: string,
): AiActions {
  const mt = new Map<string, MoveTarget>();
  for (const m of base.moveTargets) mt.set(m.unitId, m);
  for (const m of sanitizeMoveTargets(state, playerId, patch.moveTargets)) mt.set(m.unitId, m);
  return {
    ...base,
    moveTargets: Array.from(mt.values()),
  };
}
