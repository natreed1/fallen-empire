import { type AiActions, type AiMoveAction } from '../../src/lib/ai';

const MAX_CLIENT_MOVE_TARGETS = 512;
const MAX_UNIT_ID_LENGTH = 128;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toMoveAction(value: unknown): AiMoveAction | null {
  if (!isRecord(value)) return null;
  const { unitId, toQ, toR } = value;
  if (typeof unitId !== 'string' || unitId.length === 0 || unitId.length > MAX_UNIT_ID_LENGTH) return null;
  if (!Number.isSafeInteger(toQ) || !Number.isSafeInteger(toR)) return null;
  return { unitId, toQ, toR };
}

export function sanitizeClientPlanPatch(patch: unknown): Pick<AiActions, 'moveTargets'> {
  if (!isRecord(patch) || !Array.isArray(patch.moveTargets)) {
    return { moveTargets: [] };
  }

  const moveTargets: AiMoveAction[] = [];
  for (const item of patch.moveTargets.slice(0, MAX_CLIENT_MOVE_TARGETS)) {
    const move = toMoveAction(item);
    if (move) moveTargets.push(move);
  }
  return { moveTargets };
}

export function mergeClientPlan(base: AiActions, patch: unknown): AiActions {
  const sanitized = sanitizeClientPlanPatch(patch);
  const moveTargetsByUnit = new Map<string, AiMoveAction>();

  for (const move of base.moveTargets) moveTargetsByUnit.set(move.unitId, move);
  for (const move of sanitized.moveTargets) moveTargetsByUnit.set(move.unitId, move);

  return {
    ...base,
    moveTargets: Array.from(moveTargetsByUnit.values()),
  };
}

