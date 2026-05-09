export type RoomRole = 'host' | 'guest';

export type RoomClientMembership = {
  role: RoomRole;
};

export type RoomJoinRejection = 'duplicate-host' | 'duplicate-guest' | 'missing-host';

export function roomHasRole(clients: Iterable<RoomClientMembership>, role: RoomRole): boolean {
  for (const client of clients) {
    if (client.role === role) return true;
  }
  return false;
}

export function getRoomJoinRejection(
  clients: Iterable<RoomClientMembership>,
  role: RoomRole,
  roomStateExists: boolean,
): RoomJoinRejection | null {
  if (role === 'host') {
    return roomHasRole(clients, 'host') ? 'duplicate-host' : null;
  }

  if (!roomStateExists) return 'missing-host';
  if (roomHasRole(clients, 'guest')) return 'duplicate-guest';
  return null;
}
