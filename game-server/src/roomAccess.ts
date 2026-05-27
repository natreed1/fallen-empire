export type MultiplayerRoomRole = 'host' | 'guest';

export function validateRoomJoin(
  existingRoles: readonly MultiplayerRoomRole[],
  requestedRole: MultiplayerRoomRole,
): string | null {
  if (existingRoles.length >= 2) return 'Room is full.';
  if (existingRoles.includes(requestedRole)) {
    return requestedRole === 'host' ? 'Room already has a host.' : 'Room already has a guest.';
  }
  if (requestedRole === 'guest' && !existingRoles.includes('host')) {
    return 'Room not created yet - host must join first.';
  }
  return null;
}
