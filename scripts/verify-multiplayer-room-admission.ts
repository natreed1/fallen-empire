/**
 * Sanity checks for multiplayer room role admission (run with npx tsx).
 */
import { getJoinRejectionReason, type RoomOccupant } from '../game-server/src/roomAdmission.ts';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const emptyRoom: RoomOccupant[] = [];
assert(
  getJoinRejectionReason(emptyRoom, 'guest', false) === 'Room not created yet — host must join first.',
  'guest cannot create a room',
);
assert(getJoinRejectionReason(emptyRoom, 'host', false) === null, 'host can create a room');

const hostOnly: RoomOccupant[] = [{ role: 'host' }];
assert(getJoinRejectionReason(hostOnly, 'guest', true) === null, 'guest can join an open hosted room');
assert(
  getJoinRejectionReason(hostOnly, 'host', true) === 'Room already has a host.',
  'second host is rejected',
);

const guestOnlyAfterHostDisconnect: RoomOccupant[] = [{ role: 'guest' }];
assert(
  getJoinRejectionReason(guestOnlyAfterHostDisconnect, 'host', true) === null,
  'host can rejoin after disconnecting',
);
assert(
  getJoinRejectionReason(guestOnlyAfterHostDisconnect, 'guest', true) === 'Room already has a guest.',
  'second guest is rejected while guest slot is occupied',
);

const fullRoom: RoomOccupant[] = [{ role: 'host' }, { role: 'guest' }];
assert(getJoinRejectionReason(fullRoom, 'host', true) === 'Room already has a host.', 'full room rejects host');
assert(getJoinRejectionReason(fullRoom, 'guest', true) === 'Room already has a guest.', 'full room rejects guest');

console.log('verify-multiplayer-room-admission: ok');
