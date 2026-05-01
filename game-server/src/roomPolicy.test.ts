import assert from 'node:assert/strict';
import {
  decideJoin,
  GUEST_EXISTS_MESSAGE,
  GUEST_PLAYER_SLOT,
  HOST_EXISTS_MESSAGE,
  HOST_PLAYER_SLOT,
  HOST_REQUIRED_MESSAGE,
  ROOM_FULL_MESSAGE,
  type RoomOccupant,
} from './roomPolicy.ts';

const host: RoomOccupant = { role: 'host', playerId: HOST_PLAYER_SLOT };
const guest: RoomOccupant = { role: 'guest', playerId: GUEST_PLAYER_SLOT };

assert.deepEqual(decideJoin([], 'host'), { ok: true, playerId: HOST_PLAYER_SLOT });
assert.deepEqual(decideJoin([host], 'guest'), { ok: true, playerId: GUEST_PLAYER_SLOT });

assert.deepEqual(decideJoin([], 'guest'), { ok: false, message: HOST_REQUIRED_MESSAGE });
assert.deepEqual(decideJoin([host], 'host'), { ok: false, message: HOST_EXISTS_MESSAGE });
assert.deepEqual(decideJoin([host, guest], 'host'), { ok: false, message: ROOM_FULL_MESSAGE });
assert.deepEqual(decideJoin([host, guest], 'guest'), { ok: false, message: ROOM_FULL_MESSAGE });

assert.deepEqual(decideJoin([guest], 'guest'), { ok: false, message: GUEST_EXISTS_MESSAGE });
