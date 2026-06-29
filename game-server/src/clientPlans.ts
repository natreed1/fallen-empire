import type { AiActions, AiMoveAction } from '../../src/lib/ai.ts';
import type { SimState } from '../../src/core/gameCore.ts';

const EMPTY_CLIENT_PLAN: AiActions = {
  builds: [],
  upgrades: [],
  recruits: [],
  moveTargets: [],
  scouts: [],
  incorporateVillages: [],
  buildWallRings: [],
  commanderAssignments: [],
  scrollAttachments: [],
  universityTasks: [],
  stanceChanges: [],
  retreats: [],
};

function emptyClientPlan(): AiActions {
  return {
    ...EMPTY_CLIENT_PLAN,
    moveTargets: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number.isFinite(value);
}

function mapKey(q: number, r: number): string {
  return `${q},${r}`;
}

function sanitizeMoveTarget(
  value: unknown,
  state: SimState,
  playerId: string,
): AiMoveAction | null {
  if (!isRecord(value)) return null;
  const { unitId, toQ, toR } = value;
  if (typeof unitId !== 'string' || !isFiniteInteger(toQ) || !isFiniteInteger(toR)) return null;
  if (!state.tiles.has(mapKey(toQ, toR))) return null;

  const unit = state.units.find(u => u.id === unitId);
  if (!unit || unit.ownerId !== playerId || unit.hp <= 0 || unit.status === 'fighting') return null;

  return { unitId, toQ, toR };
}

export function sanitizeClientPlan(
  value: unknown,
  state: SimState,
  playerId: string,
): AiActions {
  const out = emptyClientPlan();
  if (!isRecord(value) || !Array.isArray(value.moveTargets)) return out;

  const byUnitId = new Map<string, AiMoveAction>();
  for (const rawMoveTarget of value.moveTargets) {
    const moveTarget = sanitizeMoveTarget(rawMoveTarget, state, playerId);
    if (moveTarget) byUnitId.set(moveTarget.unitId, moveTarget);
  }
  out.moveTargets = Array.from(byUnitId.values());
  return out;
}
