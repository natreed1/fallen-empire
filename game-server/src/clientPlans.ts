import { emptyAiActions, type AiActions } from '../../src/lib/ai';

type MoveTarget = AiActions['moveTargets'][number];

const MAX_MOVE_TARGETS_PER_PLAN = 256;

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function sanitizeMoveTargets(input: unknown): MoveTarget[] {
  if (!Array.isArray(input)) return [];

  const out: MoveTarget[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.unitId !== 'string' ||
      !isFiniteCoordinate(candidate.toQ) ||
      !isFiniteCoordinate(candidate.toR)
    ) {
      continue;
    }
    out.push({
      unitId: candidate.unitId,
      toQ: candidate.toQ,
      toR: candidate.toR,
    });
    if (out.length >= MAX_MOVE_TARGETS_PER_PLAN) break;
  }
  return out;
}

export function mergeClientPlan(base: AiActions, patch: unknown): AiActions {
  const merged = emptyAiActions();
  const byUnit = new Map<string, MoveTarget>();

  for (const target of base.moveTargets) byUnit.set(target.unitId, target);
  const moveTargets = patch && typeof patch === 'object'
    ? sanitizeMoveTargets((patch as Record<string, unknown>).moveTargets)
    : [];
  for (const target of moveTargets) byUnit.set(target.unitId, target);

  merged.moveTargets = Array.from(byUnit.values());
  return merged;
}
