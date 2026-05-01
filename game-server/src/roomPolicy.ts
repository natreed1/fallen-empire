export type RoomRole = 'host' | 'guest';
export type PlayerSlot = 'player_ai' | 'player_ai_2';

export const HOST_PLAYER_SLOT: PlayerSlot = 'player_ai';
export const GUEST_PLAYER_SLOT: PlayerSlot = 'player_ai_2';
export const MAX_ROOM_PLAYERS = 2;
export const ROOM_FULL_MESSAGE = 'Room is full.';
export const HOST_EXISTS_MESSAGE = 'Room already has a host.';
export const GUEST_EXISTS_MESSAGE = 'Room already has a guest.';
export const HOST_REQUIRED_MESSAGE = 'Room not created yet - host must join first.';

export type RoomOccupant = {
  role: RoomRole;
  playerId: PlayerSlot;
};

export type JoinDecision =
  | { ok: true; playerId: PlayerSlot }
  | { ok: false; message: string };

export function decideJoin(occupants: Iterable<RoomOccupant>, role: RoomRole): JoinDecision {
  const existing = Array.from(occupants);
  const hasHost = existing.some((client) => client.role === 'host');
  const hasGuest = existing.some((client) => client.role === 'guest');

  if (existing.length >= MAX_ROOM_PLAYERS) {
    return { ok: false, message: ROOM_FULL_MESSAGE };
  }

  if (role === 'host') {
    if (hasHost) {
      return { ok: false, message: HOST_EXISTS_MESSAGE };
    }
    return { ok: true, playerId: HOST_PLAYER_SLOT };
  }

  if (hasGuest) {
    return { ok: false, message: GUEST_EXISTS_MESSAGE };
  }
  if (!hasHost) {
    return { ok: false, message: HOST_REQUIRED_MESSAGE };
  }
  return { ok: true, playerId: GUEST_PLAYER_SLOT };
}
