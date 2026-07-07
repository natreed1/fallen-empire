import { emptyAiActions, type AiActions } from '../../src/lib/ai.ts';
import { tileKey, type Tile, type Unit } from '../../src/types/game.ts';

type MoveTarget = AiActions['moveTargets'][number];

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value);
}

function sanitizeMoveTarget(
  value: unknown,
  playerId: string,
  unitsById: Map<string, Unit>,
  tiles: Map<string, Tile>,
): MoveTarget | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<MoveTarget>;
  if (typeof candidate.unitId !== 'string') return null;
  if (!isFiniteInteger(candidate.toQ) || !isFiniteInteger(candidate.toR)) return null;
  if (!tiles.has(tileKey(candidate.toQ, candidate.toR))) return null;
  const unit = unitsById.get(candidate.unitId);
  if (!unit || unit.ownerId !== playerId || unit.hp <= 0) return null;
  return { unitId: candidate.unitId, toQ: candidate.toQ, toR: candidate.toR };
}

export function sanitizeClientPlan(
  patch: unknown,
  playerId: string,
  units: Unit[],
  tiles: Map<string, Tile>,
): AiActions {
  const sanitized = emptyAiActions();
  if (!patch || typeof patch !== 'object') return sanitized;
  const rawMoves = (patch as { moveTargets?: unknown }).moveTargets;
  if (!Array.isArray(rawMoves)) return sanitized;

  const unitsById = new Map(units.map(unit => [unit.id, unit]));
  const deduped = new Map<string, MoveTarget>();
  for (const rawMove of rawMoves) {
    const move = sanitizeMoveTarget(rawMove, playerId, unitsById, tiles);
    if (move) deduped.set(move.unitId, move);
  }
  sanitized.moveTargets = Array.from(deduped.values());
  return sanitized;
}
