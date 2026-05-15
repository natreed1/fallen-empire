import { emptyAiActions, type AiActions, type AiMoveAction } from '../../src/lib/ai.ts';

function isMoveTarget(value: unknown): value is AiMoveAction {
  if (!value || typeof value !== 'object') return false;
  const move = value as Partial<AiMoveAction>;
  return (
    typeof move.unitId === 'string' &&
    typeof move.toQ === 'number' &&
    typeof move.toR === 'number' &&
    Number.isFinite(move.toQ) &&
    Number.isFinite(move.toR)
  );
}

export function mergePlayerPlan(base: AiActions, patch: unknown): AiActions {
  const mt = new Map<string, AiMoveAction>();
  for (const m of base.moveTargets) mt.set(m.unitId, m);

  const patchObj = patch && typeof patch === 'object' ? (patch as Partial<AiActions>) : {};
  const moveTargets = Array.isArray(patchObj.moveTargets) ? patchObj.moveTargets : [];
  for (const m of moveTargets) {
    if (isMoveTarget(m)) mt.set(m.unitId, { unitId: m.unitId, toQ: m.toQ, toR: m.toR });
  }

  return {
    ...emptyAiActions(),
    ...base,
    moveTargets: Array.from(mt.values()),
  };
}
