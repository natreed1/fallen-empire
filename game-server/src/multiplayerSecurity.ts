import type { AiActions, AiMoveAction } from '../../src/lib/ai';

export const MULTIPLAYER_PLAYER_1_ID = 'player_ai';
export const MULTIPLAYER_PLAYER_2_ID = 'player_ai_2';

export type MultiplayerRole = 'host' | 'guest';
export type MultiplayerPlayerId = typeof MULTIPLAYER_PLAYER_1_ID | typeof MULTIPLAYER_PLAYER_2_ID;

export type RoomAccessClient = {
  role: MultiplayerRole;
};

const MAX_PLAN_MOVE_TARGETS = 500;

export function parseMultiplayerRole(role: unknown): MultiplayerRole | null {
  return role === 'host' || role === 'guest' ? role : null;
}

export function playerIdForRole(role: MultiplayerRole): MultiplayerPlayerId {
  return role === 'host' ? MULTIPLAYER_PLAYER_1_ID : MULTIPLAYER_PLAYER_2_ID;
}

export function validateRoomJoin(args: {
  clients: Iterable<RoomAccessClient>;
  hasState: boolean;
  role: MultiplayerRole;
}): string | null {
  const clients = Array.from(args.clients);
  const hasHost = clients.some(c => c.role === 'host');
  const hasGuest = clients.some(c => c.role === 'guest');

  if (args.role === 'host') {
    return hasHost ? 'Host slot is already occupied.' : null;
  }

  if (!args.hasState) return 'Room not created yet — host must join first.';
  if (hasGuest) return 'Guest slot is already occupied.';
  if (clients.length >= 2) return 'Room is full.';
  return null;
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

function sanitizeMoveTarget(value: unknown): AiMoveAction | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { unitId?: unknown; toQ?: unknown; toR?: unknown };
  if (typeof candidate.unitId !== 'string') return null;
  if (!isFiniteInteger(candidate.toQ) || !isFiniteInteger(candidate.toR)) return null;
  return {
    unitId: candidate.unitId,
    toQ: candidate.toQ,
    toR: candidate.toR,
  };
}

export function sanitizeMultiplayerPlan(plan: unknown): Pick<AiActions, 'moveTargets'> {
  if (!plan || typeof plan !== 'object') return { moveTargets: [] };
  const rawMoveTargets = (plan as { moveTargets?: unknown }).moveTargets;
  if (!Array.isArray(rawMoveTargets)) return { moveTargets: [] };

  const moveTargets: AiMoveAction[] = [];
  for (const raw of rawMoveTargets.slice(0, MAX_PLAN_MOVE_TARGETS)) {
    const target = sanitizeMoveTarget(raw);
    if (target) moveTargets.push(target);
  }
  return { moveTargets };
}
