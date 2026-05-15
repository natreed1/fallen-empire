export type JoinRole = 'host' | 'guest';

export type RoomOccupant = {
  role: JoinRole;
};

export type RoomAdmission =
  | { ok: true }
  | { ok: false; message: string };

const MAX_ROOM_CLIENTS = 2;

export function validateRoomJoin(
  clients: Iterable<RoomOccupant>,
  role: JoinRole,
  hasState: boolean,
): RoomAdmission {
  const occupants = Array.from(clients);
  const hostOccupied = occupants.some(c => c.role === 'host');
  const guestOccupied = occupants.some(c => c.role === 'guest');

  if (role === 'host') {
    if (hostOccupied) {
      return { ok: false, message: 'Host slot is already occupied.' };
    }
    if (occupants.length >= MAX_ROOM_CLIENTS) {
      return { ok: false, message: 'Room is full.' };
    }
    return { ok: true };
  }

  if (!hasState) {
    return { ok: false, message: 'Room not created yet — host must join first.' };
  }
  if (guestOccupied || occupants.length >= MAX_ROOM_CLIENTS) {
    return { ok: false, message: 'Room is full.' };
  }
  return { ok: true };
}
