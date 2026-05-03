export type MultiplayerRole = 'host' | 'guest';

export type RoomOccupant = {
  role: MultiplayerRole;
};

export function getJoinRejectionReason(
  occupants: Iterable<RoomOccupant>,
  requestedRole: MultiplayerRole,
  hasState: boolean,
): string | null {
  if (requestedRole === 'guest' && !hasState) {
    return 'Room not created yet — host must join first.';
  }

  let occupantCount = 0;
  for (const occupant of occupants) {
    occupantCount += 1;
    if (occupant.role === requestedRole) {
      return requestedRole === 'host' ? 'Room already has a host.' : 'Room already has a guest.';
    }
  }

  if (occupantCount >= 2) {
    return 'Room is full.';
  }

  return null;
}
